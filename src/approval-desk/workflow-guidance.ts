import { z } from "zod";
import {
  ApprovedFieldSchema,
  type ApprovedField,
  type AuditEvent,
  type Ticket,
  type TriageRecommendation,
} from "../domain.js";
import type { DiagnosisContext } from "../triage-service.js";
import { diagnosisContextForTicket } from "./diagnostic-workflow.js";
import { DiagnosticStateSnapshotSchema } from "./diagnostic-state.js";

export const OperatorGuidanceSchema = z
  .object({
    stage: z.enum([
      "active",
      "review",
      "waiting-customer",
      "customer-replied",
      "diagnosis-ready",
      "diagnosis-recorded",
      "fix-ready",
      "verification",
      "ready-for-close",
      "closed",
    ]),
    changed: z.string().trim().min(1),
    nextAction: z.enum([
      "evaluate-ticket",
      "review-recommendation",
      "wait-for-customer",
      "record-diagnosis",
      "mark-fix-available",
      "close-ticket",
      "none",
    ]),
    reason: z.string().trim().min(1),
    approval: z
      .object({
        required: z.boolean(),
        fields: z.array(ApprovedFieldSchema),
      })
      .strict(),
    unlocksTool: z
      .enum([
        "evaluate_ticket",
        "mark_response_done",
        "record_diagnosis",
        "mark_fix_available",
        "close_ticket",
      ])
      .optional(),
    blockers: z.array(z.string().trim().min(1)),
    customerNextStep: z.string().trim().min(1).optional(),
  })
  .strict();

export type OperatorGuidance = z.infer<typeof OperatorGuidanceSchema>;

interface RecommendationBlockerInput {
  recommendation: TriageRecommendation | undefined;
  audits: readonly AuditEvent[];
}

export function diagnosisBlockers(
  input: RecommendationBlockerInput,
): string[] {
  const { recommendation, audits } = input;
  if (recommendation === undefined) {
    return ["A completed evaluation is required before diagnosis."];
  }

  const blockers: string[] = [];
  const knownCauseReady = recommendation.supportState === "known-cause";
  if (!knownCauseReady && (recommendation.missingEvidence?.length ?? 0) > 0) {
    blockers.push("Diagnosis requires all required evidence to be gathered.");
  }
  if (
    !knownCauseReady &&
    !["diagnosing", "waiting-on-platform-fix"].includes(
      recommendation.supportState ?? "",
    )
  ) {
    blockers.push("Diagnosis requires a diagnosis-ready ticket state.");
  }
  const sentAt = latestSentAtForRecommendation(audits, recommendation.id);
  if (sentAt === undefined) {
    blockers.push("The evaluated response must be marked done before diagnosis.");
  }
  const latestReplyAt = latestAuditTimestamp(
    audits,
    "customer-reply-received",
  );
  if (
    sentAt !== undefined &&
    latestReplyAt !== undefined &&
    latestReplyAt > sentAt
  ) {
    blockers.push("Evaluate the latest customer reply before diagnosis.");
  }
  const latestDiagnosisAt = latestAuditTimestamp(audits, "diagnosis-completed");
  if (
    latestDiagnosisAt !== undefined &&
    (latestReplyAt === undefined || latestDiagnosisAt > latestReplyAt)
  ) {
    blockers.push("Diagnosis has already been recorded for the latest context.");
  }
  return blockers;
}

export function fixBlockers(input: { audits: readonly AuditEvent[] }): string[] {
  const latestDiagnosis = latestDiagnosisAudit(input.audits);
  if (latestDiagnosis === undefined) {
    return ["A completed diagnosis is required before marking a fix available."];
  }

  const blockers: string[] = [];
  const diagnosis = diagnosisFromAudit(latestDiagnosis);
  if (diagnosis?.confidence !== "confirmed") {
    blockers.push(
      "A confirmed diagnosis is required before marking a fix available.",
    );
  }
  if (
    !["engineering", "integration-partner"].includes(
      String(diagnosis?.owner),
    )
  ) {
    blockers.push("This confirmed diagnosis does not require a platform fix.");
  }
  const diagnosticState = diagnosticStateFromDiagnosis(diagnosis);
  if (diagnosticState?.state === "ambiguous") {
    blockers.push(
      "A diagnosis with unresolved plausible causes cannot unlock a fix.",
    );
  }
  const latestFixAt = latestAuditTimestamp(input.audits, "fix-available");
  if (latestFixAt !== undefined && latestFixAt > latestDiagnosis.timestamp) {
    blockers.push("A fix has already been recorded for the latest diagnosis.");
  }
  const sentAt = latestAuditTimestamp(input.audits, "customer-response-sent");
  if (sentAt === undefined || sentAt < latestDiagnosis.timestamp) {
    blockers.push("Send the diagnosis response before marking a fix available.");
  }
  const latestReplyAt = latestAuditTimestamp(
    input.audits,
    "customer-reply-received",
  );
  if (sentAt !== undefined && latestReplyAt !== undefined && latestReplyAt > sentAt) {
    blockers.push("Evaluate the latest customer reply before marking a fix available.");
  }
  return blockers;
}

