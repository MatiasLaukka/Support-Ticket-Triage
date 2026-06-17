import type {
  ExpectedOutcome,
  RequiredEscalation,
  TriageRecommendation,
} from "./domain.js";

export interface EvaluationReport {
  ticketCount: number;
  categoryAccuracy: number;
  routingAccuracy: number;
  priorityAgreement: number;
  securityEscalationRecall: number | null;
  outageEscalationRecall: number | null;
  duplicatePrecision: number | null;
  duplicateRecall: number | null;
  knowledgeCitationCoverage: number;
  approvalSafetyViolations: number;
}

export function evaluateRecommendations(
  recommendations: readonly TriageRecommendation[],
  expectedOutcomes: readonly ExpectedOutcome[],
): EvaluationReport {
  validateEvaluationInput(recommendations, expectedOutcomes);
  const recommendationsByTicket = new Map<string, TriageRecommendation>(
    recommendations.map((recommendation) => [
      recommendation.ticketId,
      recommendation,
    ]),
  );
  let categoryMatches = 0;
  let routingMatches = 0;
  let priorityMatches = 0;
  let knowledgeCitations = 0;
  let expectedKnowledgeCitations = 0;

  for (const outcome of expectedOutcomes) {
    const recommendation = recommendationsByTicket.get(outcome.ticketId);
    if (recommendation?.category === outcome.category) {
      categoryMatches += 1;
    }
    if (recommendation?.team === outcome.team) {
      routingMatches += 1;
    }
    if (
      recommendation !== undefined &&
      outcome.acceptablePriorities.includes(recommendation.priority)
    ) {
      priorityMatches += 1;
    }

    expectedKnowledgeCitations += outcome.knowledgeArticleIds.length;
    for (const articleId of outcome.knowledgeArticleIds) {
      if (recommendation?.knowledgeArticleIds.includes(articleId)) {
        knowledgeCitations += 1;
      }
    }
  }

  const expectedDuplicatePairs = duplicatePairsFromOutcomes(expectedOutcomes);
  const predictedDuplicatePairs =
    duplicatePairsFromRecommendations(recommendations);
  const truePositiveDuplicatePairs = [...predictedDuplicatePairs].filter(
    (pair) => expectedDuplicatePairs.has(pair),
  ).length;

  return {
    ticketCount: expectedOutcomes.length,
    categoryAccuracy: finiteRate(categoryMatches, expectedOutcomes.length),
    routingAccuracy: finiteRate(routingMatches, expectedOutcomes.length),
    priorityAgreement: finiteRate(priorityMatches, expectedOutcomes.length),
    securityEscalationRecall: escalationRecall(
      recommendationsByTicket,
      expectedOutcomes,
      "security",
    ),
    outageEscalationRecall: escalationRecall(
      recommendationsByTicket,
      expectedOutcomes,
      "outage",
    ),
    duplicatePrecision: nullableRate(
      truePositiveDuplicatePairs,
      predictedDuplicatePairs.size,
    ),
    duplicateRecall: nullableRate(
      truePositiveDuplicatePairs,
      expectedDuplicatePairs.size,
    ),
    knowledgeCitationCoverage: finiteRate(
      knowledgeCitations,
      expectedKnowledgeCitations,
    ),
    approvalSafetyViolations: recommendations.filter(
      ({ resolution }) => resolution !== "pending",
    ).length,
  };
}

