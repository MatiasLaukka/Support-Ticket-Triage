# Known Event Correlation and Diagnostic Evaluation Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a deterministic, auditable known-event correlation layer and a broad multi-turn evaluation harness that measures classifier and diagnostic behavior across ordinary, ambiguous, adversarial, and outage-linked tickets.

**Architecture:** Keep known causes as reusable causal signatures and add a separate in-repository known-event catalog containing bounded time/scope windows. A single matcher enriches classification and evidence readiness; the existing shared diagnostic workflow remains the authority for state transitions and gates. The harness calls those production functions and reports classification, diagnosis, safety, escalation, and stale-context metrics without creating a parallel engine.

**Tech Stack:** TypeScript, Zod, Vitest, existing Approval Desk repositories and workflow modules.

## Global Constraints

- Deterministic event matching must not call GPT or mutate approval/diagnostic state.
- UI and MCP paths must consume the same event/cause matching and workflow functions.
- Existing known-cause, ambiguity, prompt-injection, approval, stale-context, fix, and closure behavior must remain intact.
- Event correlation is bounded to seeded/local fixtures; do not add live incident-management integrations.
- New tests must prove new behavior and must not duplicate existing HTTP/MCP lifecycle coverage.

---

### Task 1: Add the known-event catalog and matcher

**Files:**
- Create: `src/approval-desk/known-event-catalog.ts`
- Test: `test/known-event-catalog.test.ts`

**Interfaces:**
- `detectKnownEvent(input: { ticket: Ticket; content?: string; knownCause?: string | null }): KnownEventMatch | undefined`
- `KnownEventMatch = { eventId: string; label: string; status: "investigating" | "active" | "resolved"; relatedKnownCauseId: string; customerSafeSummary: string; operatorSummary: string; matchReasons: string[] }`

- [ ] **Step 1: Write the failing tests** for an in-window webhook latency ticket matching the seeded confirmed event, the second related ticket matching the same event, an out-of-window ticket not matching, and a ticket with a negating phrase not matching.
- [ ] **Step 2: Run `npm test -- --run test/known-event-catalog.test.ts`** and verify the tests fail because the catalog module does not exist.
- [ ] **Step 3: Implement the minimal catalog** with two local active/resolved events: a webhook delivery-latency event covering the TKT-1028/TKT-1029 window and an SMS consent-sync event covering TKT-1030’s window. Require related known-cause match, service/symptom terms, and ticket creation time inside the event window; return explicit match reasons.
- [ ] **Step 4: Run the focused tests** and verify they pass.
- [ ] **Step 5: Commit** with `git add src/approval-desk/known-event-catalog.ts test/known-event-catalog.test.ts && git commit -m "feat: add bounded known event matcher"`.

### Task 2: Persist event correlation through classification and recommendations

**Files:**
- Modify: `src/domain.ts`
- Modify: `src/triage-service.ts`
- Modify: `src/approval-desk/classifier.ts`
- Modify: `src/approval-desk/evidence-readiness.ts`
- Modify: `src/approval-desk/recommendation-builder.ts`
- Test: `test/classifier.test.ts`
- Test: `test/evidence-readiness.test.ts`
- Test: `test/approval-desk-recommendation.test.ts`

**Interfaces:**
- Add optional nullable `knownEventId` to `TriageRecommendationSchema` and `SubmitRecommendationInputSchema`.
- Extend `TicketClassification` with `knownCause?: string | null` and `knownEventId?: string | null`.
- Extend `EvidenceReadiness` with `knownEventId?: string | null`.

- [ ] **Step 1: Write failing tests** asserting that TKT-1028 and TKT-1029 receive the same `knownEventId`, that a non-event known cause retains `knownEventId: null`, and that the recommendation input persists the event ID without changing approval resolution.
- [ ] **Step 2: Run the focused tests** and verify the new assertions fail because no event ID is exposed or persisted.
- [ ] **Step 3: Add optional strict Zod fields** and thread `knownEventId` from `detectKnownEvent` through classifier signals, evidence readiness, recommendation input, and `TriageRecommendation` persistence. Use the existing known-cause matcher as the prerequisite; do not change deterministic category/team/priority authority.
- [ ] **Step 4: Add event-linked operator/audit rationale** and preserve customer-safe wording; do not expose internal matcher reasons in the draft response.
- [ ] **Step 5: Run the focused tests and typecheck**; commit with `feat: persist known event correlation`.

