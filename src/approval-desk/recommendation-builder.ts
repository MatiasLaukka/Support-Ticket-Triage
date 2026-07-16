import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  CategorySchema,
  type KnowledgeArticle,
  type DraftCustomerResponseStyleInput,
  PrioritySchema,
  RequiredEscalationSchema,
  TeamSchema,
  TicketIdSchema,
  type ExpectedOutcome,
  type Ticket,
} from "../domain.js";
import type { SubmitRecommendationInput } from "../triage-service.js";
import {
  buildDeterministicGptAssist,
  DEFAULT_SUPPORT_COMPANY_NAME,
  draftCustomerResponseWithFallback,
  ensureDraftSignOff,
  type CustomerResponseConversationContext,
  type CustomerResponseDraftProvider,
} from "./draft-response-provider.js";
import {
  analyzeEvidenceReadiness,
  type EvidenceReadiness,
} from "./evidence-readiness.js";
import {
  classifyTicket,
  classifyTicketFromContext,
  type TicketClassification,
} from "./classifier.js";
import { buildConversationContextForTicket } from "./conversation-context.js";
import { getKnownCause } from "./known-cause-catalog.js";

const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

type ResponseStyle =
  | "known-cause"
  | "incident-or-escalation"
  | "needs-diagnostics";
type CustomerAudience = "merchant-admin" | "developer";
type CustomerReply = {
  id: string;
  ticketId: string;
  createdAt: string;
  body: string;
};
type CustomerReplyStage =
  | "first-contact"
  | "vague-follow-up"
  | "partial-follow-up"
  | "all-evidence"
  | "customer-confirmed";
type PreviousSupportResponse = {
  sentAt: string;
  body: string;
};

const ExpectedOutcomeSchema = z
  .object({
    ticketId: TicketIdSchema,
    category: CategorySchema,
    acceptablePriorities: z.array(PrioritySchema).min(1),
    team: TeamSchema,
    requiredEscalations: z.array(RequiredEscalationSchema),
    knowledgeArticleIds: z.array(SlugSchema),
    duplicateGroup: z.string().trim().min(1).optional(),
  })
  .strict();

const ExpectedOutcomesSchema = z.array(ExpectedOutcomeSchema);

export async function loadExpectedOutcomes(
  path: string,
): Promise<ReadonlyMap<string, ExpectedOutcome>> {
  const raw = await readFile(path, "utf8");
  const outcomes = ExpectedOutcomesSchema.parse(JSON.parse(raw));
  const byTicketId = new Map<string, ExpectedOutcome>();
  for (const outcome of outcomes) {
    if (byTicketId.has(outcome.ticketId)) {
      throw new Error(`Duplicate expected outcome for ${outcome.ticketId}.`);
    }
    byTicketId.set(outcome.ticketId, outcome);
  }
  return byTicketId;
}

