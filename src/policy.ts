import type {
  ApprovedField,
  RequiredEscalation,
  Ticket,
  TriageRecommendation,
} from "./domain.js";
import { DomainError } from "./errors.js";

export interface EscalationDecision {
  required: boolean;
  reasons: RequiredEscalation[];
  requiredTeam?: "security" | "incident-response";
}

const APPROVABLE_FIELDS = new Set<ApprovedField>([
  "category",
  "priority",
  "team",
  "assignee",
  "status",
  "tags",
  "customerResponse",
]);

export function evaluateEscalation(
  recommendation: TriageRecommendation,
  now: Date,
  ticket: Ticket,
): EscalationDecision {
  if (Number.isNaN(now.getTime())) {
    throw new DomainError(
      "Escalation evaluation requires a valid current time.",
      "INVALID_NOW",
    );
  }

  const reasons: RequiredEscalation[] = [];
  let requiredTeam: EscalationDecision["requiredTeam"];

  if (recommendation.securityRisk !== "none") {
    reasons.push("security");
    requiredTeam = "security";
  }

  if (
    recommendation.outageRisk === "likely" ||
    recommendation.outageRisk === "confirmed"
  ) {
    reasons.push("outage");
    requiredTeam ??= "incident-response";
  }

  if (recommendation.confidence < 0.75) {
    reasons.push("low-confidence");
  }

  const warningDeadline = now.getTime() + 60 * 60 * 1000;
  if (
    ticket.sla.breached ||
    new Date(ticket.sla.responseDueAt).getTime() <= warningDeadline
  ) {
    reasons.push("sla");
  }

  const highImpact =
    recommendation.priority === "P1" ||
    recommendation.priority === "P2" ||
    recommendation.securityRisk !== "none" ||
    recommendation.outageRisk !== "none";
  if (highImpact && recommendation.missingInformation.length > 0) {
    reasons.push("missing-information");
  }

  if (recommendation.escalationReasons.includes("policy-conflict")) {
    reasons.push("policy-conflict");
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    required: uniqueReasons.length > 0,
    reasons: uniqueReasons,
    ...(requiredTeam === undefined ? {} : { requiredTeam }),
  };
}

export function validateApprovedFields(
  recommendation: TriageRecommendation,
  approvedFields: readonly string[],
): void {
  if (approvedFields.length === 0) {
    throw new DomainError(
      "At least one approved field is required.",
      "INVALID_APPROVAL_FIELDS",
    );
  }

  if (new Set(approvedFields).size !== approvedFields.length) {
    throw new DomainError(
      "Approved fields must be unique.",
      "INVALID_APPROVAL_FIELDS",
    );
  }

  const unknownField = approvedFields.find(
    (field) => !APPROVABLE_FIELDS.has(field as ApprovedField),
  );
  if (unknownField !== undefined) {
    throw new DomainError(
      `Field is not approvable: ${unknownField}`,
      "INVALID_APPROVAL_FIELDS",
    );
  }

  const missingProposal = approvedFields.find(
    (field) =>
      (field === "assignee" &&
        !Object.hasOwn(recommendation, "assignee")) ||
      (field === "status" &&
        !Object.hasOwn(recommendation, "ticketStatus")) ||
      (field === "tags" && !Object.hasOwn(recommendation, "tags")),
  );
  if (missingProposal !== undefined) {
    throw new DomainError(
      `Approved field has no proposal: ${missingProposal}`,
      "INVALID_APPROVAL_FIELDS",
    );
  }
}