export function closeBlockers(input: {
  ticket: Ticket;
  recommendation: TriageRecommendation | undefined;
  audits: readonly AuditEvent[];
}): string[] {
  const blockers: string[] = [];
  if (input.ticket.status === "resolved") {
    blockers.push("Ticket is already closed.");
  }
  const latestDiagnosis = latestDiagnosisAudit(input.audits);
  const diagnosticState = diagnosticStateFromDiagnosis(
    latestDiagnosis === undefined ? undefined : diagnosisFromAudit(latestDiagnosis),
  );
  if (diagnosticState?.state === "ambiguous") {
    blockers.push("An ambiguous diagnosis cannot unlock ticket closure.");
  }
  if (input.recommendation?.supportState !== "ready-for-close") {
    blockers.push(
      "Ticket must have a ready-to-close recommendation before it can be closed.",
    );
  }
  if (
    input.recommendation === undefined ||
    latestSentAtForRecommendation(input.audits, input.recommendation.id) ===
      undefined
  ) {
    blockers.push(
      "The ready-to-close response must be marked done before the ticket can be closed.",
    );
  }
  return blockers;
}

export function buildOperatorGuidance(input: {
  ticket: Ticket;
  recommendations: readonly TriageRecommendation[];
  audits: readonly AuditEvent[];
}): OperatorGuidance {
  const latest = latestCurrentRecommendation(input);
  const latestDiagnosticContext =
    latest === undefined
      ? undefined
      : diagnosisContextForTicket(input.ticket, latest, input.audits);
  const noApproval = { required: false as const, fields: [] as ApprovedField[] };

  if (input.ticket.status === "resolved") {
    return OperatorGuidanceSchema.parse({
      stage: "closed",
      changed: "The ticket is resolved.",
      nextAction: "none",
      reason: "The governed ticket lifecycle is complete.",
      approval: noApproval,
      blockers: [],
    });
  }

  const closingBlockers = closeBlockers({
    ticket: input.ticket,
    recommendation: latest,
    audits: input.audits,
  });
  if (closingBlockers.length === 0) {
    return OperatorGuidanceSchema.parse({
      stage: "ready-for-close",
      changed: "The ready-to-close response was sent.",
      nextAction: "close-ticket",
      reason: "All enforced close-ticket preconditions are satisfied.",
      approval: noApproval,
      unlocksTool: "close_ticket",
      blockers: [],
    });
  }

  const latestReplyAt = latestAuditTimestamp(
    input.audits,
    "customer-reply-received",
  );
  if (
    latestReplyAt !== undefined &&
    (latest === undefined || latestReplyAt > latest.createdAt)
  ) {
    return OperatorGuidanceSchema.parse({
      stage: "customer-replied",
      changed: "The customer replied after the latest evaluation.",
      nextAction: "evaluate-ticket",
      reason:
        "The latest customer context must be evaluated before lifecycle work continues.",
      approval: noApproval,
      unlocksTool: "evaluate_ticket",
      blockers: [],
    });
  }

  if (latest?.resolution === "pending") {
    return OperatorGuidanceSchema.parse({
      stage: "review",
      changed: "A pending recommendation is awaiting human review.",
      nextAction: "review-recommendation",
      reason:
        "Explicit approval is required before applying fields or sending a response.",
      approval: {
        required: true,
        fields: changedApprovalFields(input.ticket, latest),
      },
      unlocksTool: "mark_response_done",
      blockers: [],
    });
  }

  const latestFix = latestFixAudit(input.audits);
  const hasNewerFix = isAuditNewerThanRecommendation(
    latestFix,
    latest,
    input.audits,
  );
  const fixingBlockers = fixBlockers({ audits: input.audits });
  if (fixingBlockers.length === 0 && !hasNewerFix) {
    return OperatorGuidanceSchema.parse({
      stage: "fix-ready",
      changed: "A confirmed platform-owned diagnosis was recorded.",
      nextAction: "mark-fix-available",
      reason: "All enforced fix-available preconditions are satisfied.",
      approval: noApproval,
      unlocksTool: "mark_fix_available",
      blockers: [],
    });
  }

  if (hasNewerFix) {
    return OperatorGuidanceSchema.parse({
      stage: "verification",
      changed: "A fix was recorded after the latest evaluation.",
      nextAction: "evaluate-ticket",
      reason:
        "The recorded fix must be evaluated before preparing customer verification.",
      approval: noApproval,
      unlocksTool: "evaluate_ticket",
      blockers: [],
      customerNextStep:
        "No customer action is required until support sends the reviewed verification request.",
    });
  }

  const latestDiagnosis = latestDiagnosisAudit(input.audits);
  if (
    isAuditNewerThanRecommendation(
      latestDiagnosis,
      latest,
      input.audits,
    )
  ) {
    return OperatorGuidanceSchema.parse({
      stage: "diagnosis-recorded",
      changed: "A diagnosis was recorded after the latest evaluation.",
      nextAction: "evaluate-ticket",
      reason:
        "The recorded diagnosis must be evaluated before preparing the next customer response.",
      approval: noApproval,
      unlocksTool: "evaluate_ticket",
      blockers: [],
      customerNextStep:
        "No customer action is required until support sends the reviewed diagnostic update.",
    });
  }

  const diagnosingBlockers = diagnosisBlockers({
    recommendation: latest,
    audits: input.audits,
  });
  if (diagnosingBlockers.length === 0) {
    return OperatorGuidanceSchema.parse({
      stage: "diagnosis-ready",
      changed: "The latest evaluated response was sent with diagnosis-ready evidence.",
      nextAction: "record-diagnosis",
      reason: "All enforced diagnosis preconditions are satisfied.",
      approval: noApproval,
      unlocksTool: "record_diagnosis",
      blockers: [],
    });
  }

  const latestSentAt =
    latest === undefined
      ? latestAuditTimestamp(input.audits, "customer-response-sent")
      : latestSentAtForRecommendation(input.audits, latest.id);
  if (
    latestSentAt !== undefined &&
    (latestReplyAt === undefined || latestReplyAt <= latestSentAt)
  ) {
    return OperatorGuidanceSchema.parse({
      stage: "waiting-customer",
      changed: "The latest approved response was sent.",
      nextAction: "wait-for-customer",
      reason: "No newer customer reply is available to evaluate.",
      approval: noApproval,
      blockers: diagnosingBlockers,
      customerNextStep: customerNextStepForGuidance(latestDiagnosticContext),
    });
  }

  return OperatorGuidanceSchema.parse({
    stage: "active",
    changed: "The ticket is active without a pending governed step.",
    nextAction: "evaluate-ticket",
    reason: "A fresh evaluation will determine the next governed recommendation.",
    approval: noApproval,
    unlocksTool: "evaluate_ticket",
    blockers: diagnosingBlockers,
  });
}