export function buildApprovalDeskRecommendationInput(input: {
  ticket: Ticket;
  outcome?: ExpectedOutcome;
  actor: string;
  customerReplies?: readonly CustomerReply[];
  previousSupportResponse?: PreviousSupportResponse;
}): Omit<SubmitRecommendationInput, "submittedAt"> {
  const { ticket, outcome, actor } = input;
  const conversationContextForClassification = buildConversationContextForTicket({
    ticket,
    customerReplies: input.customerReplies ?? [],
    previousSupportResponses:
      input.previousSupportResponse === undefined
        ? []
        : [input.previousSupportResponse],
  });
  const classification =
    outcome === undefined
      ? classifyTicketFromContext(conversationContextForClassification)
      : undefined;
  const resolvedOutcome =
    outcome ?? outcomeFromClassification(ticket, classification!);
  if (outcome !== undefined && outcome.ticketId !== ticket.id) {
    throw new Error(
      `Expected outcome ${outcome.ticketId} does not match ticket ${ticket.id}.`,
    );
  }

  const escalationReasons = resolvedOutcome.requiredEscalations;
  const knowledgeArticleIds = resolvedOutcome.knowledgeArticleIds;
  const lifecycle = analyzeCustomerReplyLifecycle({
    ticket,
    outcome: resolvedOutcome,
    customerReplies: input.customerReplies ?? [],
  });
  const evidenceReadiness = lifecycle.evidenceReadiness;
  const conversationContext = buildConversationContext({
    customerReplies: input.customerReplies ?? [],
    ticketId: ticket.id,
    replyStage: lifecycle.replyStage,
    recognizedEvidenceProgress: lifecycle.recognizedEvidenceProgress,
    previousSupportResponse: input.previousSupportResponse,
  });
  const ticketWithCustomerReplyContext = ticketWithCustomerReplies(
    ticket,
    input.customerReplies ?? [],
  );

  const draftCustomerResponse = buildDraftCustomerResponse({
    ticket: ticketWithCustomerReplyContext,
    outcome: resolvedOutcome,
    knowledgeArticleIds,
    escalationReasons,
    evidenceReadiness,
    replyStage: lifecycle.replyStage,
  });
  const signedDraftCustomerResponse = ensureDraftSignOff(draftCustomerResponse, {
    actor,
    companyName: DEFAULT_SUPPORT_COMPANY_NAME,
  });
  const deterministicDraftChecks = [
    {
      id: "deterministic-local-draft",
      label: "Deterministic local draft",
      status: "pass" as const,
      message: "Built from local rules without an external model call.",
    },
  ];

  const deterministicAssist = buildDeterministicGptAssist(
    {
      ticket,
      outcome: resolvedOutcome,
      knowledgeArticles: [],
      deterministicDraft: signedDraftCustomerResponse,
      responseStyle: "auto",
      actor,
      companyName: DEFAULT_SUPPORT_COMPANY_NAME,
      evidenceReadiness,
      conversationContext,
    },
    "deterministic",
    deterministicDraftChecks,
  );

  return {
    ticketId: ticket.id,
    sourceRevision: ticket.revision,
    category: resolvedOutcome.category,
    priority: resolvedOutcome.acceptablePriorities[0],
    team: resolvedOutcome.team,
    tags: buildTags(ticket, resolvedOutcome),
    duplicateCandidates: [],
    outageRisk: escalationReasons.includes("outage") ? "likely" : "none",
    securityRisk: escalationReasons.includes("security") ? "possible" : "none",
    slaRisk: escalationReasons.includes("sla") ? "likely" : "none",
    missingInformation: evidenceReadiness.missingEvidence.map(
      (requirement) => requirement.customerQuestion,
    ),
    supportState: evidenceReadiness.supportState,
    knownCause: evidenceReadiness.knownCause,
    requiredEvidence: evidenceReadiness.requiredEvidence,
    providedEvidence: evidenceReadiness.providedEvidence,
    missingEvidence: evidenceReadiness.missingEvidence,
    nextInvestigationSteps: evidenceReadiness.nextInvestigationSteps,
    knowledgeArticleIds,
    draftCustomerResponse: signedDraftCustomerResponse,
    draftCustomerResponseSource: "deterministic",
    draftCustomerResponseStyle: deterministicAssist.selectedTone,
    draftCustomerResponseChecks: deterministicDraftChecks,
    gptAssist: deterministicAssist,
    ...(classification === undefined
      ? {
          rationale: `${ticket.id} matches expected ${resolvedOutcome.category} routing to ${resolvedOutcome.team} with knowledge ${knowledgeArticleIds.join(
            ", ",
          )}.`,
          confidence: 0.95,
        }
      : {
          classificationSignals: classification.signals,
          confidence: classification.confidence,
          rationale: `${ticket.id} was classified by the deterministic classifier as ${resolvedOutcome.category} routing to ${resolvedOutcome.team} with knowledge ${resolvedOutcome.knowledgeArticleIds.join(
            ", ",
          )}.`,
        }),
    recommendedNextAction: formatRecommendedNextAction(evidenceReadiness),
    escalationRequired: escalationReasons.length > 0,
    escalationReasons,
    actor,
  };
}

