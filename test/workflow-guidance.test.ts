import { describe, expect, it } from "vitest";
import {
  AuditEventSchema,
  TicketSchema,
  TriageRecommendationSchema,
  type AuditEvent,
  type Ticket,
  type TriageRecommendation,
} from "../src/domain.js";
import {
  buildOperatorGuidance,
  closeBlockers,
  diagnosisBlockers,
  fixBlockers,
} from "../src/approval-desk/workflow-guidance.js";

const ticketId = "TKT-1001" as const;
const recommendationId = "10000000-0000-4000-8000-000000000001";

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return TicketSchema.parse({
    id: ticketId,
    createdAt: "2026-06-10T08:00:00.000Z",
    updatedAt: "2026-06-10T08:30:00.000Z",
    customer: {
      name: "Northstar Labs",
      plan: "enterprise",
      region: "eu-west",
      vip: false,
    },
    subject: "API requests are delayed",
    description: "Requests complete later than expected.",
    status: "triage",
    category: "api",
    priority: "P3",
    team: "api-platform",
    assignee: "owner@example.test",
    tags: ["api"],
    sla: {
      responseDueAt: "2026-06-10T12:00:00.000Z",
      breached: false,
    },
    relatedTicketIds: [],
    revision: 2,
    ...overrides,
  });
}

function recommendation(
  overrides: Partial<TriageRecommendation> = {},
): TriageRecommendation {
  return TriageRecommendationSchema.parse({
    id: recommendationId,
    ticketId,
    sourceRevision: 2,
    category: "api",
    priority: "P3",
    team: "api-platform",
    assignee: "owner@example.test",
    ticketStatus: "triage",
    tags: ["api"],
    duplicateCandidates: [],
    outageRisk: "none",
    securityRisk: "none",
    slaRisk: "possible",
    missingInformation: [],
    supportState: "diagnosing",
    requiredEvidence: [],
    providedEvidence: [],
    missingEvidence: [],
    knowledgeArticleIds: ["api-reference"],
    draftCustomerResponse: "We are checking the delayed requests.",
    rationale: "The ticket needs a governed support evaluation.",
    confidence: 0.9,
    recommendedNextAction: "Review the request timeline.",
    escalationRequired: false,
    escalationReasons: [],
    resolution: "approved",
    createdAt: "2026-06-10T09:00:00.000Z",
    ...overrides,
  });
}

let nextAuditId = 1;

function audit(
  action: AuditEvent["action"],
  timestamp: string,
  overrides: Partial<AuditEvent> = {},
): AuditEvent {
  return AuditEventSchema.parse({
    id: `20000000-0000-4000-8000-${String(nextAuditId++).padStart(12, "0")}`,
    timestamp,
    actor: "casey",
    action,
    ticketId,
    before: {},
    after: {},
    rationale: "Recorded workflow test context.",
    knowledgeArticleIds: [],
    result: "success",
    ...overrides,
  });
}

type WorkflowInput = Parameters<typeof buildOperatorGuidance>[0];

function emptyWorkflow(): WorkflowInput {
  return { ticket: ticket(), recommendations: [], audits: [] };
}

function pendingRecommendationWorkflow(): WorkflowInput {
  return {
    ticket: ticket(),
    recommendations: [
      recommendation({
        category: "incident",
        priority: "P1",
        team: "incident-response",
        resolution: "pending",
      }),
    ],
    audits: [],
  };
}

function repliedWorkflow(): WorkflowInput {
  return {
    ticket: ticket(),
    recommendations: [recommendation()],
    audits: [audit("customer-reply-received", "2026-06-10T09:01:00.000Z")],
  };
}

function diagnosisReadyWorkflow(): WorkflowInput {
  return {
    ticket: ticket(),
    recommendations: [recommendation()],
    audits: [
      audit("customer-response-sent", "2026-06-10T09:01:00.000Z", {
        recommendationId,
        after: { sentAt: "2026-06-10T09:01:00.000Z" },
      }),
    ],
  };
}

function confirmedEngineeringDiagnosisWorkflow(): WorkflowInput {
  const input = diagnosisReadyWorkflow();
  return {
    ...input,
    audits: [
      ...input.audits,
      audit("diagnosis-completed", "2026-06-10T09:02:00.000Z", {
        after: {
          diagnosis: {
            status: "completed",
            confidence: "confirmed",
            owner: "engineering",
          },
        },
      }),
    ],
  };
}

