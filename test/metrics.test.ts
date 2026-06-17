import { describe, expect, it } from "vitest";
import {
  TicketSchema,
  TriageRecommendationSchema,
  type Ticket,
  type TriageRecommendation,
} from "../src/domain.js";
import { calculateQueueMetrics } from "../src/metrics.js";

const now = new Date("2026-06-10T10:00:00.000Z");

describe("calculateQueueMetrics", () => {
  it("reports queue, SLA, routing, recommendation, confidence, escalation, and savings metrics", () => {
    const tickets = [
      makeTicket("TKT-1001", {
        status: "triage",
        category: "api",
        priority: "P1",
        team: "incident-response",
        sla: {
          responseDueAt: "2026-06-10T09:59:00.000Z",
          breached: false,
        },
      }),
      makeTicket("TKT-1002", {
        status: "new",
        category: undefined,
        priority: undefined,
        team: undefined,
        sla: {
          responseDueAt: "2026-06-10T10:30:00.000Z",
          breached: false,
        },
      }),
      makeTicket("TKT-1003", {
        status: "in-progress",
        category: "security",
        priority: "P2",
        team: "security",
      }),
      makeTicket("TKT-1004", {
        status: "resolved",
        category: "billing",
        priority: "P3",
        team: "billing",
        sla: {
          responseDueAt: "2026-06-10T09:00:00.000Z",
          breached: true,
        },
      }),
    ];
    const recommendations = [
      makeRecommendation("approved", 0.9, ["outage"]),
      makeRecommendation("approved", 0.6, ["low-confidence", "sla"], "TKT-1002"),
      makeRecommendation("rejected", 0.75, ["security"], "TKT-1003"),
      makeRecommendation("pending", 0.95, [], "TKT-1004"),
    ];

    expect(
      calculateQueueMetrics({
        tickets,
        recommendations,
        now,
        minutesPerAcceptedRecommendation: 12,
      }),
    ).toEqual({
      generatedAt: "2026-06-10T10:00:00.000Z",
      openTickets: 3,
      untriagedTickets: 1,
      slaBreachedTickets: 1,
      slaAtRiskTickets: 1,
      ticketsByCategory: { api: 1, security: 1, unassigned: 1 },
      ticketsByPriority: { P1: 1, P2: 1, unassigned: 1 },
      ticketsByTeam: {
        "incident-response": 1,
        security: 1,
        unassigned: 1,
      },
      submittedRecommendations: 4,
      pendingRecommendations: 1,
      approvedRecommendations: 2,
      rejectedRecommendations: 1,
      acceptanceRate: 2 / 3,
      rejectionRate: 1 / 3,
      averageConfidence: 0.8,
      escalationCounts: {
        total: 3,
        outage: 1,
        "low-confidence": 1,
        sla: 1,
        security: 1,
      },
      minutesPerAcceptedRecommendation: 12,
      estimatedMinutesSaved: 24,
    });
  });

  it("uses null rates and confidence when there are no recommendations", () => {
    const metrics = calculateQueueMetrics({
      tickets: [],
      recommendations: [],
      now,
      minutesPerAcceptedRecommendation: 10,
    });

    expect(metrics.acceptanceRate).toBeNull();
    expect(metrics.rejectionRate).toBeNull();
    expect(metrics.averageConfidence).toBeNull();
    expect(metrics.estimatedMinutesSaved).toBe(0);
  });
});

function makeTicket(id: Ticket["id"], overrides: Partial<Ticket> = {}): Ticket {
  return TicketSchema.parse({
    id,
    createdAt: "2026-06-10T08:00:00.000Z",
    updatedAt: "2026-06-10T08:30:00.000Z",
    customer: {
      name: "Example",
      plan: "business",
      region: "eu-west",
      vip: false,
    },
    subject: "Example ticket",
    description: "Example description",
    status: "triage",
    category: "api",
    priority: "P3",
    team: "api-platform",
    tags: [],
    sla: {
      responseDueAt: "2026-06-10T12:00:00.000Z",
      breached: false,
    },
    revision: 0,
    ...overrides,
  });
}

function makeRecommendation(
  resolution: TriageRecommendation["resolution"],
  confidence: number,
  escalationReasons: TriageRecommendation["escalationReasons"],
  ticketId: Ticket["id"] = "TKT-1001",
): TriageRecommendation {
  return TriageRecommendationSchema.parse({
    id:
      ticketId === "TKT-1001"
        ? "11111111-1111-4111-8111-111111111111"
        : ticketId === "TKT-1002"
          ? "22222222-2222-4222-8222-222222222222"
          : ticketId === "TKT-1003"
            ? "33333333-3333-4333-8333-333333333333"
            : "44444444-4444-4444-8444-444444444444",
    ticketId,
    sourceRevision: 0,
    category: "api",
    priority: "P3",
    team: "api-platform",
    duplicateCandidates: [],
    outageRisk: escalationReasons.includes("outage") ? "likely" : "none",
    securityRisk: escalationReasons.includes("security") ? "possible" : "none",
    slaRisk: escalationReasons.includes("sla") ? "likely" : "none",
    missingInformation: [],
    knowledgeArticleIds: [],
    draftCustomerResponse: "We are investigating.",
    rationale: "Concise recommendation rationale.",
    confidence,
    recommendedNextAction: "Review the ticket.",
    escalationRequired: escalationReasons.length > 0,
    escalationReasons,
    resolution,
    createdAt: "2026-06-10T09:00:00.000Z",
  });
}