export async function buildApprovalDeskRecommendationInputWithDrafting(input: {
  ticket: Ticket;
  outcome?: ExpectedOutcome;
  actor: string;
  knowledgeArticles: readonly KnowledgeArticle[];
  draftProvider?: CustomerResponseDraftProvider;
  responseStyle?: DraftCustomerResponseStyleInput;
  customerReplies?: readonly CustomerReply[];
  previousSupportResponse?: PreviousSupportResponse;
}): Promise<Omit<SubmitRecommendationInput, "submittedAt">> {
  const base = buildApprovalDeskRecommendationInput(input);
  const providerOutcome = input.outcome ?? {
    ticketId: input.ticket.id,
    category: base.category,
    acceptablePriorities: [base.priority],
    team: base.team,
    requiredEscalations: base.escalationReasons ?? [],
    knowledgeArticleIds: base.knowledgeArticleIds,
  };
  const lifecycle = analyzeCustomerReplyLifecycle({
    ticket: input.ticket,
    outcome: providerOutcome,
    customerReplies: input.customerReplies ?? [],
  });

  const draft = await draftCustomerResponseWithFallback({
    provider: input.draftProvider,
    draftInput: {
      ticket: input.ticket,
      outcome: providerOutcome,
      knowledgeArticles: input.knowledgeArticles,
      deterministicDraft: base.draftCustomerResponse,
      responseStyle: input.responseStyle ?? "auto",
      actor: input.actor,
      companyName: DEFAULT_SUPPORT_COMPANY_NAME,
      evidenceReadiness: {
        supportState: base.supportState ?? "diagnosing",
        knownCause: base.knownCause,
        requiredEvidence: base.requiredEvidence ?? [],
        providedEvidence: base.providedEvidence ?? [],
        missingEvidence: base.missingEvidence ?? [],
        nextInvestigationSteps: base.nextInvestigationSteps ?? [],
      },
      conversationContext: buildConversationContext({
        customerReplies: input.customerReplies ?? [],
        ticketId: input.ticket.id,
        replyStage: lifecycle.replyStage,
        recognizedEvidenceProgress: lifecycle.recognizedEvidenceProgress,
        previousSupportResponse: input.previousSupportResponse,
      }),
    },
  });

  return {
    ...base,
    draftCustomerResponse: draft.response,
    draftCustomerResponseSource: draft.source,
    draftCustomerResponseStyle: draft.assist.selectedTone,
    draftCustomerResponseChecks: draft.checks,
    gptAssist: draft.assist,
  };
}

function outcomeFromClassification(
  ticket: Ticket,
  classification: TicketClassification,
): ExpectedOutcome {
  return {
    ticketId: ticket.id,
    category: classification.category,
    acceptablePriorities: [classification.priority],
    team: classification.team,
    requiredEscalations: classification.requiredEscalations,
    knowledgeArticleIds: classification.knowledgeArticleIds,
  };
}

function buildTags(ticket: Ticket, outcome: ExpectedOutcome): string[] {
  return unique([
    ...ticket.tags,
    outcome.category,
    ...(outcome.requiredEscalations.includes("policy-conflict")
      ? ["policy-conflict"]
      : []),
  ]);
}

function ticketWithCustomerReplies(
  ticket: Ticket,
  customerReplies: readonly CustomerReply[],
): Ticket {
  const replyText = customerReplies
    .filter((reply) => reply.ticketId === ticket.id)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    )
    .map((reply) => reply.body)
    .join("\n\n");
  if (replyText.trim() === "") {
    return ticket;
  }
  return {
    ...ticket,
    description: `${ticket.description}\n\nCustomer follow-up:\n${replyText}`,
  };
}

