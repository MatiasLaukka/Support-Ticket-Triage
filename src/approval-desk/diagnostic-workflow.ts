import type { AuditEvent, Ticket, TriageRecommendation } from "../domain.js";
import type { DiagnosisContext, FixContext } from "../triage-service.js";
import { diagnoseFromPlaybook } from "./diagnostic-playbooks.js";
import { getKnownCause } from "./known-cause-catalog.js";

export function diagnosisContextForTicket(
  ticket: Ticket,
  recommendation: TriageRecommendation,
  audits: readonly AuditEvent[] = [],
): DiagnosisContext {
  const playbookDiagnosis = diagnoseFromPlaybook({
    ticket,
    recommendation,
    customerReplyText: customerReplyTextFromAudits(ticket.id, audits),
  });
  if (playbookDiagnosis !== undefined) {
    return playbookDiagnosis;
  }

  if (
    recommendation.supportState === "known-cause" &&
    recommendation.knownCause !== undefined &&
    recommendation.knownCause !== null
  ) {
    const knownCause = getKnownCause(recommendation.knownCause);
    if (knownCause !== undefined) {
      return {
        status: "completed",
        causeType: recommendation.category === "integration" ? "integration" : "configuration",
        customerSafeSummary: knownCause.problemSummary,
        evidenceUsed: providedEvidenceLabels(recommendation, knownCause.label),
        confidence: "confirmed",
        owner: recommendation.team === "integrations" ? "integration-partner" : "support",
        recommendedNextAction: knownCause.nextStep,
        doNotSay: [
          "Do not ask for unrelated diagnostics after a known cause is confirmed.",
        ],
      };
    }
  }

  if (recommendation.supportState === "waiting-on-platform-fix") {
    return {
      status: "completed",
      causeType: "platform-delay",
      customerSafeSummary:
        "The evidence points to a platform-side processing delay affecting checkout event processing and profile timeline updates.",
      evidenceUsed: providedEvidenceLabels(recommendation, "provided customer evidence"),
      confidence: "likely",
      owner: "engineering",
      recommendedNextAction:
        "Complete platform mitigation before asking the customer to verify the affected examples.",
      doNotSay: ["Do not claim a final root cause until mitigation is available."],
    };
  }

  return {
    status: "completed",
    causeType: recommendation.category === "security" ? "security" : "configuration",
    customerSafeSummary:
      "The support team has completed the investigation and identified the most likely cause from the provided evidence.",
    evidenceUsed: providedEvidenceLabels(
      recommendation,
      recommendation.knownCause === undefined || recommendation.knownCause === null
        ? "provided customer evidence"
        : "known cause match",
    ),
    confidence: "likely",
    owner: recommendation.category === "integration" ? "integration-partner" : "support",
    recommendedNextAction:
      "Share the diagnosis with the customer and explain the next safe action.",
    doNotSay: ["Do not claim a fix until a fix event is recorded."],
  };
}

export function fixContextForTicket(
  ticket: Ticket,
  diagnosisEvent: AuditEvent,
): FixContext {
  const diagnosis = diagnosisFromAudit(diagnosisEvent);
  if (isCampaignEditorDiagnosis(diagnosis)) {
    return {
      status: "available",
      customerSafeSummary:
        "The campaign editor loading mitigation has been applied for the affected campaign.",
      customerAction:
        "Please reopen the Summer Flash Sale campaign editor in Chrome and try editing the campaign again.",
      verificationRequest:
        "Let us know whether the editor now loads normally or if the blank page still appears.",
    };
  }

  if (
    typeof diagnosisEvent.after.diagnosis === "object" &&
    diagnosisEvent.after.diagnosis !== null &&
    "causeType" in diagnosisEvent.after.diagnosis &&
    diagnosisEvent.after.diagnosis.causeType === "platform-delay"
  ) {
    return {
      status: "available",
      customerSafeSummary:
        "The event-processing delay mitigation has been applied for the affected store events.",
      customerAction:
        "Please check the affected profile timelines again using the same store URL, profile, and event example you shared with us.",
      verificationRequest:
        "Let us know whether the delayed checkout events now appear correctly or if any examples are still missing.",
    };
  }

  const diagnosisSummary =
    diagnosis !== undefined && typeof diagnosis.customerSafeSummary === "string"
      ? diagnosis.customerSafeSummary
      : "the diagnosed issue";

  return {
    status: "available",
    customerSafeSummary: `A fix or mitigation is now available for ${diagnosisSummary}`,
    customerAction:
      "Please retry the affected workflow using the same example you shared with us.",
    verificationRequest:
      "Let us know whether the issue is resolved or if you still see the same behavior.",
  };
}

function diagnosisFromAudit(event: AuditEvent): Record<string, unknown> | undefined {
  return typeof event.after.diagnosis === "object" && event.after.diagnosis !== null
    ? event.after.diagnosis as Record<string, unknown>
    : undefined;
}

function isCampaignEditorDiagnosis(
  diagnosis: Record<string, unknown> | undefined,
): boolean {
  return (
    diagnosis?.causeType === "performance" &&
    diagnosis?.owner === "engineering" &&
    typeof diagnosis.customerSafeSummary === "string" &&
    /\bcampaign editor\b/i.test(diagnosis.customerSafeSummary)
  );
}

function providedEvidenceLabels(
  recommendation: TriageRecommendation,
  fallback: string,
): string[] {
  const labels = recommendation.providedEvidence?.map((item) => item.label) ?? [];
  return labels.length > 0 ? labels : [fallback];
}

function customerReplyTextFromAudits(
  ticketId: string,
  audits: readonly AuditEvent[],
): string {
  return audits
    .filter(
      (event) =>
        event.ticketId === ticketId &&
        event.action === "customer-reply-received" &&
        typeof event.after.body === "string",
    )
    .map((event) => event.after.body as string)
    .join("\n\n");
}
