import { describe, expect, it } from "vitest";
import {
  ApprovalSchema,
  AuditEventSchema,
  CategorySchema,
  DuplicateCandidateSchema,
  ExpectedOutcomeSchema,
  KnowledgeArticleSchema,
  PrioritySchema,
  RequiredEscalationSchema,
  TeamSchema,
  TicketIdSchema,
  TicketSchema,
  TicketStatusSchema,
  TriageRecommendationSchema,
} from "../src/domain.js";
import { DomainError } from "../src/errors.js";

const ticket = {
  id: "TKT-1001",
  createdAt: "2026-06-10T08:00:00.000Z",
  updatedAt: "2026-06-10T08:30:00+00:00",
  customer: {
    name: "Northstar Labs",
    plan: "enterprise",
    region: "eu-west",
    vip: false,
  },
  subject: "API requests return 503",
  description: "Production requests fail consistently.",
  status: "triage",
  category: "api",
  priority: "P1",
  team: "api-platform",
  assignee: "operator@example.test",
  tags: ["api", "outage"],
  sla: {
    responseDueAt: "2026-06-10T09:30:00.000Z",
    breached: false,
  },
  relatedTicketIds: ["TKT-1002"],
  revision: 2,
} as const;

const recommendation = {
  id: "d61bba15-41f4-495b-a794-93696343cc9d",
  ticketId: "TKT-1001",
  sourceRevision: 2,
  category: "incident",
  priority: "P1",
  team: "incident-response",
  duplicateCandidates: [
    {
      ticketId: "TKT-1002",
      confidence: 0.88,
      evidence: "Same region and error signature.",
    },
  ],
  outageRisk: "likely",
  securityRisk: "none",
  slaRisk: "possible",
  missingInformation: [],
  knowledgeArticleIds: ["api-outage-response"],
  draftCustomerResponse: "We are investigating the elevated API errors.",
  rationale: "Multiple reports share a production failure signature.",
  confidence: 0.9,
  recommendedNextAction: "Correlate service telemetry and notify incident response.",
  escalationRequired: true,
  escalationReasons: ["outage"],
  resolution: "pending",
  createdAt: "2026-06-10T08:35:00.000Z",
} as const;