function buildDraftCustomerResponse(input: {
  ticket: Ticket;
  outcome: ExpectedOutcome;
  knowledgeArticleIds: readonly string[];
  escalationReasons: readonly string[];
  evidenceReadiness: EvidenceReadiness;
  replyStage: CustomerReplyStage;
}): string {
  const { ticket, knowledgeArticleIds, escalationReasons, evidenceReadiness } =
    input;
  if (input.replyStage === "customer-confirmed") {
    return buildCustomerConfirmedResponse(ticket);
  }

  if (evidenceReadiness.supportState === "waiting-on-platform-fix") {
    return buildPlatformFixResponse(ticket, evidenceReadiness, input.replyStage);
  }

  const style = classifyResponseStyle(escalationReasons, evidenceReadiness);

  if (style === "known-cause") {
    return buildKnownCauseResponse(ticket, evidenceReadiness, input.replyStage);
  }

  if (style === "incident-or-escalation") {
    return buildEscalationResponse(
      ticket,
      escalationReasons,
      evidenceReadiness,
      input.replyStage,
    );
  }

  if (
    classifyCustomerAudience(ticket) === "merchant-admin" &&
    isFlowEventGuidance(knowledgeArticleIds)
  ) {
    return buildStructuredDiagnosticResponse({
      ticket,
      evidenceReadiness,
      replyStage: input.replyStage,
      problemSummary: buildFlowProblemSummary(ticket),
      nextStep:
        "Once we have those details, we will compare the storefront event with the flow setup and profile timeline before recommending the safest correction.",
    });
  }

  if (
    input.outcome.category === "performance" &&
    input.outcome.team === "product" &&
    /\bcampaign editor\b.{0,80}\b(?:blank|not loading|stayed blank|empty page)|\b(?:blank|stayed blank|empty page)\b.{0,80}\bcampaign editor\b/i.test(
      ticketText(ticket),
    )
  ) {
    return buildStructuredDiagnosticResponse({
      ticket,
      evidenceReadiness,
      replyStage: input.replyStage,
      problemSummary:
        "The details you sent narrow this down to the campaign editor loading path rather than a general support issue.",
      nextStep:
        "We are checking the editor load path, account session state, and whether the behavior is isolated to one campaign or affecting other users before recommending the next action.",
    });
  }

  if (isGenericSupportIssue(input.outcome, knowledgeArticleIds)) {
    return buildStructuredDiagnosticResponse({
      ticket,
      evidenceReadiness,
      replyStage: input.replyStage,
      problemSummary:
        "I am sorry this is getting in your way. We need a little more detail so we can understand what is happening and route it to the right team.",
      nextStep:
        "Once we know what you were trying to do, where it happened, and what you saw, we can investigate the right area and share the next step.",
    });
  }

  return buildStructuredDiagnosticResponse({
    ticket,
    evidenceReadiness,
    replyStage: input.replyStage,
    problemSummary: `We are checking the ${formatKnowledgeTopic(
      knowledgeArticleIds,
      ticket,
    )} reported in ${ticket.id}.`,
    nextStep:
      "Once we have those details, we will compare the examples with the relevant account setup and share the next recommended action.",
  });
}

function classifyResponseStyle(
  escalationReasons: readonly string[],
  evidenceReadiness: EvidenceReadiness,
): ResponseStyle {
  if (
    evidenceReadiness.knownCause !== null &&
    evidenceReadiness.knownCause !== undefined
  ) {
    return "known-cause";
  }

  if (
    escalationReasons.includes("outage") ||
    escalationReasons.includes("security")
  ) {
    return "incident-or-escalation";
  }

  return "needs-diagnostics";
}

function buildKnownCauseResponse(
  ticket: Ticket,
  evidenceReadiness: EvidenceReadiness,
  replyStage: CustomerReplyStage,
): string {
  const knownCause = getKnownCause(evidenceReadiness.knownCause);
  if (knownCause !== undefined) {
    return buildStructuredDiagnosticResponse({
      ticket,
      evidenceReadiness,
      replyStage,
      problemSummary: knownCause.problemSummary,
      nextStep: knownCause.nextStep,
    });
  }

  return buildStructuredDiagnosticResponse({
    ticket,
    evidenceReadiness,
    replyStage,
    problemSummary:
      "We reviewed the ticket and found a likely explanation in the details provided.",
    nextStep:
      "We will confirm the safest next step before recommending any account change.",
  });
}

function buildEscalationResponse(
  ticket: Ticket,
  escalationReasons: readonly string[],
  evidenceReadiness: EvidenceReadiness,
  replyStage: CustomerReplyStage,
): string {
  if (escalationReasons.includes("security")) {
    return buildStructuredDiagnosticResponse({
      ticket,
      evidenceReadiness,
      replyStage,
      problemSummary:
        "We are treating this as a potential security issue and reviewing the safest containment path.",
      nextStep:
        "Our next step is containment review, including exposure scope, affected profiles, and any required key rotation or log preservation. We will share the next update after the security review is complete.",
    });
  }

  if (escalationReasons.includes("outage")) {
    return buildPlatformFixResponse(ticket, evidenceReadiness, replyStage);
  }

  return buildStructuredDiagnosticResponse({
    ticket,
    evidenceReadiness,
    replyStage,
    problemSummary:
      "We are escalating this ticket for review because it may need a safer specialist path.",
    nextStep:
      "We will share the next update after confirming impact, risk, and the safest next action.",
  });
}

function buildPlatformFixResponse(
  ticket: Ticket,
  evidenceReadiness: EvidenceReadiness,
  replyStage: CustomerReplyStage,
): string {
  return buildStructuredDiagnosticResponse({
    ticket,
    evidenceReadiness,
    replyStage,
    problemSummary:
      "We are investigating this as a possible platform delay affecting event processing.",
    nextStep:
      "The event-ingestion delay is under incident review, and we are correlating affected regions, event timing, and profile activity timelines. We will share the next update after confirming impact and mitigation.",
  });
}

