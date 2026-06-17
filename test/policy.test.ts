import { describe, expect, it } from "vitest";
import type { Ticket, TriageRecommendation } from "../src/domain.js";
import { DomainError } from "../src/errors.js";
import { evaluateEscalation, validateApprovedFields } from "../src/policy.js";

const now = new Date("2026-06-10T09:00:00.000Z");

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "TKT-1001",
    createdAt: "2026-06-10T08:00:00.000Z",
    updatedAt: "2026-06-10T08:30:00.000Z",
    customer: {
      name: "Northstar Labs",
      plan: "enterprise",
      region: "eu-west",
      vip: false,
    },
    subject: "API requests return 503",
    description: "Production requests fail consistently.",
    status: "triage",
    tags: [],
    sla: {
      responseDueAt: "2026-06-10T12:00:00.000Z",
      breached: false,
    },
    relatedTicketIds: [],
    revision: 2,
    ...overrides,
  };
}

function makeRecommendation(
  overrides: Partial<TriageRecommendation> = {},
): TriageRecommendation {
  return {
    id: "d61bba15-41f4-495b-a794-93696343cc9d",
    ticketId: "TKT-1001",
    sourceRevision: 2,
    category: "api",
    priority: "P3",
    team: "api-platform",
    duplicateCandidates: [],
    outageRisk: "none",
    securityRisk: "none",
    slaRisk: "none",
    missingInformation: [],
    knowledgeArticleIds: [],
    draftCustomerResponse: "We are investigating your report.",
    rationale: "The symptoms point to an API issue.",
    confidence: 0.9,
    recommendedNextAction: "Review API request logs.",
    escalationRequired: false,
    escalationReasons: [],
    resolution: "pending",
    createdAt: "2026-06-10T08:35:00.000Z",
    ...overrides,
  };
}

describe("evaluateEscalation", () => {
  it("rejects an invalid current time with a stable domain error", () => {
    expect(() =>
      evaluateEscalation(
        makeRecommendation(),
        new Date(Number.NaN),
        makeTicket(),
      ),
    ).toThrow(
      expect.objectContaining({
        name: "DomainError",
        code: "INVALID_NOW",
        message: "Escalation evaluation requires a valid current time.",
      }),
    );
  });

  it("does not escalate an ordinary recommendation", () => {
    expect(evaluateEscalation(makeRecommendation(), now, makeTicket())).toEqual({
      required: false,
      reasons: [],
    });
  });

  it.each(["possible", "likely", "confirmed"] as const)(
    "routes %s security risk to security",
    (securityRisk) => {
      expect(
        evaluateEscalation(
          makeRecommendation({ securityRisk }),
          now,
          makeTicket(),
        ),
      ).toEqual({
        required: true,
        reasons: ["security"],
        requiredTeam: "security",
      });
    },
  );

  it.each(["likely", "confirmed"] as const)(
    "routes %s outage risk to incident response",
    (outageRisk) => {
      expect(
        evaluateEscalation(makeRecommendation({ outageRisk }), now, makeTicket()),
      ).toEqual({
        required: true,
        reasons: ["outage"],
        requiredTeam: "incident-response",
      });
    },
  );

  it("includes both risk reasons and gives security team precedence", () => {
    expect(
      evaluateEscalation(
        makeRecommendation({
          securityRisk: "possible",
          outageRisk: "confirmed",
        }),
        now,
        makeTicket(),
      ),
    ).toEqual({
      required: true,
      reasons: ["security", "outage"],
      requiredTeam: "security",
    });
  });

  it("escalates confidence below 0.75 but not at the boundary", () => {
    expect(
      evaluateEscalation(
        makeRecommendation({ confidence: 0.749 }),
        now,
        makeTicket(),
      ).reasons,
    ).toContain("low-confidence");
    expect(
      evaluateEscalation(
        makeRecommendation({ confidence: 0.75 }),
        now,
        makeTicket(),
      ).reasons,
    ).not.toContain("low-confidence");
  });

  it.each([
    makeTicket({ sla: { responseDueAt: "2026-06-10T12:00:00.000Z", breached: true } }),
    makeTicket({ sla: { responseDueAt: "2026-06-10T10:00:00.000Z", breached: false } }),
  ])("escalates breached or due-within-60-minutes SLAs", (ticket) => {
    expect(evaluateEscalation(makeRecommendation(), now, ticket).reasons).toContain(
      "sla",
    );
  });

  it("does not escalate an SLA beyond the warning window", () => {
    expect(
      evaluateEscalation(
        makeRecommendation(),
        now,
        makeTicket({
          sla: {
            responseDueAt: "2026-06-10T10:00:00.001Z",
            breached: false,
          },
        }),
      ).reasons,
    ).not.toContain("sla");
  });

  it.each([
    { priority: "P1" as const },
    { priority: "P2" as const },
    { securityRisk: "possible" as const },
    { outageRisk: "possible" as const },
  ])("escalates missing information on high-impact recommendations", (impact) => {
    expect(
      evaluateEscalation(
        makeRecommendation({
          ...impact,
          missingInformation: ["Affected tenant count"],
        }),
        now,
        makeTicket(),
      ).reasons,
    ).toContain("missing-information");
  });

  it("does not escalate missing information on a low-impact recommendation", () => {
    expect(
      evaluateEscalation(
        makeRecommendation({
          priority: "P3",
          missingInformation: ["Browser version"],
        }),
        now,
        makeTicket(),
      ).reasons,
    ).not.toContain("missing-information");
  });

  it("retains an explicit policy conflict without duplicating it", () => {
    expect(
      evaluateEscalation(
        makeRecommendation({
          escalationReasons: ["policy-conflict", "policy-conflict"],
        }),
        now,
        makeTicket(),
      ).reasons,
    ).toEqual(["policy-conflict"]);
  });

  it("does not derive or change priority from VIP status", () => {
    const recommendation = makeRecommendation({ priority: "P4" });
    const decision = evaluateEscalation(
      recommendation,
      now,
      makeTicket({
        customer: {
          name: "Northstar Labs",
          plan: "enterprise",
          region: "eu-west",
          vip: true,
        },
      }),
    );

    expect(decision).toEqual({ required: false, reasons: [] });
    expect(recommendation.priority).toBe("P4");
  });

  it("combines independent escalation reasons in deterministic order", () => {
    expect(
      evaluateEscalation(
        makeRecommendation({
          priority: "P1",
          securityRisk: "possible",
          outageRisk: "likely",
          confidence: 0.5,
          missingInformation: ["Blast radius"],
          escalationReasons: ["policy-conflict"],
        }),
        now,
        makeTicket({
          sla: {
            responseDueAt: "2026-06-10T09:30:00.000Z",
            breached: false,
          },
        }),
      ),
    ).toEqual({
      required: true,
      reasons: [
        "security",
        "outage",
        "low-confidence",
        "sla",
        "missing-information",
        "policy-conflict",
      ],
      requiredTeam: "security",
    });
  });
});