function fixResponsePendingWorkflow(): WorkflowInput {
  const input = confirmedEngineeringDiagnosisWorkflow();
  return {
    ...input,
    recommendations: [
      recommendation({
        id: "10000000-0000-4000-8000-000000000002",
        resolution: "pending",
        supportState: "ready-for-close",
        createdAt: "2026-06-10T09:04:00.000Z",
      }),
    ],
    audits: [
      ...input.audits,
      audit("fix-available", "2026-06-10T09:03:00.000Z", {
        after: { fix: { status: "available" } },
      }),
    ],
  };
}

function closingResponseSentWorkflow(): WorkflowInput {
  return {
    ticket: ticket(),
    recommendations: [recommendation({ supportState: "ready-for-close" })],
    audits: [
      audit("customer-response-sent", "2026-06-10T09:01:00.000Z", {
        recommendationId,
        after: { sentAt: "2026-06-10T09:01:00.000Z" },
      }),
    ],
  };
}

function resolvedWorkflow(): WorkflowInput {
  return {
    ...closingResponseSentWorkflow(),
    ticket: ticket({ status: "resolved" }),
  };
}

describe("buildOperatorGuidance", () => {
  it.each([
    ["active", emptyWorkflow(), "evaluate-ticket", false],
    ["review", pendingRecommendationWorkflow(), "review-recommendation", true],
    ["customer-replied", repliedWorkflow(), "evaluate-ticket", false],
    ["diagnosis-ready", diagnosisReadyWorkflow(), "record-diagnosis", false],
    ["fix-ready", confirmedEngineeringDiagnosisWorkflow(), "mark-fix-available", false],
    ["verification", fixResponsePendingWorkflow(), "review-recommendation", true],
    ["ready-for-close", closingResponseSentWorkflow(), "close-ticket", false],
    ["closed", resolvedWorkflow(), "none", false],
  ] as const)("returns %s guidance", (_name, input, nextAction, approvalRequired) => {
    const guidance = buildOperatorGuidance(input);
    expect(guidance.nextAction).toBe(nextAction);
    expect(guidance.approval.required).toBe(approvalRequired);
    expect(guidance.reason).not.toBe("");
    expect(guidance.blockers).toEqual(expect.any(Array));
  });

  it("names exact fields awaiting approval", () => {
    const guidance = buildOperatorGuidance(pendingRecommendationWorkflow());
    expect(guidance.approval).toEqual({
      required: true,
      fields: ["category", "priority", "team", "customerResponse"],
    });
    expect(guidance.unlocksTool).toBe("mark_response_done");
  });

  it("excludes omitted and unchanged optional fields from approval", () => {
    const input = pendingRecommendationWorkflow();
    input.recommendations = [
      recommendation({
        resolution: "pending",
        assignee: undefined,
        ticketStatus: undefined,
        tags: undefined,
      }),
    ];

    expect(buildOperatorGuidance(input).approval.fields).toEqual([
      "customerResponse",
    ]);
  });

  it("uses first-match precedence for resolved and ready-to-close tickets", () => {
    expect(buildOperatorGuidance(resolvedWorkflow()).stage).toBe("closed");
    expect(buildOperatorGuidance(closingResponseSentWorkflow()).stage).toBe(
      "ready-for-close",
    );
  });
});

describe("shared lifecycle blockers", () => {
  it("returns diagnosis blockers in the enforced order", () => {
    expect(diagnosisBlockers({ recommendation: undefined, audits: [] })).toEqual([
      "A completed evaluation is required before diagnosis.",
    ]);

    expect(
      diagnosisBlockers({
        recommendation: recommendation({ missingEvidence: [{
          id: "request-id",
          label: "Request ID",
          customerQuestion: "What is the request ID?",
          aliases: ["request id"],
          source: "knowledge",
        }] }),
        audits: [],
      })[0],
    ).toBe("Diagnosis requires all required evidence to be gathered.");
  });

  it("returns fix blockers in the enforced order", () => {
    expect(fixBlockers({ audits: [] })).toEqual([
      "A completed diagnosis is required before marking a fix available.",
    ]);

    const input = confirmedEngineeringDiagnosisWorkflow();
    expect(fixBlockers({ audits: input.audits })).toEqual([]);
  });

  it("returns close blockers in the enforced order", () => {
    expect(
      closeBlockers({
        ticket: ticket({ status: "resolved" }),
        recommendation: recommendation({ supportState: "ready-for-close" }),
        audits: [],
      })[0],
    ).toBe("Ticket is already closed.");

    const input = closingResponseSentWorkflow();
    expect(
      closeBlockers({
        ticket: input.ticket,
        recommendation: input.recommendations[0],
        audits: input.audits,
      }),
    ).toEqual([]);
  });
});
