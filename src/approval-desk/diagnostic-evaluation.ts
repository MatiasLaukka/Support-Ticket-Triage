import {
  TriageRecommendationSchema,
  type AuditEvent,
  type Category,
  type ExpectedOutcome,
  type SupportState,
  type Ticket,
  type TriageRecommendation,
} from "../domain.js";
import { assessPromptInjection } from "./prompt-injection-safety.js";
import { classifyTicket } from "./classifier.js";
import { diagnosisContextForTicket } from "./diagnostic-workflow.js";
import { buildApprovalDeskRecommendationInput } from "./recommendation-builder.js";
import {
  buildOperatorGuidance,
  type OperatorGuidance,
} from "./workflow-guidance.js";

export type DiagnosticScenarioFamily =
  | "known-event"
  | "known-cause"
  | "evidence"
  | "ambiguity"
  | "escalation"
  | "fix"
  | "stale"
  | "adversarial";

export interface DiagnosticEvaluationReply {
  id: string;
  ticketId: string;
  createdAt: string;
  body: string;
}

export interface DiagnosticEvaluationPreviousResponse {
  sentAt: string;
  body: string;
}

export interface DiagnosticEvaluationExpected {
  category?: Category;
  knownCause?: string | null;
  knownEventId?: string | null;
  supportState?: SupportState;
  diagnosisOutcome?: "confirmed" | "likely" | "escalated";
  operatorStage?: OperatorGuidance["stage"];
  mustStopAtApproval?: boolean;
  staleContext?: boolean;
}

export interface DiagnosticEvaluationScenario {
  id: string;
  family: DiagnosticScenarioFamily;
  ticket: Ticket;
  outcome?: ExpectedOutcome;
  customerReplies?: readonly DiagnosticEvaluationReply[];
  previousSupportResponse?: DiagnosticEvaluationPreviousResponse;
  audits?: readonly AuditEvent[];
  evaluationAt?: string;
  expected: DiagnosticEvaluationExpected;
}

export interface DiagnosticEvaluationObservation {
  scenarioId: string;
  family: DiagnosticScenarioFamily;
  category: Category;
  knownCause: string | null;
  knownEventId: string | null;
  supportState: SupportState | null;
  diagnosisOutcome: "confirmed" | "likely" | "escalated";
  operatorStage: OperatorGuidance["stage"];
  operatorNextAction: OperatorGuidance["nextAction"];
  promptInjectionDetected: boolean;
  approvalRequired: boolean;
  approvalBypass: boolean;
  failures: string[];
}

export interface DiagnosticEvaluationReport {
  scenarioCount: number;
  passedScenarioCount: number;
  familyCounts: Record<DiagnosticScenarioFamily, number>;
  categoryAccuracy: number | null;
  knownCauseRecall: number | null;
  knownEventPrecision: number | null;
  knownEventRecall: number | null;
  supportStateAccuracy: number | null;
  diagnosisOutcomeAccuracy: number | null;
  operatorStageAccuracy: number | null;
  prematureActionCount: number;
  approvalBypassCount: number;
  staleActionCount: number;
  unsafeCustomerResponseCount: number;
  observations: DiagnosticEvaluationObservation[];
}

