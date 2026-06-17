import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ExpectedOutcomeSchema,
  TriageRecommendationSchema,
  type ExpectedOutcome,
  type TriageRecommendation,
} from "../src/domain.js";
import { evaluateRecommendations } from "../src/evaluation.js";

describe("evaluateRecommendations", () => {
  it("calculates classification, escalation, duplicate, citation, and safety metrics", () => {
    const outcomes = [
      makeOutcome("TKT-1001", {
        category: "security",
        acceptablePriorities: ["P1", "P2"],
        team: "security",
        requiredEscalations: ["security"],
        knowledgeArticleIds: ["security-escalation"],
        duplicateGroup: "shared-incident",
      }),
      makeOutcome("TKT-1002", {
        category: "incident",
        acceptablePriorities: ["P1"],
        team: "incident-response",
        requiredEscalations: ["outage"],
        knowledgeArticleIds: ["incident-response", "api-errors"],
        duplicateGroup: "shared-incident",
      }),
      makeOutcome("TKT-1003", {
        category: "billing",
        acceptablePriorities: ["P3", "P4"],
        team: "billing",
        requiredEscalations: [],
        knowledgeArticleIds: ["billing-refunds"],
      }),
    ];
    const recommendations = [
      makeRecommendation("TKT-1001", {
        category: "security",
        priority: "P2",
        team: "security",
        securityRisk: "possible",
        escalationReasons: ["security"],
        duplicateCandidates: [
          {
            ticketId: "TKT-1002",
            confidence: 0.9,
            evidence: "Same incident signature.",
          },
        ],
        knowledgeArticleIds: ["security-escalation"],
      }),
      makeRecommendation("TKT-1002", {
        category: "api",
        priority: "P2",
        team: "api-platform",
        duplicateCandidates: [
          {
            ticketId: "TKT-1003",
            confidence: 0.8,
            evidence: "Incorrectly predicted duplicate.",
          },
        ],
        knowledgeArticleIds: ["incident-response"],
        resolution: "approved",
      }),
      makeRecommendation("TKT-1003", {
        category: "billing",
        priority: "P4",
        team: "billing",
        knowledgeArticleIds: ["billing-refunds"],
        resolution: "rejected",
      }),
    ];

    expect(evaluateRecommendations(recommendations, outcomes)).toEqual({
      ticketCount: 3,
      categoryAccuracy: 2 / 3,
      routingAccuracy: 2 / 3,
      priorityAgreement: 2 / 3,
      securityEscalationRecall: 1,
      outageEscalationRecall: 0,
      duplicatePrecision: 1 / 2,
      duplicateRecall: 1,
      knowledgeCitationCoverage: 3 / 4,
      approvalSafetyViolations: 2,
    });
  });

  it("returns null for undefined rates and finite conservative overall metrics", () => {
    expect(evaluateRecommendations([], [])).toEqual({
      ticketCount: 0,
      categoryAccuracy: 0,
      routingAccuracy: 0,
      priorityAgreement: 0,
      securityEscalationRecall: null,
      outageEscalationRecall: null,
      duplicatePrecision: null,
      duplicateRecall: null,
      knowledgeCitationCoverage: 0,
      approvalSafetyViolations: 0,
    });

    const ordinaryOutcome = makeOutcome("TKT-1001", {
      category: "billing",
      acceptablePriorities: ["P3"],
      team: "billing",
      requiredEscalations: [],
      knowledgeArticleIds: [],
    });
    const ordinaryRecommendation = makeRecommendation("TKT-1001", {
      category: "billing",
      priority: "P3",
      team: "billing",
      knowledgeArticleIds: [],
    });
    const report = evaluateRecommendations(
      [ordinaryRecommendation],
      [ordinaryOutcome],
    );

    expect(report.securityEscalationRecall).toBeNull();
    expect(report.outageEscalationRecall).toBeNull();
    expect(report.duplicatePrecision).toBeNull();
    expect(report.duplicateRecall).toBeNull();
    expect(report.knowledgeCitationCoverage).toBe(0);
    expect(Object.values(report).some(Number.isNaN)).toBe(false);
  });

  it("reports zero duplicate recall when expected pairs are not predicted", () => {
    const outcomes = [
      makeOutcome("TKT-1001", {
        category: "billing",
        acceptablePriorities: ["P3"],
        team: "billing",
        requiredEscalations: [],
        knowledgeArticleIds: [],
        duplicateGroup: "duplicate-billing-case",
      }),
      makeOutcome("TKT-1002", {
        category: "billing",
        acceptablePriorities: ["P3"],
        team: "billing",
        requiredEscalations: [],
        knowledgeArticleIds: [],
        duplicateGroup: "duplicate-billing-case",
      }),
    ];
    const recommendations = [
      makeRecommendation("TKT-1001", {
        category: "billing",
        priority: "P3",
        team: "billing",
      }),
      makeRecommendation("TKT-1002", {
        category: "billing",
        priority: "P3",
        team: "billing",
      }),
    ];

    expect(evaluateRecommendations(recommendations, outcomes)).toMatchObject({
      duplicatePrecision: null,
      duplicateRecall: 0,
    });
  });

  it("rejects duplicate recommendation ticket IDs independent of ordering", () => {
    const recommendations = [
      makeRecommendation("TKT-1002"),
      makeRecommendation("TKT-1001"),
      makeRecommendation("TKT-1002"),
      makeRecommendation("TKT-1001"),
    ];
    const outcomes = [
      makeOrdinaryOutcome("TKT-1001"),
      makeOrdinaryOutcome("TKT-1002"),
    ];

    for (const orderedRecommendations of [
      recommendations,
      [...recommendations].reverse(),
    ]) {
      expect(() =>
        evaluateRecommendations(orderedRecommendations, outcomes),
      ).toThrow(
        "Recommendations contain duplicate ticket IDs: TKT-1001, TKT-1002.",
      );
    }
  });

  it("rejects duplicate expected outcome ticket IDs", () => {
    const outcome = makeOrdinaryOutcome("TKT-1001");

    expect(() =>
      evaluateRecommendations(
        [makeRecommendation("TKT-1001")],
        [outcome, outcome],
      ),
    ).toThrow(
      "Expected outcomes contain duplicate ticket IDs: TKT-1001.",
    );
  });

  it("requires recommendation and expected outcome ticket sets to match", () => {
    expect(() =>
      evaluateRecommendations(
        [
          makeRecommendation("TKT-1001"),
          makeRecommendation("TKT-1003"),
        ],
        [
          makeOrdinaryOutcome("TKT-1001"),
          makeOrdinaryOutcome("TKT-1002"),
        ],
      ),
    ).toThrow(
      "Recommendation ticket IDs must exactly match expected outcomes " +
        "(unexpected: TKT-1003; missing: TKT-1002).",
    );
  });

  it("rejects duplicate candidates that reference their source ticket", () => {
    expect(() =>
      evaluateRecommendations(
        [
          makeRecommendation("TKT-1001", {
            duplicateCandidates: [
              {
                ticketId: "TKT-1001",
                confidence: 0.9,
                evidence: "Invalid self-reference.",
              },
            ],
          }),
        ],
        [makeOrdinaryOutcome("TKT-1001")],
      ),
    ).toThrow(
      "Duplicate candidate for TKT-1001 must reference a different ticket.",
    );
  });

  it("rejects duplicate candidates outside the evaluated ticket set", () => {
    expect(() =>
      evaluateRecommendations(
        [
          makeRecommendation("TKT-1001", {
            duplicateCandidates: [
              {
                ticketId: "TKT-1003",
                confidence: 0.9,
                evidence: "Candidate is outside the evaluation set.",
              },
            ],
          }),
          makeRecommendation("TKT-1002"),
        ],
        [
          makeOrdinaryOutcome("TKT-1001"),
          makeOrdinaryOutcome("TKT-1002"),
        ],
      ),
    ).toThrow(
      "Duplicate candidate for TKT-1001 references ticket outside " +
        "evaluation set: TKT-1003.",
    );
  });

  it("evaluates the sample recommendations with a perfect complete report", () => {
    const recommendations = TriageRecommendationSchema.array().parse(
      JSON.parse(
        readFileSync(
          resolve("data/seed/sample-recommendations.json"),
          "utf8",
        ),
      ),
    );
    const outcomes = ExpectedOutcomeSchema.array().parse(
      JSON.parse(
        readFileSync(resolve("data/seed/expected-outcomes.json"), "utf8"),
      ),
    );

    expect(evaluateRecommendations(recommendations, outcomes)).toEqual({
      ticketCount: 30,
      categoryAccuracy: 1,
      routingAccuracy: 1,
      priorityAgreement: 1,
      securityEscalationRecall: 1,
      outageEscalationRecall: 1,
      duplicatePrecision: 1,
      duplicateRecall: 1,
      knowledgeCitationCoverage: 1,
      approvalSafetyViolations: 0,
    });
  });
});

