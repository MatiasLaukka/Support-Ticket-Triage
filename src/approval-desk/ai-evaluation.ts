import {
  CategorySchema,
  PrioritySchema,
  TeamSchema,
  type AiExecutionTrace,
  type AiPreference,
  type ClassificationSignal,
  type DraftCustomerResponseStyleInput,
  type ExpectedOutcome,
  type KnowledgeArticle,
  type Ticket,
} from "../domain.js";
import type {
  DiagnosisContext,
  FixContext,
  SubmitRecommendationInput,
} from "../triage-service.js";
import {
  advisorySignalsFromGptReasoning,
  buildApprovalDeskRecommendationInput,
  buildApprovalDeskRecommendationInputWithDrafting,
} from "./recommendation-builder.js";
import type { ClassificationReasoningProvider } from "./classification-reasoning-provider.js";
import { classifyTicketFromContext, type TicketClassification } from "./classifier.js";
import { buildConversationContextForTicket } from "./conversation-context.js";
import { classifyAiFailure } from "./draft-response-provider.js";
import type {
  CustomerResponseDraftProvider,
  GptClassificationReasoning,
} from "./draft-response-provider.js";

type CustomerReply = {
  id: string;
  ticketId: string;
  createdAt: string;
  body: string;
};

type PreviousSupportResponse = {
  sentAt: string;
  body: string;
};

export async function evaluateTicketWithAi(input: {
  ticket: Ticket;
  outcome?: ExpectedOutcome;
  actor: string;
  allKnowledgeArticles: readonly KnowledgeArticle[];
  customerReplies: readonly CustomerReply[];
  previousSupportResponse?: PreviousSupportResponse;
  diagnosisContext?: DiagnosisContext;
  fixContext?: FixContext;
  aiPreference: AiPreference;
  responseStyle: DraftCustomerResponseStyleInput;
  classificationProvider?: ClassificationReasoningProvider;
  draftProvider?: CustomerResponseDraftProvider;
}): Promise<Omit<SubmitRecommendationInput, "submittedAt">> {
  const conversationContext = buildConversationContextForTicket({
    ticket: input.ticket,
    customerReplies: input.customerReplies,
    previousSupportResponses: input.previousSupportResponse === undefined
      ? []
      : [input.previousSupportResponse],
  });
  const baseline = classifyTicketFromContext(conversationContext);
  const classificationExecution = await runClassificationStage({
    ...input,
    conversationContext,
    baseline,
  });
  const base = buildApprovalDeskRecommendationInput({
    ticket: input.ticket,
    outcome: input.outcome,
    actor: input.actor,
    customerReplies: input.customerReplies,
    previousSupportResponse: input.previousSupportResponse,
    advisoryClassificationSignals: classificationExecution.acceptedSignals,
    diagnosisContext: input.diagnosisContext,
    fixContext: input.fixContext,
  });
  const selectedKnowledge = input.allKnowledgeArticles.filter((article) =>
    base.knowledgeArticleIds.includes(article.id),
  );
  return buildApprovalDeskRecommendationInputWithDrafting({
    ticket: input.ticket,
    outcome: input.outcome,
    actor: input.actor,
    knowledgeArticles: selectedKnowledge,
    responseStyle: input.responseStyle,
    customerReplies: input.customerReplies,
    previousSupportResponse: input.previousSupportResponse,
    advisoryClassificationSignals: classificationExecution.acceptedSignals,
    diagnosisContext: input.diagnosisContext,
    fixContext: input.fixContext,
    draftProvider: input.aiPreference === "deterministic"
      ? undefined
      : input.draftProvider,
    aiPreference: input.aiPreference,
    classificationTrace: {
      ...classificationExecution.trace,
      finalOutcome: finalOutcomeFromRecommendation(base),
    },
  });
}

async function runClassificationStage(input: {
  ticket: Ticket;
  outcome?: ExpectedOutcome;
  allKnowledgeArticles: readonly KnowledgeArticle[];
  aiPreference: AiPreference;
  classificationProvider?: ClassificationReasoningProvider;
  conversationContext: ReturnType<typeof buildConversationContextForTicket>;
  baseline: TicketClassification;
}): Promise<{
  acceptedSignals: ClassificationSignal[];
  trace: AiExecutionTrace["classification"];
}> {
  const skipped = (status: "skipped" | "fallback", fallback?: AiExecutionTrace["classification"]["fallback"]) => ({
    acceptedSignals: [],
    trace: {
      status,
      acceptedSignals: [],
      rejectedAdvice: [],
      deterministicOverrides: [],
      finalOutcome: finalOutcomeFromClassification(input.outcome ?? input.baseline),
      ...(fallback === undefined ? {} : { fallback }),
    },
  });

  if (input.aiPreference === "deterministic" || input.outcome !== undefined) {
    return skipped("skipped");
  }
  if (input.classificationProvider === undefined) {
    return input.aiPreference === "gpt-preferred"
      ? skipped("fallback", {
          category: "not-configured",
          message: "OpenAI is not configured; deterministic output was used.",
        })
      : skipped("skipped");
  }

  try {
    const execution = await input.classificationProvider.reason({
      ticket: input.ticket,
      conversationContext: input.conversationContext,
      deterministicClassification: input.baseline,
    });
    const advice = advisoryAdvice({
      reasoning: execution.reasoning,
      allKnowledgeArticles: input.allKnowledgeArticles,
    });
    const finalClassification = classifyTicketFromContext(
      input.conversationContext,
      advice.acceptedSignals,
    );
    return {
      acceptedSignals: advice.acceptedSignals,
      trace: {
        status: "used",
        model: execution.telemetry.model,
        latencyMs: execution.telemetry.latencyMs,
        ...(execution.telemetry.usage === undefined
          ? {}
          : { usage: execution.telemetry.usage }),
        candidate: advice.candidate,
        acceptedSignals: advice.acceptedSignals,
        rejectedAdvice: advice.rejectedAdvice,
        deterministicOverrides: deterministicOverrides(
          advice.candidate,
          finalClassification,
        ),
        finalOutcome: finalOutcomeFromClassification(finalClassification),
      },
    };
  } catch (error) {
    return skipped("fallback", classifyAiFailure(error));
  }
}