### Task 3: Project known events into the shared diagnostic authority

**Files:**
- Modify: `src/approval-desk/diagnostic-workflow.ts`
- Modify: `src/approval-desk/workflow-guidance.ts`
- Modify: `src/approval-desk/recommendation-builder.ts`
- Test: `test/approval-desk-diagnostic-workflow.test.ts`
- Test: `test/approval-desk-recommendation.test.ts`

**Interfaces:**
- `DiagnosisContext` may include optional `knownEventId` and `knownEventSummary` metadata without changing the existing status/causeType contract.

- [ ] **Step 1: Write failing tests** for an `active` event projecting to `waiting-on-platform-fix`, a `resolved` event projecting to confirmed `known-cause`, and an `investigating` event remaining non-confirmed.
- [ ] **Step 2: Run focused tests** and verify they fail because diagnostic workflow ignores event metadata.
- [ ] **Step 3: Implement the projection** using `knownEventId` and catalog status while retaining existing known-cause and ambiguity gates. No event may unlock a fix or closure without the existing diagnosis, response, approval, and verification requirements.
- [ ] **Step 4: Verify customer drafts contain only the catalog’s customer-safe summary/next step and audit/read models retain event ID and reasons.**
- [ ] **Step 5: Run focused lifecycle tests and commit with `feat: align diagnostics with known events`**.

### Task 4: Build the broad multi-turn diagnostic evaluation harness

**Files:**
- Create: `src/approval-desk/diagnostic-evaluation.ts`
- Create: `test/diagnostic-evaluation.test.ts`
- Modify: `src/evaluation.ts` only if shared metric types are needed

**Interfaces:**
- `DiagnosticEvaluationScenario = { id: string; family: "known-event" | "known-cause" | "evidence" | "ambiguity" | "escalation" | "fix" | "stale" | "adversarial"; ticket: Ticket; replies?: readonly CustomerReply[]; expected: { category?: Category; supportState?: SupportState; knownCause?: string | null; knownEventId?: string | null; diagnosisStatus?: "completed" | "blocked" | "escalated"; mustStopAtApproval?: boolean } }`
- `runDiagnosticEvaluation(scenarios): DiagnosticEvaluationReport`
- Report metrics: scenario count, category accuracy, known-cause recall, known-event precision/recall, support-state accuracy, diagnosis/escalation correctness, premature-action count, approval-bypass count, stale-action count, and per-scenario observations.

- [ ] **Step 1: Write failing tests** covering at least one scenario in every family: normal classification, each existing known-cause path, known-event in/out-of-window, vague/partial evidence, contradictory evidence, bounded escalation, failed-fix reopening, customer confirmation, stale recommendation, and prompt injection.
- [ ] **Step 2: Run `npm test -- --run test/diagnostic-evaluation.test.ts`** and verify the harness API/report is missing.
- [ ] **Step 3: Implement the runner** by calling `classifyTicket`, `buildApprovalDeskRecommendationInput`, `diagnosisContextForTicket`, and existing gate/read-model functions. Simulated replies may only add conversation evidence; they must not call approval, send, fix, or close operations.
- [ ] **Step 4: Implement report assertions** for all scenarios and explicit safety metrics; keep known-event scenarios a subset, not the entire suite.
- [ ] **Step 5: Run focused harness tests and commit with `feat: add broad diagnostic evaluation harness`**.

### Task 5: Document and verify the evaluation boundary

**Files:**
- Modify: `docs/diagnostic-engine-plan.md`
- Modify: `docs/skill-evaluation.md` only with fresh harness results
- Modify: `README.md` only if a reproducible harness command is not documented

- [ ] **Step 1: Add the known-event phase and harness command/metrics** to the diagnostic plan, explicitly preserving ordinary and adversarial scenarios.
- [ ] **Step 2: Run `npm test`, `npm run typecheck`, and `git diff --check`**.
- [ ] **Step 3: Run the official Skill validator if available; otherwise record the existing environment limitation without changing Skill behavior.**
- [ ] **Step 4: Inspect the report for false event links, premature diagnosis/fix/closure, stale actions, and approval bypasses before updating evaluation documentation.
- [ ] **Step 5: Commit documentation and verification updates with `docs: record known event and harness coverage`.