function validateEvaluationInput(
  recommendations: readonly TriageRecommendation[],
  expectedOutcomes: readonly ExpectedOutcome[],
): void {
  const duplicateRecommendationIds = duplicateTicketIds(
    recommendations.map(({ ticketId }) => ticketId),
  );
  if (duplicateRecommendationIds.length > 0) {
    throw new Error(
      `Recommendations contain duplicate ticket IDs: ${duplicateRecommendationIds.join(", ")}.`,
    );
  }

  const duplicateOutcomeIds = duplicateTicketIds(
    expectedOutcomes.map(({ ticketId }) => ticketId),
  );
  if (duplicateOutcomeIds.length > 0) {
    throw new Error(
      `Expected outcomes contain duplicate ticket IDs: ${duplicateOutcomeIds.join(", ")}.`,
    );
  }

  const recommendationIds = new Set(
    recommendations.map(({ ticketId }) => ticketId),
  );
  const outcomeIds = new Set(expectedOutcomes.map(({ ticketId }) => ticketId));
  const unexpectedRecommendationIds = [...recommendationIds]
    .filter((ticketId) => !outcomeIds.has(ticketId))
    .sort();
  const missingRecommendationIds = [...outcomeIds]
    .filter((ticketId) => !recommendationIds.has(ticketId))
    .sort();
  if (
    unexpectedRecommendationIds.length > 0 ||
    missingRecommendationIds.length > 0
  ) {
    throw new Error(
      "Recommendation ticket IDs must exactly match expected outcomes " +
        `(unexpected: ${formatTicketIds(unexpectedRecommendationIds)}; ` +
        `missing: ${formatTicketIds(missingRecommendationIds)}).`,
    );
  }

  const orderedRecommendations = [...recommendations].sort((left, right) =>
    left.ticketId.localeCompare(right.ticketId),
  );
  for (const recommendation of orderedRecommendations) {
    const orderedCandidates = [...recommendation.duplicateCandidates].sort(
      (left, right) => left.ticketId.localeCompare(right.ticketId),
    );
    const selfCandidate = orderedCandidates.find(
      ({ ticketId }) => ticketId === recommendation.ticketId,
    );
    if (selfCandidate !== undefined) {
      throw new Error(
        `Duplicate candidate for ${recommendation.ticketId} must reference a different ticket.`,
      );
    }

    const outsideCandidate = orderedCandidates.find(
      ({ ticketId }) => !outcomeIds.has(ticketId),
    );
    if (outsideCandidate !== undefined) {
      throw new Error(
        `Duplicate candidate for ${recommendation.ticketId} references ticket outside ` +
          `evaluation set: ${outsideCandidate.ticketId}.`,
      );
    }
  }
}

function duplicateTicketIds(ticketIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const ticketId of ticketIds) {
    if (seen.has(ticketId)) {
      duplicates.add(ticketId);
    }
    seen.add(ticketId);
  }
  return [...duplicates].sort();
}

function formatTicketIds(ticketIds: readonly string[]): string {
  return ticketIds.length === 0 ? "none" : ticketIds.join(", ");
}

function escalationRecall(
  recommendationsByTicket: ReadonlyMap<string, TriageRecommendation>,
  expectedOutcomes: readonly ExpectedOutcome[],
  reason: Extract<RequiredEscalation, "security" | "outage">,
): number | null {
  const required = expectedOutcomes.filter(({ requiredEscalations }) =>
    requiredEscalations.includes(reason),
  );
  const detected = required.filter(({ ticketId }) =>
    recommendationsByTicket.get(ticketId)?.escalationReasons.includes(reason),
  ).length;
  return nullableRate(detected, required.length);
}

function duplicatePairsFromOutcomes(
  expectedOutcomes: readonly ExpectedOutcome[],
): Set<string> {
  const groups = new Map<string, string[]>();
  for (const outcome of expectedOutcomes) {
    if (outcome.duplicateGroup === undefined) {
      continue;
    }
    const ticketIds = groups.get(outcome.duplicateGroup) ?? [];
    ticketIds.push(outcome.ticketId);
    groups.set(outcome.duplicateGroup, ticketIds);
  }

  const pairs = new Set<string>();
  for (const ticketIds of groups.values()) {
    for (let left = 0; left < ticketIds.length; left += 1) {
      for (let right = left + 1; right < ticketIds.length; right += 1) {
        pairs.add(pairKey(ticketIds[left]!, ticketIds[right]!));
      }
    }
  }
  return pairs;
}

function duplicatePairsFromRecommendations(
  recommendations: readonly TriageRecommendation[],
): Set<string> {
  const pairs = new Set<string>();
  for (const recommendation of recommendations) {
    for (const candidate of recommendation.duplicateCandidates) {
      pairs.add(pairKey(recommendation.ticketId, candidate.ticketId));
    }
  }
  return pairs;
}

function pairKey(left: string, right: string): string {
  return left < right ? `${left}\0${right}` : `${right}\0${left}`;
}

function finiteRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function nullableRate(
  numerator: number,
  denominator: number,
): number | null {
  return denominator === 0 ? null : numerator / denominator;
}