function advisoryAdvice(input: {
  reasoning: GptClassificationReasoning;
  allKnowledgeArticles: readonly KnowledgeArticle[];
}): {
  acceptedSignals: ClassificationSignal[];
  candidate: NonNullable<AiExecutionTrace["classification"]["candidate"]>;
  rejectedAdvice: AiExecutionTrace["classification"]["rejectedAdvice"];
} {
  const knownKnowledge = new Set(input.allKnowledgeArticles.map((article) => article.id));
  const allowedKnowledgeArticleIds = input.reasoning.knowledgeArticleIds.filter((id) =>
    knownKnowledge.has(id),
  );
  const rejectedAdvice = input.reasoning.knowledgeArticleIds
    .filter((id) => !knownKnowledge.has(id))
    .map((id) => ({
      target: `knowledge:${traceIdentifier(id)}`,
      reason: "The proposed knowledge article is not in the approved knowledge set.",
    }));
  const candidate = {
    issueType: traceIdentifier(input.reasoning.issueType),
    ...(category(input.reasoning.candidateCategory) === undefined
      ? {}
      : { category: category(input.reasoning.candidateCategory) }),
    ...(team(input.reasoning.candidateTeam) === undefined
      ? {}
      : { team: team(input.reasoning.candidateTeam) }),
    ...(priority(input.reasoning.candidatePriority) === undefined
      ? {}
      : { priority: priority(input.reasoning.candidatePriority) }),
    knowledgeArticleIds: allowedKnowledgeArticleIds,
    confidence: Math.max(0, Math.min(1, input.reasoning.confidence)),
    explanation: "GPT classification advice was evaluated as advisory evidence.",
  };
  const acceptedSignals = advisorySignalsFromGptReasoning({
    ...input.reasoning,
    issueType: candidate.issueType,
    candidateCategory: candidate.category,
    candidateTeam: candidate.team,
    candidatePriority: candidate.priority,
    knowledgeArticleIds: allowedKnowledgeArticleIds,
    explanation: candidate.explanation,
  });
  return { acceptedSignals, candidate, rejectedAdvice };
}

function deterministicOverrides(
  candidate: NonNullable<AiExecutionTrace["classification"]["candidate"]>,
  finalClassification: TicketClassification,
): string[] {
  const categoryOrTeamDiffers =
    (candidate.category !== undefined && candidate.category !== finalClassification.category) ||
    (candidate.team !== undefined && candidate.team !== finalClassification.team);
  if (!categoryOrTeamDiffers &&
    (candidate.priority === undefined || candidate.priority === finalClassification.priority)) {
    return [];
  }
  if (finalClassification.category === "security" || finalClassification.team === "security") {
    return ["Deterministic security policy retained security routing."];
  }
  if (finalClassification.requiredEscalations.includes("outage")) {
    return ["Deterministic outage policy retained incident routing."];
  }
  return ["Deterministic classifier retained the final supported routing."];
}

function finalOutcomeFromClassification(
  classification: TicketClassification | ExpectedOutcome,
): AiExecutionTrace["classification"]["finalOutcome"] {
  return {
    category: classification.category,
    team: classification.team,
    priority: "priority" in classification
      ? classification.priority
      : classification.acceptablePriorities[0],
    knowledgeArticleIds: classification.knowledgeArticleIds,
    confidence: "confidence" in classification ? classification.confidence : 0.95,
    escalationReasons: classification.requiredEscalations,
  };
}

function finalOutcomeFromRecommendation(
  recommendation: Omit<SubmitRecommendationInput, "submittedAt">,
): AiExecutionTrace["classification"]["finalOutcome"] {
  return {
    category: recommendation.category,
    team: recommendation.team,
    priority: recommendation.priority,
    knowledgeArticleIds: recommendation.knowledgeArticleIds,
    confidence: recommendation.confidence,
    escalationReasons: recommendation.escalationReasons ?? [],
  };
}

function category(value: string | undefined) {
  const parsed = CategorySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function team(value: string | undefined) {
  const parsed = TeamSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function priority(value: string | undefined) {
  const parsed = PrioritySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function traceIdentifier(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized === "" || !/^[a-z]/.test(normalized)
    ? "unrecognized-advice"
    : normalized;
}