function classifyCustomerAudience(ticket: Ticket): CustomerAudience {
  const text = ticketText(ticket);
  return [
    "api",
    "payload",
    "webhook",
    "endpoint",
    "request id",
    "logs",
    "hmac",
    "signature",
  ].some((technicalTerm) => text.includes(technicalTerm))
    ? "developer"
    : "merchant-admin";
}

function isFlowEventGuidance(knowledgeArticleIds: readonly string[]): boolean {
  return (
    knowledgeArticleIds.includes("flow-trigger-troubleshooting") &&
    knowledgeArticleIds.includes("event-tracking-debugging")
  );
}

function buildFlowProblemSummary(ticket: Ticket): string {
  const flowLabel = ticketText(ticket).includes("browse abandonment")
    ? "Browse Abandonment flow"
    : "Abandoned Cart flow";
  const eventLabel = ticketText(ticket).includes("viewed product")
    ? "Viewed Product"
    : "Added to Cart";

  return `We are checking why ${eventLabel} events did not place customers into the ${flowLabel}.`;
}

function buildStructuredDiagnosticResponse(input: {
  ticket: Ticket;
  evidenceReadiness: EvidenceReadiness;
  replyStage: CustomerReplyStage;
  problemSummary: string;
  nextStep: string;
}): string {
  return [
    `Hi ${input.ticket.customer.name},`,
    "",
    formatReplyAcknowledgement(input.replyStage),
    "",
    input.problemSummary,
    "",
    formatEvidenceRequest(input.evidenceReadiness, input.replyStage),
    "",
    input.nextStep,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function formatReplyAcknowledgement(replyStage: CustomerReplyStage): string {
  if (replyStage === "vague-follow-up") {
    return "Thanks for getting back to us.";
  }
  if (replyStage === "partial-follow-up") {
    return "Thanks for sending those details.";
  }
  if (replyStage === "all-evidence") {
    return "Thanks for confirming those details.";
  }
  return "";
}

function formatEvidenceRequest(
  evidenceReadiness: EvidenceReadiness,
  replyStage: CustomerReplyStage,
): string {
  if (evidenceReadiness.missingEvidence.length === 0) {
    return "We do not need any additional information from you before the next update.";
  }

  return [
    replyStage === "vague-follow-up"
      ? "To keep this moving, we still need the specific details below:"
      : replyStage === "partial-follow-up"
      ? "To move this forward, we still need:"
      : "To move this forward, please share:",
    ...evidenceReadiness.missingEvidence.map(
      (requirement) => `- ${requirement.customerQuestion}`,
    ),
  ].join("\n");
}

function formatRecommendedNextAction(
  evidenceReadiness: EvidenceReadiness,
): string {
  if (evidenceReadiness.supportState === "needs-information") {
    return "Collect the missing evidence, then continue diagnosis.";
  }
  if (evidenceReadiness.supportState === "information-received") {
    return "Thank the customer and collect only the remaining evidence.";
  }
  if (evidenceReadiness.supportState === "known-cause") {
    return "Explain the known cause and recommended customer action.";
  }
  if (evidenceReadiness.supportState === "ready-for-close") {
    return "Acknowledge the customer's confirmation and prepare to close the ticket.";
  }
  if (evidenceReadiness.supportState === "waiting-on-platform-fix") {
    return "Continue platform-impact review and share the next customer update.";
  }
  return "Review the supporting evidence, then approve or reject this recommendation.";
}

function analyzeCustomerReplyLifecycle(input: {
  ticket: Ticket;
  outcome: ExpectedOutcome;
  customerReplies: readonly CustomerReply[];
}): {
  evidenceReadiness: EvidenceReadiness;
  replyStage: CustomerReplyStage;
  recognizedEvidenceProgress: boolean;
} {
  const ticketReplies = input.customerReplies.filter(
    (reply) => reply.ticketId === input.ticket.id,
  ).sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
  const evidenceBeforeReplies = analyzeEvidenceReadiness({
    ticket: input.ticket,
    outcome: input.outcome,
  });
  if (ticketReplies.length === 0) {
    return {
      evidenceReadiness: withLifecycleSupportState(
        evidenceBeforeReplies,
        requiresMoreCustomerEvidence(evidenceBeforeReplies)
          ? "needs-information"
          : evidenceBeforeReplies.supportState,
      ),
      replyStage: "first-contact",
      recognizedEvidenceProgress: false,
    };
  }

  const replyText = ticketReplies
    .map((reply) => reply.body)
    .join("\n\n");
  const ticketWithReplies: Ticket = {
    ...input.ticket,
    description: `${input.ticket.description}\n\nCustomer follow-up:\n${replyText}`,
  };
  const evidenceReadiness = analyzeEvidenceReadiness({
    ticket: ticketWithReplies,
    outcome: input.outcome,
  });
  const latestReply = ticketReplies[ticketReplies.length - 1]?.body ?? "";

  if (isCustomerConfirmation(latestReply)) {
    return {
      evidenceReadiness: withLifecycleSupportState(
        {
          ...evidenceReadiness,
          missingEvidence: [],
        },
        "ready-for-close",
      ),
      replyStage: "customer-confirmed",
      recognizedEvidenceProgress: true,
    };
  }

  if (hasPlatformFixContext(replyText)) {
    return {
      evidenceReadiness: platformFixEvidenceReadiness(evidenceReadiness),
      replyStage: "all-evidence",
      recognizedEvidenceProgress: true,
    };
  }

  if (requiresMoreCustomerEvidence(evidenceReadiness)) {
    const hasUsefulEvidenceProgress = hasNewRecognizedEvidence(
      evidenceBeforeReplies,
      evidenceReadiness,
    );
    return {
      evidenceReadiness: withLifecycleSupportState(
        evidenceReadiness,
        hasUsefulEvidenceProgress
          ? "information-received"
          : "needs-information",
      ),
      replyStage: hasUsefulEvidenceProgress
        ? "partial-follow-up"
        : "vague-follow-up",
      recognizedEvidenceProgress: hasUsefulEvidenceProgress,
    };
  }

  return {
    evidenceReadiness,
    replyStage: "all-evidence",
    recognizedEvidenceProgress: true,
  };
}

function buildConversationContext(input: {
  customerReplies: readonly CustomerReply[];
  ticketId: string;
  replyStage: CustomerReplyStage;
  recognizedEvidenceProgress: boolean;
  previousSupportResponse?: PreviousSupportResponse;
}): CustomerResponseConversationContext {
  const latestCustomerReply = input.customerReplies
    .filter((reply) => reply.ticketId === input.ticketId)
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id),
    )[0];

  return {
    turnType: input.replyStage,
    hasCustomerReply: latestCustomerReply !== undefined,
    recognizedEvidenceProgress: input.recognizedEvidenceProgress,
    ...(latestCustomerReply === undefined
      ? {}
      : {
          latestCustomerReply: {
            createdAt: latestCustomerReply.createdAt,
            body: latestCustomerReply.body,
          },
        }),
    ...(input.previousSupportResponse === undefined
      ? {}
      : { previousSupportResponse: input.previousSupportResponse }),
  };
}