function customerNextStepForGuidance(
  diagnosis: DiagnosisContext | undefined,
): string {
  const evidenceToRequest =
    diagnosis?.diagnosticState?.state === "ambiguous"
      ? diagnosis.diagnosticState.evidenceToRequest
      : [];
  if (evidenceToRequest.length > 0) {
    return `Reply with the targeted diagnostic details: ${evidenceToRequest.join(" ")}`;
  }
  return "Reply with the requested information or verification result.";
}

function changedApprovalFields(
  ticket: Ticket,
  recommendation: TriageRecommendation,
): ApprovedField[] {
  const fields: ApprovedField[] = [];
  for (const field of ["category", "priority", "team"] as const) {
    if (ticket[field] !== recommendation[field]) {
      fields.push(field);
    }
  }
  if (
    recommendation.assignee !== undefined &&
    (ticket.assignee ?? null) !== recommendation.assignee
  ) {
    fields.push("assignee");
  }
  if (
    recommendation.ticketStatus !== undefined &&
    ticket.status !== recommendation.ticketStatus
  ) {
    fields.push("status");
  }
  if (
    recommendation.tags !== undefined &&
    !arraysEqual(ticket.tags, recommendation.tags)
  ) {
    fields.push("tags");
  }
  fields.push("customerResponse");
  return fields;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function latestCurrentRecommendation(input: {
  ticket: Ticket;
  recommendations: readonly TriageRecommendation[];
  audits: readonly AuditEvent[];
}): TriageRecommendation | undefined {
  const submittedOrder = new Map<string, number>();
  input.audits.forEach((event, index) => {
    if (
      event.action === "recommendation-submitted" &&
      event.recommendationId !== undefined
    ) {
      submittedOrder.set(event.recommendationId, index);
    }
  });
  return input.recommendations
    .filter(
      (recommendation) =>
        recommendation.ticketId === input.ticket.id &&
        ["pending", "approved"].includes(recommendation.resolution),
    )
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        (submittedOrder.get(right.id) ?? -1) -
          (submittedOrder.get(left.id) ?? -1) ||
        right.id.localeCompare(left.id),
    )[0];
}

