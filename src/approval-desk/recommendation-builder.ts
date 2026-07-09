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
const CUSTOMER_KNOWLEDGE_GUIDANCE: Readonly<Record<string, string>> = {
  "account-access":
    "affected account, workspace, sign-in details, and recent login history",
  "api-errors":
    "the affected endpoint, status code, request identifier, region, and timestamp",
  "billing-refunds":
    "invoice identifiers, charge status, and any duplicate billing records",
  "incident-response":
    "related service reports, affected region, time window, and customer-safe status details",
  "integration-webhooks":
    "webhook signing, delivery timing, and endpoint configuration",
  performance:
    "affected workflow, dataset size, observed duration, and baseline performance",
  "security-escalation":
    "potential credential exposure, access scope, and evidence needed for safe security routing",
  "sla-policy":
    "response deadlines and SLA risk so the next action is prioritized correctly",
  "triage-policy":
    "the reported behavior, expected behavior, timestamps, and reproduction details",
  "vip-communications":
    "business impact, next action, and update cadence",
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
  return `We are investigating ${ticketId}. We are checking ${formatCustomerGuidance(
    knowledgeArticleIds,
  )} and will share the next update once we have confirmed the details.`;
}

function formatCustomerGuidance(knowledgeArticleIds: readonly string[]): string {
  const guidance = knowledgeArticleIds.map(
    (id) =>
      CUSTOMER_KNOWLEDGE_GUIDANCE[id] ??
      "the support details relevant to this request",
  );
  return unique(guidance).join("; ");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