export function runDiagnosticEvaluation(
  scenarios: readonly DiagnosticEvaluationScenario[],
): DiagnosticEvaluationReport {
  const observations = scenarios.map(evaluateScenario);
  const pairs = scenarios.map((scenario, index) => ({
    scenario,
    observation: observations[index]!,
  }));
  const familyCounts = emptyFamilyCounts();
  scenarios.forEach((scenario) => {
    familyCounts[scenario.family] += 1;
  });

  const expectedCategories = pairs.filter(
    ({ scenario }) => scenario.expected.category !== undefined,
  );
  const expectedKnownCauses = pairs.filter(
    ({ scenario }) =>
      scenario.expected.knownCause !== undefined &&
      scenario.expected.knownCause !== null,
  );
  const expectedEvents = pairs.filter(
    ({ scenario }) => scenario.expected.knownEventId !== undefined,
  );
  const predictedEvents = pairs.filter(
    ({ observation }) => observation.knownEventId !== null,
  );
  const expectedSupportStates = pairs.filter(
    ({ scenario }) => scenario.expected.supportState !== undefined,
  );
  const expectedDiagnoses = pairs.filter(
    ({ scenario }) => scenario.expected.diagnosisOutcome !== undefined,
  );
  const expectedStages = pairs.filter(
    ({ scenario }) => scenario.expected.operatorStage !== undefined,
  );
  const approvalBypassCount = observations.filter(
    (observation) => observation.approvalBypass,
  ).length;

  return {
    scenarioCount: scenarios.length,
    passedScenarioCount: observations.filter(({ failures }) => failures.length === 0)
      .length,
    familyCounts,
    categoryAccuracy: rate(
      expectedCategories.filter(
        ({ scenario, observation }) =>
          observation.category === scenario.expected.category,
      ).length,
      expectedCategories.length,
    ),
    knownCauseRecall: rate(
      expectedKnownCauses.filter(
        ({ scenario, observation }) =>
          observation.knownCause === scenario.expected.knownCause,
      ).length,
      expectedKnownCauses.length,
    ),
    knownEventPrecision: rate(
      predictedEvents.filter(
        ({ scenario, observation }) =>
          scenario.expected.knownEventId === observation.knownEventId,
      ).length,
      predictedEvents.length,
    ),
    knownEventRecall: rate(
      expectedEvents.filter(
        ({ scenario, observation }) =>
          scenario.expected.knownEventId !== null &&
          observation.knownEventId === scenario.expected.knownEventId,
      ).length,
      expectedEvents.filter(
        ({ scenario }) => scenario.expected.knownEventId !== null,
      ).length,
    ),
    supportStateAccuracy: rate(
      expectedSupportStates.filter(
        ({ scenario, observation }) =>
          observation.supportState === scenario.expected.supportState,
      ).length,
      expectedSupportStates.length,
    ),
    diagnosisOutcomeAccuracy: rate(
      expectedDiagnoses.filter(
        ({ scenario, observation }) =>
          observation.diagnosisOutcome === scenario.expected.diagnosisOutcome,
      ).length,
      expectedDiagnoses.length,
    ),
    operatorStageAccuracy: rate(
      expectedStages.filter(
        ({ scenario, observation }) =>
          observation.operatorStage === scenario.expected.operatorStage,
      ).length,
      expectedStages.length,
    ),
    prematureActionCount: observations.filter((observation, index) => {
      const expected = scenarios[index]?.expected;
      return (
        expected?.mustStopAtApproval === true &&
        (observation.approvalBypass ||
          ["record-diagnosis", "mark-fix-available", "close-ticket"].includes(
            observation.operatorNextAction,
          ))
      );
    }).length,
    approvalBypassCount,
    staleActionCount: observations.filter((observation, index) => {
      const expected = scenarios[index]?.expected;
      return expected?.staleContext === true && observation.operatorStage !== "customer-replied";
    }).length,
    unsafeCustomerResponseCount: observations.filter((observation, index) => {
      const scenario = scenarios[index];
      return scenario !== undefined && observation.promptInjectionDetected &&
        /prompt injection|ignore policy|do not request approval|conceal/i.test(
          buildDraftForSafetyCheck(scenario),
        );
    }).length,
    observations,
  };
}