describe("domain contracts", () => {
  it.each([
    "TKT-100",
    "tkt-1001",
    "ABC-1001",
    "TKT-10010",
    "TKT-1001-extra",
  ])("rejects invalid support ticket ID %s", (ticketId) => {
    expect(TicketIdSchema.safeParse(ticketId).success).toBe(false);
  });

  it("parses a complete valid ticket", () => {
    expect(TicketSchema.parse(ticket)).toEqual(ticket);
  });

  it("defaults absent related ticket IDs to an empty array", () => {
    const { relatedTicketIds: _relatedTicketIds, ...withoutRelatedTickets } = ticket;

    expect(TicketSchema.parse(withoutRelatedTickets).relatedTicketIds).toEqual([]);
  });

  it("rejects duplicate related ticket IDs", () => {
    expect(
      TicketSchema.safeParse({
        ...ticket,
        relatedTicketIds: ["TKT-1002", "TKT-1002"],
      }).success,
    ).toBe(false);
  });

  it("rejects tickets updated before they were created with an updatedAt issue", () => {
    const result = TicketSchema.safeParse({
      ...ticket,
      updatedAt: "2026-06-10T07:59:59.999Z",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["updatedAt"],
          message: "updatedAt must be at or after createdAt.",
        }),
      );
    }
  });

  it("rejects an SLA response deadline before ticket creation", () => {
    const result = TicketSchema.safeParse({
      ...ticket,
      sla: {
        ...ticket.sla,
        responseDueAt: "2026-06-10T07:59:59.999Z",
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["sla", "responseDueAt"],
          message: "sla.responseDueAt must be at or after createdAt.",
        }),
      );
    }
  });

  it("represents all optional ticket proposals on a recommendation", () => {
    expect(
      TriageRecommendationSchema.parse({
        ...recommendation,
        assignee: "  operator@example.test  ",
        ticketStatus: "in-progress",
        tags: ["api", "incident"],
      }),
    ).toMatchObject({
      assignee: "operator@example.test",
      ticketStatus: "in-progress",
      tags: ["api", "incident"],
      resolution: "pending",
    });
  });

  it("represents null assignee as an explicit unassignment proposal", () => {
    expect(
      TriageRecommendationSchema.parse({
        ...recommendation,
        assignee: null,
      }),
    ).toMatchObject({
      assignee: null,
    });
  });

  it.each([
    [{ assignee: "   " }, ["assignee"]],
    [{ tags: ["api", "   "] }, ["tags", 1]],
    [{ tags: ["api", "api"] }, ["tags"]],
  ] as const)(
    "rejects invalid optional recommendation proposals",
    (proposal, expectedPath) => {
      const result = TriageRecommendationSchema.safeParse({
        ...recommendation,
        ...proposal,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({ path: expectedPath }),
        );
      }
    },
  );

  it("rejects the old recommendation lifecycle status field", () => {
    const { resolution: _resolution, ...withoutResolution } = recommendation;

    expect(
      TriageRecommendationSchema.safeParse({
        ...withoutResolution,
        status: "pending",
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      escalationRequired: false,
      escalationReasons: ["outage"],
    },
    {
      escalationRequired: true,
      escalationReasons: [],
    },
  ])(
    "rejects contradictory escalation required state",
    ({ escalationRequired, escalationReasons }) => {
      const result = TriageRecommendationSchema.safeParse({
        ...recommendation,
        escalationRequired,
        escalationReasons,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({
            path: ["escalationRequired"],
            message:
              "escalationRequired must match whether escalationReasons is non-empty.",
          }),
        );
      }
    },
  );

  it("rejects unknown and duplicate escalation reasons", () => {
    expect(RequiredEscalationSchema.safeParse("outtage").success).toBe(false);

    const unknownResult = TriageRecommendationSchema.safeParse({
      ...recommendation,
      escalationReasons: ["outtage"],
    });
    expect(unknownResult.success).toBe(false);
    if (!unknownResult.success) {
      expect(
        unknownResult.error.issues.some(
          (issue) => issue.path[0] === "escalationReasons",
        ),
      ).toBe(true);
    }

    const duplicateResult = TriageRecommendationSchema.safeParse({
      ...recommendation,
      escalationReasons: ["outage", "outage"],
    });
    expect(duplicateResult.success).toBe(false);
    if (!duplicateResult.success) {
      expect(duplicateResult.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["escalationReasons"],
          message: "Escalation reasons must be unique.",
        }),
      );
    }
  });

  it("parses valid knowledge, recommendation, approval, audit, and outcome records", () => {
    expect(
      KnowledgeArticleSchema.parse({
        id: "api-outage-response",
        title: "API Outage Response",
        tags: ["api", "incident"],
        body: "# Response\n\nFollow the incident process.",
      }),
    ).toBeTruthy();
    expect(TriageRecommendationSchema.parse(recommendation)).toEqual(recommendation);
    expect(
      ApprovalSchema.parse({
        recommendationId: recommendation.id,
        ticketId: ticket.id,
        expectedRevision: ticket.revision,
        approvedFields: ["category", "priority", "team", "customerResponse"],
        editedCustomerResponse: "We are actively investigating this incident.",
        actor: "casey",
        confirm: true,
        approvedAt: "2026-06-10T08:40:00.000Z",
      }),
    ).toBeTruthy();
    expect(
      AuditEventSchema.parse({
        id: "00c96411-a595-4e2a-8869-c219d7637980",
        timestamp: "2026-06-10T08:40:01.000Z",
        actor: "casey",
        action: "recommendation-approved",
        ticketId: ticket.id,
        recommendationId: recommendation.id,
        before: { priority: "P3" },
        after: { priority: "P1" },
        rationale: "Approved incident routing.",
        knowledgeArticleIds: ["api-outage-response"],
        result: "success",
      }),
    ).toBeTruthy();
    expect(
      ExpectedOutcomeSchema.parse({
        ticketId: ticket.id,
        category: "incident",
        acceptablePriorities: ["P1", "P2"],
        team: "incident-response",
        requiredEscalations: ["outage", "sla"],
        knowledgeArticleIds: ["api-outage-response"],
        duplicateGroup: "eu-api-503",
      }),
    ).toBeTruthy();
  });

  it.each([
    [CategorySchema, "sales"],
    [PrioritySchema, "P0"],
    [TeamSchema, "engineering"],
    [TicketStatusSchema, "closed"],
  ])("rejects invalid enum values", (schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  it.each([-0.01, 1.01])("rejects confidence outside 0..1", (confidence) => {
    expect(
      DuplicateCandidateSchema.safeParse({
        ticketId: "TKT-1002",
        confidence,
        evidence: "Matching symptoms.",
      }).success,
    ).toBe(false);
    expect(
      TriageRecommendationSchema.safeParse({
        ...recommendation,
        confidence,
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate candidates with empty evidence", () => {
    expect(
      DuplicateCandidateSchema.safeParse({
        ticketId: "TKT-1002",
        confidence: 0.8,
        evidence: "   ",
      }).success,
    ).toBe(false);
  });

  it("rejects recommendations without a source revision", () => {
    const { sourceRevision: _sourceRevision, ...missingRevision } = recommendation;

    expect(TriageRecommendationSchema.safeParse(missingRevision).success).toBe(false);
  });

  it.each([
    { approvedFields: [] },
    { approvedFields: ["priority", "priority"] },
    { approvedFields: ["description"] },
  ])("rejects invalid approval fields", ({ approvedFields }) => {
    expect(
      ApprovalSchema.safeParse({
        recommendationId: recommendation.id,
        ticketId: ticket.id,
        expectedRevision: ticket.revision,
        approvedFields,
        actor: "casey",
        confirm: true,
        approvedAt: "2026-06-10T08:40:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("allows a trimmed edited customer response when that field is approved", () => {
    expect(
      ApprovalSchema.parse({
        recommendationId: recommendation.id,
        ticketId: ticket.id,
        expectedRevision: ticket.revision,
        approvedFields: ["customerResponse"],
        editedCustomerResponse: "  We are actively investigating.  ",
        actor: "casey",
        confirm: true,
        approvedAt: "2026-06-10T08:40:00.000Z",
      }).editedCustomerResponse,
    ).toBe("We are actively investigating.");
  });

  it.each([
    {
      approvedFields: ["priority"],
      editedCustomerResponse: "We are actively investigating.",
    },
    {
      approvedFields: ["customerResponse"],
      editedCustomerResponse: "   ",
    },
  ])(
    "rejects invalid edited customer response coupling",
    ({ approvedFields, editedCustomerResponse }) => {
      expect(
        ApprovalSchema.safeParse({
          recommendationId: recommendation.id,
          ticketId: ticket.id,
          expectedRevision: ticket.revision,
          approvedFields,
          editedCustomerResponse,
          actor: "casey",
          confirm: true,
          approvedAt: "2026-06-10T08:40:00.000Z",
        }).success,
      ).toBe(false);
    },
  );

  it("rejects approving customerResponse without edited customer text", () => {
    expect(
      ApprovalSchema.safeParse({
        recommendationId: recommendation.id,
        ticketId: ticket.id,
        expectedRevision: ticket.revision,
        approvedFields: ["customerResponse"],
        actor: "casey",
        confirm: true,
        approvedAt: "2026-06-10T08:40:00.000Z",
      }).success,
    ).toBe(false);
  });

  it.each([
    ["ticket createdAt", { ...ticket, createdAt: "2026-06-10T08:00:00" }],
    ["ticket updatedAt", { ...ticket, updatedAt: "2026-06-10T08:30:00" }],
    [
      "SLA responseDueAt",
      { ...ticket, sla: { ...ticket.sla, responseDueAt: "2026-06-10T09:30:00" } },
    ],
    ["recommendation createdAt", { ...recommendation, createdAt: "2026-06-10T08:35:00" }],
  ])("rejects naive timestamps for %s", (_name, value) => {
    const schema = "sourceRevision" in value ? TriageRecommendationSchema : TicketSchema;
    expect(schema.safeParse(value).success).toBe(false);
  });

  it("rejects naive approval and audit timestamps", () => {
    expect(
      ApprovalSchema.safeParse({
        recommendationId: recommendation.id,
        ticketId: ticket.id,
        expectedRevision: ticket.revision,
        approvedFields: ["priority"],
        actor: "casey",
        confirm: true,
        approvedAt: "2026-06-10T08:40:00",
      }).success,
    ).toBe(false);
    expect(
      AuditEventSchema.safeParse({
        id: "00c96411-a595-4e2a-8869-c219d7637980",
        timestamp: "2026-06-10T08:40:01",
        actor: "casey",
        action: "recommendation-approved",
        ticketId: ticket.id,
        before: {},
        after: {},
        rationale: "Approved incident routing.",
        knowledgeArticleIds: [],
        result: "success",
      }).success,
    ).toBe(false);
  });

  it("requires a rejection reason for rejected audit events", () => {
    const result = AuditEventSchema.safeParse({
      id: "00c96411-a595-4e2a-8869-c219d7637980",
      timestamp: "2026-06-10T08:40:01.000Z",
      actor: "casey",
      action: "approval-rejected",
      ticketId: ticket.id,
      before: {},
      after: {},
      rationale: "Approval could not be applied.",
      knowledgeArticleIds: [],
      result: "rejected",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["rejectionReason"],
          message: "Rejected audit events require a rejectionReason.",
        }),
      );
    }
  });

  it("forbids a rejection reason for successful audit events", () => {
    const result = AuditEventSchema.safeParse({
      id: "00c96411-a595-4e2a-8869-c219d7637980",
      timestamp: "2026-06-10T08:40:01.000Z",
      actor: "casey",
      action: "ticket-updated",
      ticketId: ticket.id,
      before: {},
      after: {},
      rationale: "Ticket fields were updated.",
      knowledgeArticleIds: [],
      result: "success",
      rejectionReason: "Not applicable.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["rejectionReason"],
          message: "Successful audit events must not include rejectionReason.",
        }),
      );
    }
  });

  it.each([
    ["approval-rejected", "success"],
    ["recommendation-submitted", "rejected"],
    ["recommendation-approved", "rejected"],
    ["recommendation-rejected", "rejected"],
    ["ticket-updated", "rejected"],
  ] as const)("rejects result %s/%s contradictions", (action, result) => {
    const parsed = AuditEventSchema.safeParse({
      id: "00c96411-a595-4e2a-8869-c219d7637980",
      timestamp: "2026-06-10T08:40:01.000Z",
      actor: "casey",
      action,
      ticketId: ticket.id,
      before: {},
      after: {},
      rationale: "Audit action result consistency.",
      knowledgeArticleIds: [],
      result,
      ...(result === "rejected"
        ? { rejectionReason: "The operation was rejected." }
        : {}),
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["result"],
          message: "Audit action and result are inconsistent.",
        }),
      );
    }
  });

  it("rejects unknown fields on strict records", () => {
    expect(TicketSchema.safeParse({ ...ticket, unexpected: true }).success).toBe(false);
  });

  it("exposes safe domain error identity and code", () => {
    const error = new DomainError("Approval is stale.", "STALE_APPROVAL");

    expect(error).toMatchObject({
      name: "DomainError",
      message: "Approval is stale.",
      code: "STALE_APPROVAL",
    });
  });

  it.each([
    "INVALID_APPROVAL_FIELDS",
    "INVALID_NOW",
    "STALE_APPROVAL",
  ] as const)("preserves the typed domain error code %s", (code) => {
    expect(new DomainError("Domain failure.", code).code).toBe(code);
  });
});