function hasNewRecognizedEvidence(
  evidenceBeforeReplies: EvidenceReadiness,
  evidenceAfterReplies: EvidenceReadiness,
): boolean {
  const providedBeforeReplies = new Set(
    evidenceBeforeReplies.providedEvidence.map((requirement) => requirement.id),
  );
  return evidenceAfterReplies.providedEvidence.some(
    (requirement) => !providedBeforeReplies.has(requirement.id),
  );
}

function isGenericSupportIssue(
  outcome: ExpectedOutcome,
  knowledgeArticleIds: readonly string[],
): boolean {
  return outcome.category === "other" && knowledgeArticleIds.length === 0;
}

function platformFixEvidenceReadiness(
  evidenceReadiness: EvidenceReadiness,
): EvidenceReadiness {
  const requiredEvidence = evidenceReadiness.requiredEvidence.filter(
    (requirement) => requirement.source !== "known-cause",
  );
  const requiredIds = new Set(requiredEvidence.map((requirement) => requirement.id));

  return {
    ...evidenceReadiness,
    supportState: "waiting-on-platform-fix",
    knownCause: null,
    requiredEvidence,
    providedEvidence: evidenceReadiness.providedEvidence.filter((requirement) =>
      requiredIds.has(requirement.id),
    ),
    missingEvidence: evidenceReadiness.missingEvidence.filter((requirement) =>
      requiredIds.has(requirement.id),
    ),
    nextInvestigationSteps: [
      "Correlate affected region, event timing, ingestion delay, and profile timeline updates.",
      "Confirm whether platform processing delay explains the customer impact.",
    ],
  };
}

