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
  type CustomerResponseDraftProvider,
} from "./draft-response-provider.js";
import {
  analyzeEvidenceReadiness,
  type EvidenceReadiness,
} from "./evidence-readiness.js";
import { detectKnownCause, getKnownCause } from "./known-cause-catalog.js";

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
  | "partial-follow-up"
  | "all-evidence"
  | "customer-confirmed";

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
}): Omit<SubmitRecommendationInput, "submittedAt"> {
  const { ticket, outcome, actor } = input;
  if (outcome === undefined) {
    throw new Error(`No expected outcome exists for ${ticket.id}.`);
  }
  if (outcome.ticketId !== ticket.id) {
    throw new Error(
      `Expected outcome ${outcome.ticketId} does not match ticket ${ticket.id}.`,
    );
  }

  const escalationReasons = outcome.requiredEscalations;
  const knowledgeArticleIds = outcome.knowledgeArticleIds;
  const lifecycle = analyzeCustomerReplyLifecycle({
    ticket,
    outcome,
    customerReplies: input.customerReplies ?? [],
  });
  const evidenceReadiness = lifecycle.evidenceReadiness;

  const draftCustomerResponse = buildDraftCustomerResponse({
    ticket,
    outcome,
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
      outcome,
      knowledgeArticles: [],
      deterministicDraft: signedDraftCustomerResponse,
      responseStyle: "auto",
      actor,
      companyName: DEFAULT_SUPPORT_COMPANY_NAME,
      evidenceReadiness,
    },
    "deterministic",
    deterministicDraftChecks,
  );

  return {
    ticketId: ticket.id,
    sourceRevision: ticket.revision,
    category: outcome.category,
    priority: outcome.acceptablePriorities[0],
    team: outcome.team,
    tags: buildTags(ticket, outcome),
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
    rationale: `${ticket.id} matches expected ${outcome.category} routing to ${outcome.team} with knowledge ${knowledgeArticleIds.join(
      ", ",
    )}.`,
    confidence: 0.95,
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
}): Promise<Omit<SubmitRecommendationInput, "submittedAt">> {
  const base = buildApprovalDeskRecommendationInput(input);
  const outcome = input.outcome;
  if (outcome === undefined) {
    return base;
  }

  const draft = await draftCustomerResponseWithFallback({
    provider: input.draftProvider,
    draftInput: {
      ticket: input.ticket,
      outcome,
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

function buildTags(ticket: Ticket, outcome: ExpectedOutcome): string[] {
  return unique([
    ...ticket.tags,
    outcome.category,
    ...(outcome.requiredEscalations.includes("policy-conflict")
      ? ["policy-conflict"]
      : []),
  ]);
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

  const style = classifyResponseStyle(
    ticket,
    input.outcome,
    knowledgeArticleIds,
    escalationReasons,
  );

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

  return buildStructuredDiagnosticResponse({
    ticket,
    evidenceReadiness,
    replyStage: input.replyStage,
    problemSummary: `We are checking the ${formatKnowledgeTopic(
      knowledgeArticleIds,
    )} reported in ${ticket.id}.`,
    nextStep:
      "Once we have those details, we will compare the examples with the relevant account setup and share the next recommended action.",
  });
}

function classifyResponseStyle(
  ticket: Ticket,
  outcome: ExpectedOutcome,
  knowledgeArticleIds: readonly string[],
  escalationReasons: readonly string[],
): ResponseStyle {
  if (
    detectKnownCause({
      ticket,
      outcome,
    }) !== undefined
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
    replyStage === "partial-follow-up"
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
}): { evidenceReadiness: EvidenceReadiness; replyStage: CustomerReplyStage } {
  const ticketReplies = input.customerReplies.filter(
    (reply) => reply.ticketId === input.ticket.id,
  );
  if (ticketReplies.length === 0) {
    const evidenceReadiness = analyzeEvidenceReadiness({
      ticket: input.ticket,
      outcome: input.outcome,
    });
    return {
      evidenceReadiness: withLifecycleSupportState(
        evidenceReadiness,
        requiresMoreCustomerEvidence(evidenceReadiness)
          ? "needs-information"
          : evidenceReadiness.supportState,
      ),
      replyStage: "first-contact",
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
    };
  }

  if (requiresMoreCustomerEvidence(evidenceReadiness)) {
    return {
      evidenceReadiness: withLifecycleSupportState(
        evidenceReadiness,
        "information-received",
      ),
      replyStage: "partial-follow-up",
    };
  }

  return {
    evidenceReadiness,
    replyStage: "all-evidence",
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
  return /\b(fixed|resolved|works now|working now|that worked|that fixed it)\b/i.test(
    value,
  );
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

function formatKnowledgeTopic(knowledgeArticleIds: readonly string[]): string {
  if (knowledgeArticleIds.includes("webhook-signature-validation")) {
    return "webhook signature issue";
  }
  if (knowledgeArticleIds.includes("campaign-send-failures")) {
    return "campaign send issue";
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
