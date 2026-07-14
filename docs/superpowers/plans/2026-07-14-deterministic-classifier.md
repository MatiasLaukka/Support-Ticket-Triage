# Deterministic Classifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic weighted classifier that can create Approval Desk triage recommendations without using `expected-outcomes.json` as runtime truth.

**Architecture:** Add typed classification signals, implement a focused classifier module that scores submitted metadata, safety, product area, known cause, and priority signals, then wire the recommendation builder to use classifier output when no expected outcome is supplied. Keep `expected-outcomes.json` for fixture generation and evaluation only.

**Tech Stack:** TypeScript, Zod, Vitest, existing local JSON fixtures and Approval Desk modules.

## Global Constraints

- GPT must not decide category, priority, team, escalation, or approval fields.
- Submitted ticket metadata is weak-to-medium evidence, not truth.
- Security and outage precedence can override normal product routing.
- Classifier decisions must expose signals for auditability.
- Evidence readiness, known-cause definitions, and customer drafting stay deterministic and continue to own their existing responsibilities.
- No UI redesign in this phase.

---

## File Structure

- Create `src/approval-desk/classifier.ts`
  - Owns classifier types, rules, scoring, resolver, and `classifyTicket(ticket)`.
- Modify `src/domain.ts`
  - Adds `ClassificationSignalSchema` and optional `classificationSignals` on recommendations.
- Modify `src/triage-service.ts`
  - Accepts, validates, stores, and audits classification signals.
- Modify `src/approval-desk/recommendation-builder.ts`
  - Uses expected outcomes when supplied, otherwise calls the classifier.
- Modify `src/evaluation.ts`
  - Adds classifier-specific evaluation helper without changing current recommendation evaluation behavior.
- Modify `scripts/evaluate.ts`
  - Keeps current sample recommendation evaluation intact; optionally accepts classifier-generated recommendations in a later task.
- Modify `docs/audits/support-domain-audit.md`
  - Documents any intentional classifier disagreements.
- Create `test/classifier.test.ts`
  - Unit tests classifier rules, precedence, metadata weighting, known causes, and confidence.
- Modify `test/domain.test.ts`
  - Tests classification signal schema validation.
- Modify `test/triage-service.test.ts`
  - Tests recommendation signal persistence and audit snapshot.
- Modify `test/approval-desk-recommendation.test.ts`
  - Tests runtime recommendation creation without expected outcomes.
- Modify `test/evaluation.test.ts`
  - Tests classifier-vs-expected reporting.

---

### Task 1: Add Classification Signal Plumbing

**Files:**
- Modify: `src/domain.ts`
- Modify: `src/triage-service.ts`
- Test: `test/domain.test.ts`
- Test: `test/triage-service.test.ts`

**Interfaces:**
- Produces: `ClassificationSignalSchema`
- Produces: `type ClassificationSignal`
- Produces: optional `classificationSignals?: ClassificationSignal[]` on `TriageRecommendation`
- Produces: optional `classificationSignals?: ClassificationSignal[]` on `SubmitRecommendationInput`

- [ ] **Step 1: Write failing domain schema tests**

Add to `test/domain.test.ts`:

```ts
import {
  ClassificationSignalSchema,
  TriageRecommendationSchema,
} from "../src/domain.js";

it("accepts classifier signals with stable rule IDs and reasons", () => {
  expect(
    ClassificationSignalSchema.parse({
      ruleId: "metadata-category-api",
      target: "category:api",
      weight: 2,
      reason: "Submitted category is api.",
    }),
  ).toEqual({
    ruleId: "metadata-category-api",
    target: "category:api",
    weight: 2,
    reason: "Submitted category is api.",
  });
});

it("stores optional classifier signals on recommendations", () => {
  const recommendation = TriageRecommendationSchema.parse({
    id: "00000001-1111-4111-8111-000000000001",
    ticketId: "TKT-1001",
    sourceRevision: 1,
    category: "api",
    priority: "P2",
    team: "api-platform",
    duplicateCandidates: [],
    outageRisk: "none",
    securityRisk: "none",
    slaRisk: "none",
    missingInformation: [],
    knowledgeArticleIds: ["event-tracking-debugging"],
    draftCustomerResponse: "We are checking the API issue.",
    rationale: "Classifier test.",
    confidence: 0.84,
    recommendedNextAction: "Review the recommendation.",
    escalationRequired: false,
    escalationReasons: [],
    classificationSignals: [
      {
        ruleId: "api-track-language",
        target: "topic:api",
        weight: 6,
        reason: "Ticket mentions Track API.",
      },
    ],
    resolution: "pending",
    createdAt: "2026-06-10T09:00:00.000Z",
  });

  expect(recommendation.classificationSignals).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run test/domain.test.ts`

