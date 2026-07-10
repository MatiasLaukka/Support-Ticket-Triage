import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  CategorySchema,
  PrioritySchema,
  RequiredEscalationSchema,
  TeamSchema,
  TicketIdSchema,
  type ExpectedOutcome,
  type Ticket,
} from "../domain.js";
import type { SubmitRecommendationInput } from "../triage-service.js";

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
    draftCustomerResponse: buildDraftCustomerResponse(
      ticket.id,
      knowledgeArticleIds,
    ),
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

function buildTags(ticket: Ticket, outcome: ExpectedOutcome): string[] {
  return unique([
    ...ticket.tags,
    outcome.category,
    ...(outcome.requiredEscalations.includes("policy-conflict")
      ? ["policy-conflict"]
      : []),
  ]);
}

function buildDraftCustomerResponse(
  ticketId: string,
  knowledgeArticleIds: readonly string[],
): string {
  return `We are investigating ${ticketId}. ${formatCustomerGuidance(
    knowledgeArticleIds,
  )} We will share the next update once we have confirmed the details.`;
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