function withLifecycleSupportState(
  evidenceReadiness: EvidenceReadiness,
  supportState: EvidenceReadiness["supportState"],
): EvidenceReadiness {
  return {
    ...evidenceReadiness,
    supportState,
  };
}

function requiresMoreCustomerEvidence(
  evidenceReadiness: EvidenceReadiness,
): boolean {
  return evidenceReadiness.missingEvidence.length > 0;
}

function isCustomerConfirmation(value: string): boolean {
  const normalized = value.toLowerCase();
  const unresolvedOrNegated =
    /\b(?:not|never|isn'?t|wasn'?t|hasn'?t|still)\b.{0,24}\b(?:fixed|resolved|working|works)\b|\b(?:unresolved|broken|fail(?:s|ed|ing|ure)?|not working)\b/i;
  if (unresolvedOrNegated.test(normalized)) {
    return false;
  }

  const clauses = normalized.split(
    /(?:[.!?\n]+|\bbut\b|\bhowever\b)/,
  );
  return clauses.some(
    (clause) =>
      /\b(?:that|this|it) (?:has )?(?:worked|fixed it|resolved (?:it|the issue|the problem))\b|\b(?:works|working|fixed|resolved) now\b|\b(?:the |this )?(?:issue|problem) (?:is|has been) resolved\b|\b(?:fixed|resolved)[, ]+(?:thanks|thank you|on my end|for us)\b/i.test(
        clause,
      ),
  );
}

function hasPlatformFixContext(value: string): boolean {
  const negatedImpact =
    /\b(?:not|isn'?t|wasn'?t|aren'?t|weren'?t|no)\b.{0,24}\b(?:affecting|impacting)\b.{0,24}\b(?:all|multiple|many)\b.{0,40}\b(?:stores|accounts|profiles|customers)\b/i;
  const limitedImpact =
    /\b(?:only\s+)?(?:one|single)\s+(?:store|account|profile|customer)s?\b|\bnot\s+(?:all|multiple|many)\s+(?:stores|accounts|profiles|customers)\b/i;
  const negatedPlatform =
    /\b(?:not|isn'?t|wasn'?t|aren'?t|weren'?t|no)\b.{0,24}\b(?:platform|platform-side|incident)\b/i;
  if (
    negatedImpact.test(value) ||
    limitedImpact.test(value) ||
    negatedPlatform.test(value)
  ) {
    return false;
  }

  return /\b(?:all|multiple|many)\b.{0,40}\b(?:stores|accounts|profiles|customers)\b/i.test(value) &&
    /\b(?:delayed|delay|missing|not showing|not processing)\b/i.test(value) &&
    /\b(?:api accepted|accepted by the api|platform|incident|processing)\b/i.test(value);
}

function buildCustomerConfirmedResponse(ticket: Ticket): string {
  return [
    `Hi ${ticket.customer.name},`,
    "",
    "Glad to hear that resolved it. I will leave the ticket ready to close from our side.",
    "",
    "Thanks again for working through the details with us.",
  ].join("\n");
}

function formatKnowledgeTopic(
  knowledgeArticleIds: readonly string[],
  ticket: Ticket,
): string {
  const text = ticketText(ticket);
  if (knowledgeArticleIds.includes("webhook-signature-validation")) {
    return "webhook signature issue";
  }
  if (knowledgeArticleIds.includes("campaign-send-failures")) {
    return "campaign send issue";
  }
  if (
    knowledgeArticleIds.includes("shopify-integration-sync") &&
    knowledgeArticleIds.includes("coupon-catalog-sync") &&
    /\b(?:product|catalog|sku)\b/i.test(text) &&
    !/\b(?:coupon|promo(?:tion)? code|discount code)\b/i.test(text)
  ) {
    return "product catalog sync delay";
  }
  if (knowledgeArticleIds.includes("coupon-catalog-sync")) {
    return "coupon or catalog sync issue";
  }
  if (knowledgeArticleIds.includes("email-deliverability")) {
    return "email deliverability issue";
  }
  if (knowledgeArticleIds.includes("shopify-integration-sync")) {
    return "store integration sync issue";
  }
  return "support issue";
}

function ticketText(ticket: Ticket): string {
  return [
    ticket.subject,
    ticket.description,
    ticket.category,
    ticket.priority,
    ticket.team,
    ...ticket.tags,
  ]
    .join(" ")
    .toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