Expected: FAIL because `ClassificationSignalSchema` and `classificationSignals` do not exist.

- [ ] **Step 3: Implement domain schema**

In `src/domain.ts`, add after `EvidenceRequirementSchema`:

```ts
export const ClassificationSignalSchema = z
  .object({
    ruleId: SlugSchema,
    target: NonBlankStringSchema,
    weight: z.number(),
    reason: NonBlankStringSchema,
  })
  .strict();
```

Add to `TriageRecommendationSchema`:

```ts
classificationSignals: z.array(ClassificationSignalSchema).optional(),
```

Add near the exported types:

```ts
export type ClassificationSignal = z.infer<
  typeof ClassificationSignalSchema
>;
```

- [ ] **Step 4: Add service plumbing tests**

In `test/triage-service.test.ts`, add an assertion to an existing submit test or create a new submit test:

```ts
expect(recommendation.classificationSignals).toEqual([
  {
    ruleId: "metadata-category-api",
    target: "category:api",
    weight: 2,
    reason: "Submitted category is api.",
  },
]);
expect(auditEvent.after).toMatchObject({
  classificationSignalCount: 1,
});
```

- [ ] **Step 5: Run service test to verify it fails**

Run: `npm test -- --run test/triage-service.test.ts`

Expected: FAIL because `SubmitRecommendationInputSchema` rejects `classificationSignals`.

- [ ] **Step 6: Implement service plumbing**

In `src/triage-service.ts`:

- import `ClassificationSignalSchema`;
- add `classificationSignals: z.array(ClassificationSignalSchema).optional()` to `SubmitRecommendationInputSchema`;
- add `classificationSignals?: ClassificationSignal[]` to `SubmitRecommendationInput`;
- pass `classificationSignals` into the parsed `TriageRecommendationSchema` object;
- add `classificationSignalCount` to recommendation-submitted audit `after`.

Use this shape:

```ts
...(parsed.classificationSignals === undefined
  ? {}
  : { classificationSignals: parsed.classificationSignals }),
```

and:

```ts
classificationSignalCount: recommendation.classificationSignals?.length ?? 0,
```

- [ ] **Step 7: Run focused tests**

Run: `npm test -- --run test/domain.test.ts test/triage-service.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -- src/domain.ts src/triage-service.ts test/domain.test.ts test/triage-service.test.ts
git commit -m "feat: store classifier signals on recommendations"
```

---

### Task 2: Implement Weighted Classifier Rules

**Files:**
- Create: `src/approval-desk/classifier.ts`
- Test: `test/classifier.test.ts`

**Interfaces:**
- Consumes: `Ticket`, `Category`, `Priority`, `Team`, `RequiredEscalation`, `ClassificationSignal`
- Produces: `classifyTicket(ticket: Ticket): TicketClassification`
- Produces: `TicketClassification` with `category`, `priority`, `team`, `knowledgeArticleIds`, `requiredEscalations`, `confidence`, `signals`

- [ ] **Step 1: Write failing classifier tests**