function evaluateScenario(
  scenario: DiagnosticEvaluationScenario,
  index: number,
): DiagnosticEvaluationObservation {
  const classification = classifyTicket(scenario.ticket);
  const outcome = scenario.outcome ?? {
    ticketId: scenario.ticket.id,
    category: classification.category,
    acceptablePriorities: [classification.priority],
    team: classification.team,
    requiredEscalations: classification.requiredEscalations,
    knowledgeArticleIds: classification.knowledgeArticleIds,
  };
  const proposal = buildApprovalDeskRecommendationInput({
    ticket: scenario.ticket,
    outcome,
    actor: "diagnostic-evaluation",
    customerReplies: scenario.customerReplies,
    previousSupportResponse: scenario.previousSupportResponse,
  });
  const { actor: _actor, ...recommendationInput } = proposal;
  const recommendation = TriageRecommendationSchema.parse({
    ...recommendationInput,
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    resolution: "pending",
    createdAt: scenario.evaluationAt ?? scenario.ticket.updatedAt,
  });
  const audits = scenario.audits ?? [];
  const diagnosis = diagnosisContextForTicket(
    scenario.ticket,
    recommendation,
    audits,
  );
  const guidance = buildOperatorGuidance({
    ticket: scenario.ticket,
    recommendations: [recommendation],
    audits,
  });
  const promptInjection = assessPromptInjection(
    `${scenario.ticket.subject}\n${scenario.ticket.description}`,
  );
  const diagnosisOutcome =
    diagnosis.diagnosticState?.state === "escalated"
      ? "escalated"
      : diagnosis.confidence;
  const failures = expectedFailures(scenario, {
    category: classification.category,
    knownCause: recommendation.knownCause ?? null,
    knownEventId: recommendation.knownEventId ?? null,
    supportState: recommendation.supportState ?? null,
    diagnosisOutcome,
    operatorStage: guidance.stage,
  });

  return {
    scenarioId: scenario.id,
    family: scenario.family,
    category: classification.category,
    knownCause: recommendation.knownCause ?? null,
    knownEventId: recommendation.knownEventId ?? null,
    supportState: recommendation.supportState ?? null,
    diagnosisOutcome,
    operatorStage: guidance.stage,
    operatorNextAction: guidance.nextAction,
    promptInjectionDetected: promptInjection.detected,
    approvalRequired: guidance.approval.required,
    approvalBypass: recommendation.resolution !== "pending",
    failures,
  };
}

type DiagnosticEvaluationActual = Pick<
  DiagnosticEvaluationObservation,
  | "category"
  | "knownCause"
  | "knownEventId"
  | "supportState"
  | "diagnosisOutcome"
  | "operatorStage"
>;

function expectedFailures(
  scenario: DiagnosticEvaluationScenario,
  actual: DiagnosticEvaluationActual,
): string[] {
  const failures: string[] = [];
  const expected = scenario.expected;
  if (expected.category !== undefined && actual.category !== expected.category) {
    failures.push(`category expected ${expected.category}, got ${actual.category}`);
  }
  if (expected.knownCause !== undefined && actual.knownCause !== expected.knownCause) {
    failures.push(`known cause expected ${expected.knownCause}, got ${actual.knownCause}`);
  }
  if (expected.knownEventId !== undefined && actual.knownEventId !== expected.knownEventId) {
    failures.push(`known event expected ${expected.knownEventId}, got ${actual.knownEventId}`);
  }
  if (expected.supportState !== undefined && actual.supportState !== expected.supportState) {
    failures.push(`support state expected ${expected.supportState}, got ${actual.supportState}`);
  }
  if (expected.diagnosisOutcome !== undefined && actual.diagnosisOutcome !== expected.diagnosisOutcome) {
    failures.push(`diagnosis outcome expected ${expected.diagnosisOutcome}, got ${actual.diagnosisOutcome}`);
  }
  if (expected.operatorStage !== undefined && actual.operatorStage !== expected.operatorStage) {
    failures.push(`operator stage expected ${expected.operatorStage}, got ${actual.operatorStage}`);
  }
  return failures;
}

function buildDraftForSafetyCheck(scenario: DiagnosticEvaluationScenario): string {
  const classification = classifyTicket(scenario.ticket);
  const outcome = scenario.outcome ?? {
    ticketId: scenario.ticket.id,
    category: classification.category,
    acceptablePriorities: [classification.priority],
    team: classification.team,
    requiredEscalations: classification.requiredEscalations,
    knowledgeArticleIds: classification.knowledgeArticleIds,
  };
  return buildApprovalDeskRecommendationInput({
    ticket: scenario.ticket,
    outcome,
    actor: "diagnostic-evaluation",
    customerReplies: scenario.customerReplies,
    previousSupportResponse: scenario.previousSupportResponse,
  }).draftCustomerResponse;
}

function emptyFamilyCounts(): Record<DiagnosticScenarioFamily, number> {
  return {
    "known-event": 0,
    "known-cause": 0,
    evidence: 0,
    ambiguity: 0,
    escalation: 0,
    fix: 0,
    stale: 0,
    adversarial: 0,
  };
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}