describe("validateApprovedFields", () => {
  it("allows approving an own null assignee proposal to unassign the ticket", () => {
    const recommendation = {
      ...makeRecommendation(),
      assignee: null,
    } as unknown as TriageRecommendation;

    expect(() =>
      validateApprovedFields(recommendation, ["assignee"]),
    ).not.toThrow();
  });

  it("rejects an inherited assignee value as a missing proposal", () => {
    const recommendation = Object.assign(
      Object.create({ assignee: null }) as object,
      makeRecommendation(),
    ) as TriageRecommendation;

    expect(() =>
      validateApprovedFields(recommendation, ["assignee"]),
    ).toThrow(
      expect.objectContaining({
        code: "INVALID_APPROVAL_FIELDS",
        message: "Approved field has no proposal: assignee",
      }),
    );
  });

  it("allows all seven explicitly approvable fields", () => {
    expect(() =>
      validateApprovedFields(
        makeRecommendation({
          assignee: "operator@example.test",
          ticketStatus: "in-progress",
          tags: ["api", "incident"],
        }),
        [
          "category",
          "priority",
          "team",
          "assignee",
          "status",
          "tags",
          "customerResponse",
        ],
      ),
    ).not.toThrow();
  });

  it.each([
    { approvedFields: [] },
    { approvedFields: ["priority", "priority"] },
    { approvedFields: ["description"] },
  ])("rejects empty, duplicate, or unknown fields", ({ approvedFields }) => {
    let thrown: unknown;
    try {
      validateApprovedFields(makeRecommendation(), approvedFields);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown).toMatchObject({ code: "INVALID_APPROVAL_FIELDS" });
  });

  it.each([
    ["assignee", "assignee"],
    ["status", "ticketStatus"],
    ["tags", "tags"],
  ] as const)(
    "rejects approval of %s when recommendation.%s is absent",
    (approvedField, proposalField) => {
      expect(() =>
        validateApprovedFields(makeRecommendation(), [approvedField]),
      ).toThrow(
        expect.objectContaining({
          code: "INVALID_APPROVAL_FIELDS",
          message: `Approved field has no proposal: ${approvedField}`,
        }),
      );
    },
  );
});