export function latestDiagnosisAudit(
  audits: readonly AuditEvent[],
): AuditEvent | undefined {
  return audits
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) =>
        event.action === "diagnosis-completed" &&
        typeof event.after.diagnosis === "object" &&
        event.after.diagnosis !== null,
    )
    .sort(
      (left, right) =>
        right.event.timestamp.localeCompare(left.event.timestamp) ||
        right.index - left.index ||
        right.event.id.localeCompare(left.event.id),
    )[0]?.event;
}

function latestFixAudit(audits: readonly AuditEvent[]): AuditEvent | undefined {
  return audits
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) =>
        event.action === "fix-available" &&
        typeof event.after.fix === "object" &&
        event.after.fix !== null,
    )
    .sort(
      (left, right) =>
        right.event.timestamp.localeCompare(left.event.timestamp) ||
        right.index - left.index ||
        right.event.id.localeCompare(left.event.id),
    )[0]?.event;
}

function isAuditNewerThanRecommendation(
  event: AuditEvent | undefined,
  recommendation: TriageRecommendation | undefined,
  audits: readonly AuditEvent[],
): boolean {
  if (event === undefined) {
    return false;
  }
  if (recommendation === undefined) {
    return true;
  }
  return compareWorkflowPosition(
    auditPosition(event, audits),
    recommendationPosition(recommendation, audits),
  ) > 0;
}

interface WorkflowPosition {
  timestamp: string;
  auditIndex: number;
  id: string;
}

function auditPosition(
  event: AuditEvent,
  audits: readonly AuditEvent[],
): WorkflowPosition {
  return {
    timestamp: event.timestamp,
    auditIndex: audits.indexOf(event),
    id: event.id,
  };
}

function recommendationPosition(
  recommendation: TriageRecommendation,
  audits: readonly AuditEvent[],
): WorkflowPosition {
  const submission = audits
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) =>
        event.action === "recommendation-submitted" &&
        event.recommendationId === recommendation.id,
    )
    .sort(
      (left, right) =>
        right.event.timestamp.localeCompare(left.event.timestamp) ||
        right.index - left.index ||
        right.event.id.localeCompare(left.event.id),
    )[0];
  return submission === undefined
    ? {
        timestamp: recommendation.createdAt,
        auditIndex: -1,
        id: recommendation.id,
      }
    : {
        timestamp: submission.event.timestamp,
        auditIndex: submission.index,
        id: submission.event.id,
      };
}

function compareWorkflowPosition(
  left: WorkflowPosition,
  right: WorkflowPosition,
): number {
  return left.timestamp.localeCompare(right.timestamp) ||
    left.auditIndex - right.auditIndex ||
    left.id.localeCompare(right.id);
}

function diagnosisFromAudit(
  event: AuditEvent,
): Record<string, unknown> | undefined {
  return typeof event.after.diagnosis === "object" &&
    event.after.diagnosis !== null
    ? (event.after.diagnosis as Record<string, unknown>)
    : undefined;
}

function diagnosticStateFromDiagnosis(
  diagnosis: Record<string, unknown> | undefined,
) {
  return DiagnosticStateSnapshotSchema.safeParse(
    diagnosis?.diagnosticState,
  ).data;
}

function latestSentAtForRecommendation(
  audits: readonly AuditEvent[],
  recommendationId: string,
): string | undefined {
  return audits
    .filter(
      (event) =>
        event.action === "customer-response-sent" &&
        event.recommendationId === recommendationId,
    )
    .map((event) =>
      typeof event.after.sentAt === "string"
        ? event.after.sentAt
        : event.timestamp,
    )
    .sort((left, right) => right.localeCompare(left))[0];
}

function latestAuditTimestamp(
  audits: readonly AuditEvent[],
  action: AuditEvent["action"],
): string | undefined {
  return audits
    .filter((event) => event.action === action)
    .map((event) =>
      action === "customer-response-sent" &&
      typeof event.after.sentAt === "string"
        ? event.after.sentAt
        : event.timestamp,
    )
    .sort((left, right) => right.localeCompare(left))[0];
}
