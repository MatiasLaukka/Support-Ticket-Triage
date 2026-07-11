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

const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const CUSTOMER_RESPONSE_TEMPLATES: Readonly<Record<string, string>> = {
  "campaign-send-failures":
    "Please share the campaign name, scheduled send time, expected audience size, and any error banner shown in the campaign status. We will check the audience snapshot, template validation, sender profile, and suppression summary before recommending the next send action.",
  "coupon-catalog-sync":
    "Please share the store URL, product SKU, coupon pool name, last catalog sync time, and whether unused coupon codes remain available. We will compare the catalog import history with the campaign content before recommending a coupon or product update.",
  "email-deliverability":
    "Please share the campaign name, send time, sending domain, affected recipient domains, bounce samples, and whether the audience was recently imported. We will compare bounce type, complaint rate, suppression growth, and sender alignment with prior sends.",
  "event-tracking-debugging":
    "Please share the profile email or customer ID, event name, event timestamp with time zone, request ID if available, and a sample payload with secrets removed. We will compare the event payload, API accepted time, profile timeline, and downstream qualification.",
  "flow-trigger-troubleshooting":
    "Please share the flow name, profile email, trigger event, event timestamp, flow filters, consent state, smart sending status, and the profile's flow history. We will compare the trigger event, profile qualification, and message eligibility before recommending the next update.",
  "profile-sync-issues":
    "Please share the profile email, external customer ID, import filename or API request ID, update timestamp, and the field that should have changed. We will check duplicate profiles, matching identifiers, and consent state before recommending a merge or update.",
  "segmentation-audience-rules":
    "Please share the segment name, expected count, observed count, rule definition, a sample profile that should qualify, and when the segment was last edited. We will compare profile attributes, event recency, consent filters, and recalculation state.",
  "shopify-integration-sync":
    "Please share the Shopify store URL, affected object ID, SKU or order number, expected field, and last update time in Shopify. We will compare the source object with integration scopes and import history before recommending a sync action.",
  "sms-compliance":
    "Please share the campaign or flow name, masked recipient phone number, recipient region, consent source, opt-in timestamp, opt-out history, scheduled send time, and the compliance banner shown in the UI. We will verify channel eligibility before recommending any SMS send action.",
  "webhook-signature-validation":
    "Please share the delivery ID, endpoint URL, failure timestamp, signing secret rotation time, timestamp tolerance, endpoint response code, and whether raw body handling changed recently. We will compare the signed payload, delivery headers, and retry history before recommending a code or configuration change.",
};

type ResponseStyle =
  | "known-cause"
  | "incident-or-escalation"
  | "needs-diagnostics";
type CustomerAudience = "merchant-admin" | "developer";

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

  const draftCustomerResponse = buildDraftCustomerResponse({
    ticket,
    knowledgeArticleIds,
    escalationReasons,
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
    missingInformation: escalationReasons.includes("missing-information")
      ? [`Confirm the missing evidence for ${ticket.id} before approval.`]
      : [],
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
    recommendedNextAction:
      "Review the supporting evidence, then approve or reject this recommendation.",
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
  knowledgeArticleIds: readonly string[];
  escalationReasons: readonly string[];
}): string {
  const { ticket, knowledgeArticleIds, escalationReasons } = input;
  const style = classifyResponseStyle(
    ticket,
    knowledgeArticleIds,
    escalationReasons,
  );

  if (style === "known-cause") {
    return buildKnownCauseResponse(ticket);
  }

  if (style === "incident-or-escalation") {
    return buildEscalationResponse(ticket, escalationReasons);
  }

  if (
    classifyCustomerAudience(ticket) === "merchant-admin" &&
    isFlowEventGuidance(knowledgeArticleIds)
  ) {
    return buildMerchantFlowResponse(ticket);
  }

  return `We are investigating ${ticket.id}. ${formatCustomerGuidance(
    knowledgeArticleIds,
  )} We will share the next update once we have confirmed the details.`;
}

function classifyResponseStyle(
  ticket: Ticket,
  knowledgeArticleIds: readonly string[],
  escalationReasons: readonly string[],
): ResponseStyle {
  const text = ticketText(ticket);
  if (
    knowledgeArticleIds.includes("sms-compliance") &&
    text.includes("quiet-hour") &&
    text.includes("blocked")
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

function buildKnownCauseResponse(ticket: Ticket): string {
  const text = ticketText(ticket);
  if (text.includes("quiet-hour") && text.includes("blocked")) {
    return `We reviewed ${ticket.id}, and the dashboard message indicates quiet-hour protection blocked delivery. This looks like expected compliance behavior for an SMS campaign scheduled during restricted sending hours. Please reschedule the campaign for an eligible sending window or review the account quiet-hour settings before attempting another send.`;
  }

  return `We reviewed ${ticket.id} and found a likely explanation in the ticket details. We will confirm the safest next step and share an update before recommending any account change.`;
}

function buildEscalationResponse(
  ticket: Ticket,
  escalationReasons: readonly string[],
): string {
  if (escalationReasons.includes("security")) {
    return `We are treating ${ticket.id} as a potential security issue. Our next step is containment review, including exposure scope, affected profiles, and any required key rotation or log preservation. We will share the next update after the security review is complete.`;
  }

  if (escalationReasons.includes("outage")) {
    return `We are investigating ${ticket.id} as a possible platform delay affecting event processing. The event-ingestion delay is under incident review, and we are correlating affected regions, event timing, and profile activity timelines. We will share the next update after confirming impact and mitigation.`;
  }

  return `We are escalating ${ticket.id} for review and will share the next update after confirming impact, risk, and the safest next action.`;
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

function buildMerchantFlowResponse(ticket: Ticket): string {
  const flowLabel = ticketText(ticket).includes("browse abandonment")
    ? "Browse Abandonment flow"
    : "Abandoned Cart flow";
  const eventLabel = ticketText(ticket).includes("viewed product")
    ? "Viewed Product"
    : "Added to Cart";
  const productReference = eventLabel === "Viewed Product"
    ? "product URL or product ID"
    : "product or cart URL";

  return `We are checking why ${eventLabel} events did not place customers into the ${flowLabel}. Please send the flow name or flow ID, the ecommerce platform you use such as Shopify, Magento, WooCommerce, or a custom store, one affected customer email, the ${eventLabel} event ID or event time, and the ${productReference}. We will compare the storefront event with the flow setup and let you know what needs to be corrected.`;
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

function formatCustomerGuidance(knowledgeArticleIds: readonly string[]): string {
  const guidance = knowledgeArticleIds.map(
    (id) =>
      CUSTOMER_RESPONSE_TEMPLATES[id] ??
      "Please share the support details relevant to this request.",
  );
  return unique(guidance).join(" ");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
