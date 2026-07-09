import { describe, expect, it } from "vitest";
import type { AuditEvent } from "../src/domain.js";
import type { QueueMetrics } from "../src/metrics.js";
import { buildAutomationEvidenceReport } from "../src/approval-desk/evidence-report.js";

const generatedAt = "2026-06-10T09:00:00.000Z";

describe("buildAutomationEvidenceReport", () => {
  it("summarizes metrics, audits, guardrails, and recent activity", () => {
    const metrics = makeMetrics({
      openTickets: 7,
      pendingRecommendations: 1,
      approvedRecommendations: 2,
      rejectedRecommendations: 1,
      estimatedMinutesSaved: 16,
      ticketsByCategory: { authentication: 2 },
      ticketsByPriority: { P2: 2 },
      ticketsByTeam: { identity: 2 },
      escalationCounts: { total: 1, sla: 1 },
    });

    const report = buildAutomationEvidenceReport({
      metrics,
      audits: [
        makeAudit({
          action: "recommendation-approved",
          recommendationId: "11111111-1111-4111-8111-111111111111",
          result: "success",
          timestamp: "2026-06-10T09:05:00.000Z",
        }),
        makeAudit({
          action: "approval-rejected",
          recommendationId: "11111111-1111-4111-8111-111111111111",
          result: "rejected",
          timestamp: "2026-06-10T09:04:00.000Z",
          rejectionReason: "Approval revision is stale.",
        }),
      ],
      generatedAt,
    });

    expect(report.generatedAt).toBe(generatedAt);
    expect(report.summary).toEqual({
      openTickets: 7,
      pendingRecommendations: 1,
      approvedRecommendations: 2,
      rejectedRecommendations: 1,
      estimatedMinutesSaved: 16,
      auditEvents: 2,
      safetyBlocks: 1,
      activeGuardrails: 6,
    });
    expect(report.guardrails.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "submission-is-not-mutation", status: "active" },
      { id: "explicit-approval", status: "active" },
      { id: "edited-customer-response", status: "active" },
      { id: "rejection-feedback", status: "active" },
      { id: "untrusted-ticket-text", status: "active" },
      { id: "stale-and-replay-protection", status: "active" },
    ]);
    expect(report.recentActivity).toEqual([
      {
        timestamp: "2026-06-10T09:05:00.000Z",
        action: "recommendation-approved",
        ticketId: "TKT-1001",
        recommendationId: "11111111-1111-4111-8111-111111111111",
        result: "success",
      },
      {
        timestamp: "2026-06-10T09:04:00.000Z",
        action: "approval-rejected",
        ticketId: "TKT-1001",
        recommendationId: "11111111-1111-4111-8111-111111111111",
        result: "rejected",
      },
    ]);
    expect(report.metrics).toEqual(metrics);
    expect(report.metrics).not.toBe(metrics);
    expect(report.metrics.ticketsByCategory).not.toBe(metrics.ticketsByCategory);
    expect(report.metrics.ticketsByPriority).not.toBe(metrics.ticketsByPriority);
    expect(report.metrics.ticketsByTeam).not.toBe(metrics.ticketsByTeam);
    expect(report.metrics.escalationCounts).not.toBe(metrics.escalationCounts);

    metrics.openTickets = 99;
    metrics.ticketsByCategory.authentication = 99;
    metrics.ticketsByPriority.P2 = 99;
    metrics.ticketsByTeam.identity = 99;
    metrics.escalationCounts.total = 99;

    expect(report.metrics.openTickets).toBe(7);
    expect(report.metrics.ticketsByCategory.authentication).toBe(2);
    expect(report.metrics.ticketsByPriority.P2).toBe(2);
    expect(report.metrics.ticketsByTeam.identity).toBe(2);
    expect(report.metrics.escalationCounts.total).toBe(1);
  });

  it("counts only provable blocked safety outcomes", () => {
    const report = buildAutomationEvidenceReport({
      metrics: makeMetrics(),
      audits: [
        makeAudit({ action: "recommendation-rejected", result: "success" }),
        makeAudit({ action: "approval-rejected", result: "rejected" }),
        makeAudit({ action: "recommendation-approved", result: "success" }),
      ],
      generatedAt,
    });

    expect(report.summary.safetyBlocks).toBe(1);
  });

  it("sorts recent activity by parsed timestamp newest-first and limits it to eight events", () => {
    const timestamps = [
      "2026-06-10T04:00:00.000+01:00",
      "2026-06-10T03:30:00.000Z",
      "2026-06-10T05:00:00.000+01:00",
      "2026-06-10T04:30:00.000Z",
      "2026-06-10T06:00:00.000+01:00",
      "2026-06-10T05:30:00.000Z",
      "2026-06-10T07:00:00.000+01:00",
      "2026-06-10T06:30:00.000Z",
      "2026-06-10T09:00:00.000+02:00",
      "2026-06-10T08:30:00.000Z",
    ];
    const audits = timestamps.map((timestamp, index) =>
      makeAudit({
        id: `99999999-9999-4999-8999-9999999999${index.toString().padStart(2, "0")}`,
        timestamp,
      }),
    );

    const report = buildAutomationEvidenceReport({
      metrics: makeMetrics(),
      audits,
      generatedAt,
    });

    expect(report.recentActivity).toHaveLength(8);
    expect(report.recentActivity.map(({ timestamp }) => timestamp)).toEqual([
      "2026-06-10T08:30:00.000Z",
      "2026-06-10T09:00:00.000+02:00",
      "2026-06-10T06:30:00.000Z",
      "2026-06-10T07:00:00.000+01:00",
      "2026-06-10T05:30:00.000Z",
      "2026-06-10T06:00:00.000+01:00",
      "2026-06-10T04:30:00.000Z",
      "2026-06-10T05:00:00.000+01:00",
    ]);
  });
});

function makeMetrics(overrides: Partial<QueueMetrics> = {}): QueueMetrics {
  return {
    generatedAt,
    openTickets: 0,
    untriagedTickets: 0,
    slaBreachedTickets: 0,
    slaAtRiskTickets: 0,
    ticketsByCategory: {},
    ticketsByPriority: {},
    ticketsByTeam: {},
    submittedRecommendations: 0,
    pendingRecommendations: 0,
    approvedRecommendations: 0,
    rejectedRecommendations: 0,
    acceptanceRate: null,
    rejectionRate: null,
    averageConfidence: null,
    escalationCounts: { total: 0 },
    minutesPerAcceptedRecommendation: 8,
    estimatedMinutesSaved: 0,
    ...overrides,
  };
}

function makeAudit(
  overrides: Partial<AuditEvent>,
): AuditEvent {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    timestamp: "2026-06-10T09:00:00.000Z",
    actor: "approval-desk",
    action: "recommendation-approved",
    ticketId: "TKT-1001",
    recommendationId: "11111111-1111-4111-8111-111111111111",
    before: {},
    after: {},
    rationale: "Reviewed.",
    knowledgeArticleIds: ["account-access"],
    result: "success",
    ...overrides,
  };
}
