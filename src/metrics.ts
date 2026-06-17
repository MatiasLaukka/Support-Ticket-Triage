import type {
  RequiredEscalation,
  Ticket,
  TriageRecommendation,
} from "./domain.js";
import { DomainError } from "./errors.js";

export interface QueueMetricsInput {
  tickets: readonly Ticket[];
  recommendations: readonly TriageRecommendation[];
  now: Date;
  minutesPerAcceptedRecommendation: number;
}

export interface QueueMetrics {
  generatedAt: string;
  openTickets: number;
  untriagedTickets: number;
  slaBreachedTickets: number;
  slaAtRiskTickets: number;
  ticketsByCategory: Record<string, number>;
  ticketsByPriority: Record<string, number>;
  ticketsByTeam: Record<string, number>;
  submittedRecommendations: number;
  pendingRecommendations: number;
  approvedRecommendations: number;
  rejectedRecommendations: number;
  acceptanceRate: number | null;
  rejectionRate: number | null;
  averageConfidence: number | null;
  escalationCounts: { total: number } & Partial<
    Record<RequiredEscalation, number>
  >;
  minutesPerAcceptedRecommendation: number;
  estimatedMinutesSaved: number;
}

const AT_RISK_WINDOW_MS = 60 * 60 * 1000;

export function calculateQueueMetrics(input: QueueMetricsInput): QueueMetrics {
  if (Number.isNaN(input.now.getTime())) {
    throw new DomainError(
      "Queue metrics require a valid current time.",
      "INVALID_NOW",
    );
  }
  if (
    !Number.isFinite(input.minutesPerAcceptedRecommendation) ||
    input.minutesPerAcceptedRecommendation < 0
  ) {
    throw new DomainError(
      "Minutes per accepted recommendation must be nonnegative.",
      "REPOSITORY_ERROR",
    );
  }

  const openTickets = input.tickets.filter(
    ({ status }) => status !== "resolved",
  );
  const approvedRecommendations = input.recommendations.filter(
    ({ resolution }) => resolution === "approved",
  ).length;
  const rejectedRecommendations = input.recommendations.filter(
    ({ resolution }) => resolution === "rejected",
  ).length;
  const resolvedRecommendations =
    approvedRecommendations + rejectedRecommendations;
  const escalationCounts: QueueMetrics["escalationCounts"] = { total: 0 };

  for (const recommendation of input.recommendations) {
    if (recommendation.escalationRequired) {
      escalationCounts.total += 1;
    }
    for (const reason of recommendation.escalationReasons) {
      escalationCounts[reason] = (escalationCounts[reason] ?? 0) + 1;
    }
  }

  return {
    generatedAt: input.now.toISOString(),
    openTickets: openTickets.length,
    untriagedTickets: openTickets.filter(
      (ticket) =>
        ticket.category === undefined ||
        ticket.priority === undefined ||
        ticket.team === undefined,
    ).length,
    slaBreachedTickets: openTickets.filter(
      (ticket) =>
        ticket.sla.breached ||
        new Date(ticket.sla.responseDueAt).getTime() <= input.now.getTime(),
    ).length,
    slaAtRiskTickets: openTickets.filter((ticket) => {
      const dueAt = new Date(ticket.sla.responseDueAt).getTime();
      const remaining = dueAt - input.now.getTime();
      return !ticket.sla.breached && remaining > 0 && remaining <= AT_RISK_WINDOW_MS;
    }).length,
    ticketsByCategory: countBy(openTickets, ({ category }) => category),
    ticketsByPriority: countBy(openTickets, ({ priority }) => priority),
    ticketsByTeam: countBy(openTickets, ({ team }) => team),
    submittedRecommendations: input.recommendations.length,
    pendingRecommendations: input.recommendations.filter(
      ({ resolution }) => resolution === "pending",
    ).length,
    approvedRecommendations,
    rejectedRecommendations,
    acceptanceRate:
      resolvedRecommendations === 0
        ? null
        : approvedRecommendations / resolvedRecommendations,
    rejectionRate:
      resolvedRecommendations === 0
        ? null
        : rejectedRecommendations / resolvedRecommendations,
    averageConfidence:
      input.recommendations.length === 0
        ? null
        : input.recommendations.reduce(
              (sum, recommendation) => sum + recommendation.confidence,
              0,
            ) / input.recommendations.length,
    escalationCounts,
    minutesPerAcceptedRecommendation:
      input.minutesPerAcceptedRecommendation,
    estimatedMinutesSaved:
      approvedRecommendations * input.minutesPerAcceptedRecommendation,
  };
}

function countBy(
  tickets: readonly Ticket[],
  value: (ticket: Ticket) => string | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ticket of tickets) {
    const key = value(ticket) ?? "unassigned";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