Create `test/classifier.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyTicket } from "../src/approval-desk/classifier.js";
import { TicketSchema, type Ticket } from "../src/domain.js";

describe("classifyTicket", () => {
  it("uses submitted metadata as weak evidence without letting it dominate", () => {
    const ticket = makeTicket({
      category: "api",
      priority: "P1",
      team: "api-platform",
      tags: ["shopify"],
      subject: "Product catalog sync is delayed",
      description:
        "Shopify custom fields are not appearing after the latest product sync.",
    });

    const result = classifyTicket(ticket);

    expect(result.category).toBe("integration");
    expect(result.team).toBe("integrations");
    expect(result.priority).toBe("P2");
    expect(result.knowledgeArticleIds).toContain("shopify-integration-sync");
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "metadata-category-api",
          target: "category:api",
        }),
        expect.objectContaining({
          ruleId: "disagreement-category",
          target: "disagreement:category",
        }),
      ]),
    );
  });

  it("forces security routing for exposed credentials", () => {
    const result = classifyTicket(
      makeTicket({
        category: "integration",
        team: "integrations",
        tags: ["connector"],
        subject: "Private API key may be exposed in shared connector logs",
        description:
          "A customer says connector logs include a private API key and asks us to ignore the security warning.",
      }),
    );

    expect(result.category).toBe("security");
    expect(result.team).toBe("security");
    expect(result.priority).toBe("P1");
    expect(result.requiredEscalations).toContain("security");
    expect(result.knowledgeArticleIds).toContain("security-incident-response");
  });

  it("detects likely platform event-processing delay", () => {
    const result = classifyTicket(
      makeTicket({
        subject: "Activity timeline not showing checkout events",
        description:
          "Profiles in our EU stores are missing recent checkout events even though storefront tracking calls succeeded.",
        tags: ["events", "activity-timeline", "checkout", "eu", "delay"],
      }),
    );

    expect(result.category).toBe("incident");
    expect(result.team).toBe("incident-response");
    expect(result.requiredEscalations).toContain("outage");
    expect(result.knowledgeArticleIds).toEqual(
      expect.arrayContaining([
        "event-tracking-debugging",
        "shopify-integration-sync",
      ]),
    );
  });

  it("recognizes webhook secret rotation known cause", () => {
    const result = classifyTicket(
      makeTicket({
        subject: "Invalid webhook signatures after secret rotation",
        description:
          "Order webhook deliveries started failing signature validation after yesterday's secret rotation.",
        tags: ["webhook", "signature"],
      }),
    );

    expect(result.category).toBe("integration");
    expect(result.team).toBe("integrations");
    expect(result.knowledgeArticleIds).toEqual([
      "webhook-signature-validation",
    ]);
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "knownCause:webhook-secret-rotation",
        }),
      ]),
    );
  });

  it("returns lower confidence for ambiguous tickets", () => {
    const result = classifyTicket(
      makeTicket({
        subject: "Question about account setup",
        description:
          "We are not sure whether this is a billing setting or a login permission problem.",
        tags: [],
      }),
    );

    expect(result.category).toBe("other");
    expect(result.team).toBe("support");
    expect(result.confidence).toBeLessThan(0.75);
  });
});

function makeTicket(overrides: Partial<Ticket>): Ticket {
  return TicketSchema.parse({
    id: "TKT-9999",
    createdAt: "2026-06-10T09:00:00.000Z",
    updatedAt: "2026-06-10T09:00:00.000Z",
    customer: {
      name: "Demo Customer",
      plan: "growth",
      region: "eu-west",
      vip: false,
    },
    requester: {
      name: "Maya Chen",
      role: "Ecommerce Manager",
      department: "Marketing",
      technicalLevel: "non-technical",
      seniority: "manager",
    },
    subject: "Support request",
    description: "Please help.",
    status: "triage",
    tags: [],
    sla: {
      responseDueAt: "2026-06-10T12:00:00.000Z",
      breached: false,
    },
    relatedTicketIds: [],
    revision: 1,
    ...overrides,
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run test/classifier.test.ts`

Expected: FAIL because `src/approval-desk/classifier.ts` does not exist.

- [ ] **Step 3: Implement classifier types and rule engine**

Create `src/approval-desk/classifier.ts` with these exported types and function:

```ts
import type {
  Category,
  ClassificationSignal,
  Priority,
  RequiredEscalation,
  Team,
  Ticket,
} from "../domain.js";
import { detectKnownCause } from "./known-cause-catalog.js";

export interface TicketClassification {
  category: Category;
  priority: Priority;
  team: Team;
  knowledgeArticleIds: string[];
  requiredEscalations: RequiredEscalation[];
  confidence: number;
  signals: ClassificationSignal[];
}

type ScoreTarget =
  | `category:${Category}`
  | `priority:${Priority}`
  | `team:${Team}`
  | `knowledge:${string}`
  | `escalation:${RequiredEscalation}`
  | `knownCause:${string}`
  | `risk:${"security" | "outage" | "sla"}`
  | `disagreement:${"category" | "priority" | "team"}`;

interface Rule {
  id: string;
  when: (context: ClassifierContext) => boolean;
  emit: (context: ClassifierContext) => ClassificationSignal[];
}
```

Implement helpers:

```ts
function normalizeTicket(ticket: Ticket): string {
  return [
    ticket.subject,
    ticket.description,
    ticket.category ?? "",
    ticket.priority ?? "",
    ticket.team ?? "",
    ticket.customer.name,
    ticket.customer.plan,
    ticket.customer.region,
    ticket.requester?.role ?? "",
    ticket.requester?.department ?? "",
    ticket.requester?.technicalLevel ?? "",
    ...ticket.tags,
  ]
    .join(" ")
    .toLowerCase();
}

function signal(
  ruleId: string,
  target: ScoreTarget,
  weight: number,
  reason: string,
): ClassificationSignal {
  return { ruleId, target, weight, reason };
}
```

Implement rules for:

- submitted category/priority/team/tags;
- security exposure and prompt injection;
- outage/event-processing delay;
- API, webhook, Shopify/catalog, SMS/campaign, flows, billing, account/auth, performance, feature request;
- known causes by calling `detectKnownCause` with a derived outcome-like article set or by matching the same terms directly.

- [ ] **Step 4: Implement resolver**

Add resolver behavior:

```ts
function resolveClassification(
  ticket: Ticket,
  signals: ClassificationSignal[],
): TicketClassification {
  const category = chooseCategory(signals);
  const requiredEscalations = chooseEscalations(signals, ticket);
  const team = chooseTeam(signals, category, requiredEscalations);
  const priority = choosePriority(signals, requiredEscalations, ticket);
  const knowledgeArticleIds = chooseKnowledgeArticles(signals, category);
  const disagreementSignals = buildDisagreementSignals(ticket, {
    category,
    priority,
    team,
  });
  const allSignals = [...signals, ...disagreementSignals];
  const confidence = calculateConfidence(allSignals, category);

  return {
    category,
    priority,
    team,
    knowledgeArticleIds,
    requiredEscalations,
    confidence,
    signals: allSignals,
  };
}
```

Hard precedence:

- any strong security signal sets category `security`, team `security`, priority `P1`, escalation `security`;
- any strong outage signal sets category `incident`, team `incident-response`, priority at least `P2`, escalation `outage`;
- SLA breach adds escalation `sla` and priority at least `P2`;
- otherwise highest product category score wins;
- default is `other`, `P3`, `support`, confidence below `0.75`.

- [ ] **Step 5: Run classifier tests**

Run: `npm test -- --run test/classifier.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -- src/approval-desk/classifier.ts test/classifier.test.ts
git commit -m "feat: add deterministic ticket classifier"
```

---

### Task 3: Use Classifier For Runtime Recommendations

**Files:**
- Modify: `src/approval-desk/recommendation-builder.ts`
- Test: `test/approval-desk-recommendation.test.ts`

**Interfaces:**
- Consumes: `classifyTicket(ticket)`
- Produces: `buildApprovalDeskRecommendationInput({ ticket, outcome: undefined, actor })` succeeds
- Produces: recommendations with classifier-derived `category`, `priority`, `team`, `knowledgeArticleIds`, `requiredEscalations`, `confidence`, and `classificationSignals`

- [ ] **Step 1: Write failing recommendation-builder test**

Replace the existing `"throws when no expected outcome exists for the ticket"` test in `test/approval-desk-recommendation.test.ts` with:

```ts
it("builds a classifier-driven recommendation when no expected outcome exists", async () => {
  const ticket = TicketSchema.parse({
    ...(await loadSeedTicket("TKT-1008")),
    id: "TKT-9999",
  });

  const input = buildApprovalDeskRecommendationInput({
    ticket,
    outcome: undefined,
    actor: "approval-desk",
  });

  expect(input).toMatchObject({
    ticketId: "TKT-9999",
    category: "integration",
    priority: "P2",
    team: "integrations",
    knowledgeArticleIds: ["webhook-signature-validation"],
    actor: "approval-desk",
  });
  expect(input.classificationSignals).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        target: "knownCause:webhook-secret-rotation",
      }),
    ]),
  );
  expect(input.rationale).toContain("classifier");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run test/approval-desk-recommendation.test.ts`

Expected: FAIL because the builder still throws when `outcome` is undefined.

- [ ] **Step 3: Implement classifier fallback**

In `src/approval-desk/recommendation-builder.ts`:

- import `classifyTicket`;
- when `outcome` is undefined, call `classifyTicket(ticket)`;
- convert the classification into an `ExpectedOutcome`-compatible object for existing evidence and draft functions:

```ts
function outcomeFromClassification(
  ticket: Ticket,
  classification: TicketClassification,
): ExpectedOutcome {
  return {
    ticketId: ticket.id,
    category: classification.category,
    acceptablePriorities: [classification.priority],
    team: classification.team,
    requiredEscalations: classification.requiredEscalations,
    knowledgeArticleIds: classification.knowledgeArticleIds,
  };
}
```

Use `resolvedOutcome` everywhere the builder currently uses `outcome`.

Set recommendation fields from classification when it is used:

```ts
classificationSignals: classification.signals,
confidence: classification.confidence,
rationale: `${ticket.id} was classified as ${resolvedOutcome.category} routing to ${resolvedOutcome.team} with knowledge ${resolvedOutcome.knowledgeArticleIds.join(", ")}.`,
```

Preserve the mismatched-outcome guard when an explicit `outcome` is supplied.

- [ ] **Step 4: Update drafting path**

In `buildApprovalDeskRecommendationInputWithDrafting`, after calling the base builder:

- if explicit `outcome` is supplied, use it for provider input;
- otherwise derive provider outcome from the base recommendation fields.

Use:

```ts
const providerOutcome = outcome ?? {
  ticketId: input.ticket.id,
  category: base.category,
  acceptablePriorities: [base.priority],
  team: base.team,
  requiredEscalations: base.escalationReasons ?? [],
  knowledgeArticleIds: base.knowledgeArticleIds,
};
```

- [ ] **Step 5: Run focused tests**

Run: `npm test -- --run test/approval-desk-recommendation.test.ts test/classifier.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -- src/approval-desk/recommendation-builder.ts test/approval-desk-recommendation.test.ts
git commit -m "feat: build recommendations from classifier output"
```

---

### Task 4: Add Classifier Evaluation Coverage

**Files:**
- Modify: `src/evaluation.ts`
- Modify: `test/evaluation.test.ts`
- Modify: `docs/audits/support-domain-audit.md`

**Interfaces:**
- Produces: `evaluateClassifications(classifications, expectedOutcomes)`
- Produces: classifier metrics for category, routing, priority, escalation recall, and knowledge citation coverage

- [ ] **Step 1: Write failing evaluation test**

Add to `test/evaluation.test.ts`:

```ts
import { TicketSchema } from "../src/domain.js";
import { classifyTicket } from "../src/approval-desk/classifier.js";
import { evaluateClassifications } from "../src/evaluation.js";

it("evaluates classifier output against expected outcomes", () => {
  const tickets = TicketSchema.array().parse(
    JSON.parse(readFileSync(resolve("data/seed/tickets.json"), "utf8")),
  );
  const outcomes = ExpectedOutcomeSchema.array().parse(
    JSON.parse(readFileSync(resolve("data/seed/expected-outcomes.json"), "utf8")),
  );
  const classifications = tickets.map((ticket) => ({
    ticketId: ticket.id,
    ...classifyTicket(ticket),
  }));

  const report = evaluateClassifications(classifications, outcomes);

  expect(report.ticketCount).toBe(30);
  expect(report.categoryAccuracy).toBeGreaterThanOrEqual(0.9);
  expect(report.routingAccuracy).toBeGreaterThanOrEqual(0.9);
  expect(report.priorityAgreement).toBeGreaterThanOrEqual(0.9);
  expect(report.knowledgeCitationCoverage).toBeGreaterThanOrEqual(0.85);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run test/evaluation.test.ts`

Expected: FAIL because `evaluateClassifications` does not exist.

- [ ] **Step 3: Implement classifier evaluation helper**

In `src/evaluation.ts`, add:

```ts
export interface ClassificationEvaluationInput {
  ticketId: string;
  category: ExpectedOutcome["category"];
  priority: ExpectedOutcome["acceptablePriorities"][number];
  team: ExpectedOutcome["team"];
  requiredEscalations: ExpectedOutcome["requiredEscalations"];
  knowledgeArticleIds: ExpectedOutcome["knowledgeArticleIds"];
}

export function evaluateClassifications(
  classifications: readonly ClassificationEvaluationInput[],
  expectedOutcomes: readonly ExpectedOutcome[],
): Pick<
  EvaluationReport,
  | "ticketCount"
  | "categoryAccuracy"
  | "routingAccuracy"
  | "priorityAgreement"
  | "securityEscalationRecall"
  | "outageEscalationRecall"
  | "knowledgeCitationCoverage"
> {
  // Mirror recommendation evaluation, but ignore approval safety and duplicate metrics.
}
```

Reuse `validateEvaluationInput` patterns where possible, but do not require duplicate candidates or recommendation IDs.

- [ ] **Step 4: Document intentional disagreements**

If the classifier misses any expected outcomes for defensible reasons, add a short note to `docs/audits/support-domain-audit.md`:

```md
## Classifier Disagreements

- `TKT-10xx`: classifier chooses `<value>` instead of expected `<value>` because `<reason>`.
```

If there are no disagreements, add:

```md
## Classifier Disagreements

The first deterministic classifier pass matches the current expected outcome set within the configured evaluation thresholds. No intentional disagreements are documented for this phase.
```

- [ ] **Step 5: Run evaluation tests**

Run: `npm test -- --run test/evaluation.test.ts test/classifier.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -- src/evaluation.ts test/evaluation.test.ts docs/audits/support-domain-audit.md
git commit -m "test: evaluate classifier against expected outcomes"
```

---

### Task 5: Final Verification And Branch Hygiene

**Files:**
- Modify only if required by failing verification.

**Interfaces:**
- Produces: full test and evaluator evidence for the classifier branch.

- [ ] **Step 1: Run full tests**

Run: `npm test`

Expected: PASS with all test files passing.

- [ ] **Step 2: Run evaluator**

Run: `npm run evaluate`

Expected: PASS and current sample recommendation metrics remain unchanged:

```text
Tickets: 30 | category 100.0% | routing 100.0% | priority 100.0% | safety violations 0
```

- [ ] **Step 3: Check worktree**

Run: `git status --short --branch`

Expected: clean worktree on `codex/portfolio-demo-polish`.

- [ ] **Step 4: Push branch**

Run:

```bash
git -c http.sslBackend=schannel push origin codex/portfolio-demo-polish
```

Expected: branch pushes successfully to GitHub.

---

## Self-Review

- Spec coverage: submitted metadata, safety precedence, product-area rules, known causes, priority, evidence handoff, signals, evaluation, and no-GPT-routing constraints are covered.
- Unfinished-marker scan: no unfinished markers or unspecified implementation steps remain.
- Type consistency: `ClassificationSignal`, `TicketClassification`, `classifyTicket`, and `evaluateClassifications` are defined before later tasks consume them.
- Scope check: this plan avoids UI redesign and keeps GPT confined to drafting/assist behavior.
