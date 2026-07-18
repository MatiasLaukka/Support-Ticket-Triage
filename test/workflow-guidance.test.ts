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

function diagnosisRecordedWorkflow(): WorkflowInput {
  const input = diagnosisReadyWorkflow();
  return {
    ...input,
    audits: [
      audit("recommendation-submitted", "2026-06-10T09:00:00.000Z", {
        recommendationId,
      }),
      ...input.audits,
      diagnosisAudit({
        timestamp: "2026-06-10T09:02:00.000Z",
        confidence: "likely",
        owner: "support",
      }),
    ],
  };
}

function verificationWorkflow(): WorkflowInput {
  const input = confirmedEngineeringDiagnosisWorkflow();
  return {
    ...input,
    audits: [
      audit("recommendation-submitted", "2026-06-10T09:00:00.000Z", {
        recommendationId,
      }),
      ...input.audits,
      audit("fix-available", "2026-06-10T09:03:00.000Z", {
        after: { fix: { status: "available" } },
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

function waitingCustomerWorkflow(): WorkflowInput {
  return {
    ticket: ticket(),
    recommendations: [
      recommendation({
        supportState: "needs-information",
        missingEvidence: [evidenceRequirement()],
      }),
    ],
    audits: [
      audit("customer-response-sent", "2026-06-10T09:01:00.000Z", {
        recommendationId,
        after: { sentAt: "2026-06-10T09:01:00.000Z" },
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

function evidenceRequirement() {
  return {
    id: "request-id",
    label: "Request ID",
    customerQuestion: "What is the request ID?",
    aliases: ["request id"],
    source: "knowledge" as const,
  };
}

function sentAudit(
  sentAt: string,
  id = recommendationId,
): AuditEvent {
  return audit("customer-response-sent", sentAt, {
    recommendationId: id,
    after: { sentAt },
  });
}

function diagnosisAudit(input: {
  timestamp: string;
  confidence: "confirmed" | "likely";
  owner: "engineering" | "integration-partner" | "support";
}): AuditEvent {
  return audit("diagnosis-completed", input.timestamp, {
    after: {
      diagnosis: {
        status: "completed",
        confidence: input.confidence,
        owner: input.owner,
      },
    },
  });
}

describe("buildOperatorGuidance", () => {
  it.each([
    {
      name: "active",
      input: emptyWorkflow(),
      stage: "active",
      nextAction: "evaluate-ticket",
      unlocksTool: "evaluate_ticket",
      approval: { required: false, fields: [] },
    },
    {
      name: "review",
      input: pendingRecommendationWorkflow(),
      stage: "review",
      nextAction: "review-recommendation",
      unlocksTool: "mark_response_done",
      approval: {
        required: true,
        fields: ["category", "priority", "team", "customerResponse"],
      },
    },
    {
      name: "customer-replied",
      input: repliedWorkflow(),
      stage: "customer-replied",
      nextAction: "evaluate-ticket",
      unlocksTool: "evaluate_ticket",
      approval: { required: false, fields: [] },
    },
    {
      name: "fix-ready",
      input: confirmedEngineeringDiagnosisWorkflow(),
      stage: "fix-ready",
      nextAction: "mark-fix-available",
      unlocksTool: "mark_fix_available",
      approval: { required: false, fields: [] },
    },
    {
      name: "verification",
      input: verificationWorkflow(),
      stage: "verification",
      nextAction: "evaluate-ticket",
      unlocksTool: "evaluate_ticket",
      approval: { required: false, fields: [] },
    },
    {
      name: "diagnosis-recorded",
      input: diagnosisRecordedWorkflow(),
      stage: "diagnosis-recorded",
      nextAction: "evaluate-ticket",
      unlocksTool: "evaluate_ticket",
      approval: { required: false, fields: [] },
    },
    {
      name: "diagnosis-ready",
      input: diagnosisReadyWorkflow(),
      stage: "diagnosis-ready",
      nextAction: "record-diagnosis",
      unlocksTool: "record_diagnosis",
      approval: { required: false, fields: [] },
    },
    {
      name: "waiting-customer",
      input: waitingCustomerWorkflow(),
      stage: "waiting-customer",
      nextAction: "wait-for-customer",
      unlocksTool: undefined,
      approval: { required: false, fields: [] },
    },
    {
      name: "ready-for-close",
      input: closingResponseSentWorkflow(),
      stage: "ready-for-close",
      nextAction: "close-ticket",
      unlocksTool: "close_ticket",
      approval: { required: false, fields: [] },
    },
    {
      name: "closed",
      input: resolvedWorkflow(),
      stage: "closed",
      nextAction: "none",
      unlocksTool: undefined,
      approval: { required: false, fields: [] },
    },
  ] as const)("returns exact $name precedence guidance", (expected) => {
    const guidance = buildOperatorGuidance(expected.input);
    expect(guidance.stage).toBe(expected.stage);
    expect(guidance.nextAction).toBe(expected.nextAction);
    expect(guidance.approval).toEqual(expected.approval);
    if (expected.unlocksTool === undefined) {
      expect(guidance).not.toHaveProperty("unlocksTool");
    } else {
      expect(guidance.unlocksTool).toBe(expected.unlocksTool);
    }
    expect(guidance.reason).not.toBe("");
    expect(guidance.blockers).toEqual(expect.any(Array));
  });

  it("keeps pending review ahead of fix-ready verification context", () => {
    const input = fixResponsePendingWorkflow();
    const guidance = buildOperatorGuidance(input);
    expect(guidance.stage).toBe("review");
    expect(guidance.nextAction).toBe("review-recommendation");
    expect(guidance.unlocksTool).toBe("mark_response_done");
    expect(guidance.approval.required).toBe(true);
  });

  it.each([
    ["diagnosis-recorded", diagnosisRecordedWorkflow()],
    ["verification", verificationWorkflow()],
  ] as const)("returns safe backend-owned %s transition copy", (stage, input) => {
    const guidance = buildOperatorGuidance(input);
    expect(guidance.stage).toBe(stage);
    expect(guidance.changed).not.toBe("");
    expect(guidance.reason).not.toBe("");
    expect(guidance.customerNextStep).not.toBe("");
    expect(guidance.nextAction).toBe("evaluate-ticket");
    expect(guidance.approval).toEqual({ required: false, fields: [] });
    expect(guidance.unlocksTool).toBe("evaluate_ticket");
    expect(guidance.blockers).toEqual([]);
  });

  it("orders equal-time diagnosis transitions by audit index", () => {
    const input = diagnosisRecordedWorkflow();
    const submitted = audit(
      "recommendation-submitted",
      "2026-06-10T09:02:00.000Z",
      { recommendationId },
    );
    const diagnosis = diagnosisAudit({
      timestamp: "2026-06-10T09:02:00.000Z",
      confidence: "likely",
      owner: "support",
    });
    input.recommendations = [
      recommendation({ createdAt: "2026-06-10T09:02:00.000Z" }),
    ];
    input.audits = [sentAudit("2026-06-10T09:01:00.000Z"), submitted, diagnosis];
    expect(buildOperatorGuidance(input).stage).toBe("diagnosis-recorded");

    input.audits = [sentAudit("2026-06-10T09:01:00.000Z"), diagnosis, submitted];
    expect(buildOperatorGuidance(input).stage).toBe("waiting-customer");
  });

  it("orders equal-time fix transitions by audit index", () => {
    const input = verificationWorkflow();
    const submitted = audit(
      "recommendation-submitted",
      "2026-06-10T09:03:00.000Z",
      { recommendationId },
    );
    const fix = audit("fix-available", "2026-06-10T09:03:00.000Z", {
      after: { fix: { status: "available" } },
    });
    input.recommendations = [
      recommendation({ createdAt: "2026-06-10T09:03:00.000Z" }),
    ];
    input.audits = [
      sentAudit("2026-06-10T09:01:00.000Z"),
      diagnosisAudit({
        timestamp: "2026-06-10T09:02:00.000Z",
        confidence: "confirmed",
        owner: "engineering",
      }),
      submitted,
      fix,
    ];
    expect(buildOperatorGuidance(input).stage).toBe("verification");

    input.audits = [
      sentAudit("2026-06-10T09:01:00.000Z"),
      diagnosisAudit({
        timestamp: "2026-06-10T09:02:00.000Z",
        confidence: "confirmed",
        owner: "engineering",
      }),
      fix,
      submitted,
    ];
    expect(buildOperatorGuidance(input).stage).toBe("waiting-customer");
  });

  it.each([
    ["diagnosis-recorded", diagnosisRecordedWorkflow()],
    ["verification", verificationWorkflow()],
  ] as const)("stops the %s transition after a newer recommendation", (_stage, input) => {
    const newer = recommendation({
      id: "10000000-0000-4000-8000-000000000099",
      createdAt: "2026-06-10T09:04:00.000Z",
    });
    input.recommendations = [newer];
    input.audits = [
      ...input.audits,
      audit("recommendation-submitted", newer.createdAt, {
        recommendationId: newer.id,
      }),
    ];

    expect(buildOperatorGuidance(input).stage).toBe("active");
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

  it("normalizes absent ticket and null recommendation assignees", () => {
    const input = pendingRecommendationWorkflow();
    input.ticket = ticket({ assignee: undefined });
    input.recommendations = [
      recommendation({
        resolution: "pending",
        assignee: null,
      }),
    ];

    expect(buildOperatorGuidance(input).approval.fields).toEqual([
      "customerResponse",
    ]);
  });

  it("includes changed assignee and status but excludes unchanged tags", () => {
    const input = pendingRecommendationWorkflow();
    input.recommendations = [
      recommendation({
        resolution: "pending",
        assignee: "new-owner@example.test",
        ticketStatus: "in-progress",
        tags: ["api"],
      }),
    ];

    expect(buildOperatorGuidance(input).approval.fields).toEqual([
      "assignee",
      "status",
      "customerResponse",
    ]);
  });

  it.each([
    {
      name: "unchanged tags",
      tags: ["api", "delay"],
      includesTags: false,
    },
    {
      name: "changed tag order",
      tags: ["delay", "api"],
      includesTags: true,
    },
  ] as const)("applies ordered-array semantics to $name", ({ tags, includesTags }) => {
    const input = pendingRecommendationWorkflow();
    input.ticket = ticket({ tags: ["api", "delay"] });
    input.recommendations = [
      recommendation({ resolution: "pending", tags: [...tags] }),
    ];

    const fields = buildOperatorGuidance(input).approval.fields;
    expect(fields.includes("tags")).toBe(includesTags);
    expect(fields.at(-1)).toBe("customerResponse");
  });

  it("always returns customerResponse last when every proposed field changes", () => {
    const guidance = buildOperatorGuidance({
      ticket: ticket(),
      recommendations: [
        recommendation({
          resolution: "pending",
          category: "incident",
          priority: "P1",
          team: "incident-response",
          assignee: "new-owner@example.test",
          ticketStatus: "in-progress",
          tags: ["incident"],
        }),
      ],
      audits: [],
    });

    expect(guidance.approval.fields).toEqual([
      "category",
      "priority",
      "team",
      "assignee",
      "status",
      "tags",
      "customerResponse",
    ]);
  });

  it("orders equal-time recommendations by submitted audit index", () => {
    const earlier = recommendation({
      id: "10000000-0000-4000-8000-000000000010",
      resolution: "approved",
    });
    const later = recommendation({
      id: "10000000-0000-4000-8000-000000000009",
      resolution: "pending",
    });
    const input = {
      ticket: ticket(),
      recommendations: [later, earlier],
      audits: [
        audit("recommendation-submitted", earlier.createdAt, {
          recommendationId: earlier.id,
        }),
        audit("recommendation-submitted", later.createdAt, {
          recommendationId: later.id,
        }),
      ],
    };

    expect(buildOperatorGuidance(input).stage).toBe("review");
  });

  it("resolves the remaining recommendation tie by descending ID", () => {
    const lower = recommendation({
      id: "10000000-0000-4000-8000-000000000009",
      resolution: "approved",
    });
    const higher = recommendation({
      id: "10000000-0000-4000-8000-000000000010",
      resolution: "pending",
    });

    expect(
      buildOperatorGuidance({
        ticket: ticket(),
        recommendations: [lower, higher],
        audits: [],
      }).stage,
    ).toBe("review");
  });

  it("resolves equal diagnosis timestamps by later audit index", () => {
    const input = diagnosisReadyWorkflow();
    input.audits = [
      ...input.audits,
      diagnosisAudit({
        timestamp: "2026-06-10T09:02:00.000Z",
        confidence: "likely",
        owner: "support",
      }),
      diagnosisAudit({
        timestamp: "2026-06-10T09:02:00.000Z",
        confidence: "confirmed",
        owner: "engineering",
      }),
    ];

    expect(buildOperatorGuidance(input).stage).toBe("fix-ready");
  });

  it("uses strict newer-than comparisons at equal timestamps", () => {
    const replyEqual = {
      ticket: ticket(),
      recommendations: [recommendation()],
      audits: [
        audit("customer-reply-received", "2026-06-10T09:00:00.000Z"),
      ],
    };
    expect(buildOperatorGuidance(replyEqual).stage).toBe("active");

    const diagnosisEqual = diagnosisReadyWorkflow();
    diagnosisEqual.audits = [
      sentAudit("2026-06-10T09:01:00.000Z"),
      diagnosisAudit({
        timestamp: "2026-06-10T09:01:00.000Z",
        confidence: "confirmed",
        owner: "engineering",
      }),
    ];
    expect(buildOperatorGuidance(diagnosisEqual).stage).toBe("fix-ready");

    const fixEqual = confirmedEngineeringDiagnosisWorkflow();
    fixEqual.audits = [
      sentAudit("2026-06-10T09:01:00.000Z"),
      diagnosisAudit({
        timestamp: "2026-06-10T09:02:00.000Z",
        confidence: "confirmed",
        owner: "engineering",
      }),
      audit("fix-available", "2026-06-10T09:02:00.000Z", {
        after: { fix: { status: "available" } },
      }),
    ];
    expect(buildOperatorGuidance(fixEqual).stage).toBe("verification");
  });

  it("uses first-match precedence for resolved and ready-to-close tickets", () => {
    expect(buildOperatorGuidance(resolvedWorkflow()).stage).toBe("closed");
    expect(buildOperatorGuidance(closingResponseSentWorkflow()).stage).toBe(
      "ready-for-close",
    );
  });
});

describe("shared lifecycle blockers", () => {
  it("returns exact diagnosis blocker arrays in enforced order", () => {
    expect(diagnosisBlockers({ recommendation: undefined, audits: [] })).toEqual([
      "A completed evaluation is required before diagnosis.",
    ]);

    expect(
      diagnosisBlockers({
        recommendation: recommendation({
          missingEvidence: [evidenceRequirement()],
          supportState: "needs-information",
        }),
        audits: [],
      }),
    ).toEqual([
      "Diagnosis requires all required evidence to be gathered.",
      "Diagnosis requires a diagnosis-ready ticket state.",
      "The evaluated response must be marked done before diagnosis.",
    ]);

    expect(
      diagnosisBlockers({
        recommendation: recommendation(),
        audits: [
          sentAudit("2026-06-10T09:01:00.000Z"),
          audit("customer-reply-received", "2026-06-10T09:02:00.000Z"),
        ],
      }),
    ).toEqual(["Evaluate the latest customer reply before diagnosis."]);

    expect(
      diagnosisBlockers({
        recommendation: recommendation(),
        audits: [
          sentAudit("2026-06-10T09:01:00.000Z"),
          diagnosisAudit({
            timestamp: "2026-06-10T09:02:00.000Z",
            confidence: "likely",
            owner: "support",
          }),
        ],
      }),
    ).toEqual([
      "Diagnosis has already been recorded for the latest context.",
    ]);

    const ready = diagnosisReadyWorkflow();
    expect(
      diagnosisBlockers({
        recommendation: ready.recommendations[0],
        audits: ready.audits,
      }),
    ).toEqual([]);
  });

  it("returns exact fix blocker arrays in enforced order", () => {
    expect(fixBlockers({ audits: [] })).toEqual([
      "A completed diagnosis is required before marking a fix available.",
    ]);

    expect(
      fixBlockers({
        audits: [
          diagnosisAudit({
            timestamp: "2026-06-10T09:02:00.000Z",
            confidence: "likely",
            owner: "support",
          }),
          audit("fix-available", "2026-06-10T09:03:00.000Z", {
            after: { fix: { status: "available" } },
          }),
        ],
      }),
    ).toEqual([
      "A confirmed diagnosis is required before marking a fix available.",
      "This confirmed diagnosis does not require a platform fix.",
      "A fix has already been recorded for the latest diagnosis.",
    ]);

    const input = confirmedEngineeringDiagnosisWorkflow();
    expect(fixBlockers({ audits: input.audits })).toEqual([]);
  });

  it("returns exact close blocker arrays in enforced order", () => {
    expect(
      closeBlockers({
        ticket: ticket({ status: "resolved" }),
        recommendation: undefined,
        audits: [],
      }),
    ).toEqual([
      "Ticket is already closed.",
      "Ticket must have a ready-to-close recommendation before it can be closed.",
      "The ready-to-close response must be marked done before the ticket can be closed.",
    ]);

    expect(
      closeBlockers({
        ticket: ticket(),
        recommendation: recommendation({ supportState: "ready-for-close" }),
        audits: [],
      }),
    ).toEqual([
      "The ready-to-close response must be marked done before the ticket can be closed.",
    ]);

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