function makeOutcome(
  ticketId: ExpectedOutcome["ticketId"],
  overrides: Omit<ExpectedOutcome, "ticketId">,
): ExpectedOutcome {
  return ExpectedOutcomeSchema.parse({ ticketId, ...overrides });
}

function makeOrdinaryOutcome(
  ticketId: ExpectedOutcome["ticketId"],
): ExpectedOutcome {
  return makeOutcome(ticketId, {
    category: "other",
    acceptablePriorities: ["P3"],
    team: "support",
    requiredEscalations: [],
    knowledgeArticleIds: [],
  });
}

function makeRecommendation(
  ticketId: TriageRecommendation["ticketId"],
  overrides: Partial<TriageRecommendation> = {},
): TriageRecommendation {
  const number = Number(ticketId.slice(-4));
  const id = `${number.toString(16).padStart(8, "0")}-1111-4111-8111-${number
    .toString(16)
    .padStart(12, "0")}`;
  const escalationReasons = overrides.escalationReasons ?? [];

  return TriageRecommendationSchema.parse({
    id,
    ticketId,
    sourceRevision: 0,
    category: "other",
    priority: "P3",
    team: "support",
    duplicateCandidates: [],
    outageRisk: "none",
    securityRisk: "none",
    slaRisk: "none",
    missingInformation: [],
    knowledgeArticleIds: [],
    draftCustomerResponse: "We are reviewing the ticket.",
    rationale: "Evaluation fixture.",
    confidence: 0.9,
    recommendedNextAction: "Review the ticket.",
    resolution: "pending",
    createdAt: "2026-06-10T09:00:00.000Z",
    ...overrides,
    escalationRequired: escalationReasons.length > 0,
    escalationReasons,
  });
}
