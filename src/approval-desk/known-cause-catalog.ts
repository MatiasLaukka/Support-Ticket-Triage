import type { ExpectedOutcome, Ticket } from "../domain.js";

export interface KnownCauseDefinition {
  id: string;
  label: string;
  knowledgeArticleIds: readonly string[];
  requiredEvidenceIds: readonly string[];
  matchAll: readonly string[];
  problemSummary: string;
  nextStep: string;
  investigationSteps: readonly string[];
}

export const KNOWN_CAUSES: readonly KnownCauseDefinition[] = [
  {
    id: "sms-quiet-hours",
    label: "SMS quiet-hour protection",
    knowledgeArticleIds: ["sms-compliance"],
    requiredEvidenceIds: [],
    matchAll: ["quiet-hour", "blocked"],
    problemSummary:
      "We reviewed the SMS campaign issue, and the dashboard message indicates quiet-hour protection blocked delivery.",
    nextStep:
      "This looks like expected compliance behavior for an SMS campaign scheduled during restricted sending hours. Please reschedule the campaign for an eligible sending window or review the account quiet-hour settings before attempting another send.",
    investigationSteps: [
      "Explain quiet-hour protection and ask the customer to reschedule for an eligible sending window.",
    ],
  },
  {
    id: "webhook-secret-rotation",
    label: "Webhook secret rotation mismatch",
    knowledgeArticleIds: ["webhook-signature-validation"],
    requiredEvidenceIds: [
      "endpoint-url",
      "delivery-id",
      "signing-secret-rotation-time",
      "raw-body-change-status",
    ],
    matchAll: ["webhook", "signature", "secret rotation"],
    problemSummary:
      "The webhook signature failures match a common post-rotation issue where the sender and receiving endpoint are not validating with the same active signing secret.",
    nextStep:
      "Please confirm the receiving endpoint is using the current signing secret, then retry one delivery after verifying raw request-body handling has not changed.",
    investigationSteps: [
      "Confirm the endpoint validates with the current signing secret.",
      "Compare one failed delivery against the signing-secret rotation time and raw body handling.",
    ],
  },
];

export function detectKnownCause(input: {
  ticket: Ticket;
  outcome: ExpectedOutcome;
}): KnownCauseDefinition | undefined {
  const text = ticketText(input.ticket);
  return KNOWN_CAUSES.find((cause) =>
    cause.knowledgeArticleIds.every((articleId) =>
      input.outcome.knowledgeArticleIds.includes(articleId),
    ) &&
    cause.matchAll.every((term) => text.includes(term)),
  );
}

export function getKnownCause(id: string | null | undefined): KnownCauseDefinition | undefined {
  if (id === undefined || id === null) {
    return undefined;
  }
  return KNOWN_CAUSES.find((cause) => cause.id === id);
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
