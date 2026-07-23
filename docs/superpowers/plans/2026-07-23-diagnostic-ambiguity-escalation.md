# Diagnostic Ambiguity Escalation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, bounded escalation lifecycle for unresolved diagnostic ambiguity, with explicit specialist routing, auditable state, safe customer messaging, and equivalent HTTP/MCP outcomes.

**Architecture:** Keep `TicketStatus` as the durable ticket lifecycle (`in-progress` while specialist review is pending). Add `supportState: "escalated"` to recommendations, use `DiagnosticStateSnapshot.state: "escalated"` as the diagnostic authority, and expose a distinct `OperatorGuidance.stage: "escalated"`. A pure transition helper in `diagnostic-state.ts` is called through the shared `diagnosisContextForTicket` path; UI and MCP routes only invoke shared gates and service operations.

**Tech Stack:** TypeScript, Zod schemas, Vitest, existing in-memory/file repositories, deterministic classifier/playbooks, existing approval and customer-draft guardrails.

## Global Constraints

- Do not add a top-level `TicketStatus: "escalated"`; the ticket remains `in-progress` while specialist review is pending.
- Do not overload `active`, `waiting-customer`, `closed`, `low-confidence`, or `missing-information` with diagnostic escalation semantics.
- GPT classification and drafting remain advisory; deterministic routing, state transitions, escalation reason, approval, audit, fix gating, and closure gating are authoritative.
- Customer drafts may describe a specialist escalation and apologize for delay, but must not expose prompts, hypothesis IDs, audit IDs, provider details, policy text, secrets, or raw backend state names.
- HTTP and MCP must call the same diagnostic transition, audit, recommendation, and gate functions.
- Add only tests for new escalation behavior or parity regressions; reuse existing lifecycle coverage.

---

### Task 1: Extend the domain and diagnostic-state contracts

**Files:**
- Modify: `src/domain.ts:105-145, 522-575`
- Modify: `src/approval-desk/diagnostic-state.ts:1-35`
- Modify: `src/approval-desk/workflow-guidance.ts:13-58`
- Test: `test/domain.test.ts`
- Test: `test/diagnostic-state.test.ts` (create)

**Interfaces:**
- Produces `supportState: "escalated"`, `RequiredEscalationSchema` value `"diagnostic-ambiguity"`, audit action `"diagnostic-escalated"`, and guidance values `stage: "escalated"` and `nextAction: "specialist-review"`.
- Extends `DiagnosticStateSnapshotSchema` with `diagnosticAttempts` (default `0`), optional `escalationReason` (`"diagnostic-ambiguity" | "contradictory-evidence"`), and optional `specialistTeam` (`"product" | "engineering" | "integrations" | "support"`).

- [ ] **Step 1: Write failing schema tests**

Add assertions that `TriageRecommendationSchema` accepts `supportState: "escalated"` with `escalationReasons: ["diagnostic-ambiguity"]`, `AuditEventSchema` accepts `action: "diagnostic-escalated"`, and a diagnostic snapshot defaults `diagnosticAttempts` to `0` while accepting specialist metadata.

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run: `npm test -- --run test/domain.test.ts test/diagnostic-state.test.ts`

Expected: FAIL because the new enum values and snapshot fields do not yet exist.

- [ ] **Step 3: Implement the minimal contract changes**

Add the enum literals and snapshot fields without changing existing defaults. Keep the snapshot schema strict and preserve compatibility with existing snapshots by using `z.number().int().nonnegative().default(0)` for `diagnosticAttempts`.

- [ ] **Step 4: Run the focused tests and typecheck**

Run: `npm test -- --run test/domain.test.ts test/diagnostic-state.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src/domain.ts src/approval-desk/diagnostic-state.ts src/approval-desk/workflow-guidance.ts test/domain.test.ts test/diagnostic-state.test.ts
git commit -m "feat: add diagnostic escalation state contracts"
```

### Task 2: Implement bounded deterministic diagnostic transitions

**Files:**
- Modify: `src/approval-desk/diagnostic-state.ts`
- Modify: `src/approval-desk/diagnostic-playbooks.ts:4-150`
- Modify: `src/approval-desk/diagnostic-workflow.ts:1-125`
- Test: `test/diagnostic-state.test.ts`
- Test: `test/approval-desk-diagnostic-workflow.test.ts` (create if no focused file exists)

**Interfaces:**
- Produces `advanceDiagnosticState(input: { current: DiagnosticStateSnapshot; customerReplyText: string; confirmedHypothesisId?: string; contradicted: boolean; }): DiagnosticStateSnapshot`.
- Produces deterministic campaign-editor specialist mapping: unresolved browser/frontend ambiguity targets `product`; unresolved integration/event-processing ambiguity targets `integrations`; otherwise preserve the recommendation’s owning team.
- `diagnosisContextForTicket(ticket, recommendation, audits)` remains the only route-facing diagnostic context function.

- [ ] **Step 1: Write the failing transition tests**

Cover exactly three behaviors:

```ts
expect(advanceDiagnosticState({ current: ambiguousState, customerReplyText: "Still blank, no new checks.", contradicted: false })).toMatchObject({ state: "ambiguous", diagnosticAttempts: 1 });
expect(advanceDiagnosticState({ current: { ...ambiguousState, diagnosticAttempts: 1 }, customerReplyText: "Still blank, no new checks.", contradicted: false })).toMatchObject({ state: "escalated", escalationReason: "diagnostic-ambiguity", specialistTeam: "product" });
expect(advanceDiagnosticState({ current: ambiguousState, customerReplyText: "It works in a private window.", confirmedHypothesisId: "browser-session", contradicted: false })).toMatchObject({ state: "confirmed" });
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- --run test/diagnostic-state.test.ts`

Expected: FAIL because `advanceDiagnosticState` is not implemented.

- [ ] **Step 3: Implement the minimal pure transition helper**

Use `MAX_DIAGNOSTIC_ATTEMPTS = 2`. Increment attempts only for a newer non-discriminating cycle. Return `escalated` immediately when `contradicted` is true; otherwise return `escalated` at the limit. Never repeat the same `evidenceToRequest` after escalation. Preserve hypothesis evidence arrays and update statuses only when the caller supplies a confirmed hypothesis.

- [ ] **Step 4: Integrate the helper into the semantic playbook path**

Make `diagnosisContextForTicket` read the latest persisted diagnosis snapshot and customer replies, pass the newest diagnostic evidence to `advanceDiagnosticState`, and preserve existing confirmed campaign-editor and platform-delay behavior. A newer reply may resolve an escalated context, but the prior escalation audit remains intact.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm test -- --run test/diagnostic-state.test.ts test/approval-desk-diagnostic-workflow.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- src/approval-desk/diagnostic-state.ts src/approval-desk/diagnostic-playbooks.ts src/approval-desk/diagnostic-workflow.ts test/diagnostic-state.test.ts test/approval-desk-diagnostic-workflow.test.ts
git commit -m "feat: add bounded diagnostic state transitions"
```

### Task 3: Project escalation into recommendations and safe customer drafts

**Files:**
- Modify: `src/approval-desk/recommendation-builder.ts:104-240, 447-570, 620-670`
- Modify: `src/approval-desk/draft-response-provider.ts` only if an existing drafting guardrail needs the new bounded deterministic branch
- Test: `test/approval-desk-recommendation.test.ts`
- Test: `test/draft-response-provider.test.ts` only for a new redaction assertion

**Interfaces:**
- `buildApprovalDeskRecommendationInput` emits `supportState: "escalated"`, deterministic specialist `team`, `escalationRequired: true`, and `escalationReasons` containing `diagnostic-ambiguity` when `diagnosisContext.diagnosticState.state === "escalated"`.
- `buildDraftCustomerResponse` selects a deterministic escalation draft before generic diagnosis wording.

- [ ] **Step 1: Write failing recommendation and draft tests**

Assert that an escalated campaign-editor diagnosis produces `supportState: "escalated"`, `team: "product"`, `escalationRequired: true`, `escalationReasons` containing `diagnostic-ambiguity`, and a draft containing an apology, specialist escalation, and safe next-update language. Assert that the draft does not contain `diagnosticState`, `hypothesis`, `audit`, `prompt`, `provider`, or secret-like text.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- --run test/approval-desk-recommendation.test.ts test/draft-response-provider.test.ts`

Expected: FAIL because escalated contexts currently fall through to generic likely-diagnosis wording and retain the normal support state.

- [ ] **Step 3: Implement the deterministic escalation projection**

Add a small `escalationProjectionForDiagnosis` helper in `recommendation-builder.ts` that returns the target team, reason, safe customer summary, and bounded next action. Merge its reason with existing escalation reasons using unique values; do not let GPT override the projection.

- [ ] **Step 4: Add the deterministic customer draft branch**

Use copy equivalent to: `I’m sorry this has taken longer than expected. We’ve escalated this issue to our specialist team for further review of the reported campaign editor problem. They’re reviewing the evidence you’ve already provided to determine the safest next step, and we’ll share an update as that review progresses.` Pass it through existing sign-off and draft-quality guardrails.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- --run test/approval-desk-recommendation.test.ts test/draft-response-provider.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- src/approval-desk/recommendation-builder.ts src/approval-desk/draft-response-provider.ts test/approval-desk-recommendation.test.ts test/draft-response-provider.test.ts
git commit -m "feat: draft safe diagnostic escalation responses"
```

### Task 4: Persist escalation audits and enforce shared workflow gates

**Files:**
- Modify: `src/triage-service.ts:153-190, 706-745`
- Modify: `src/approval-desk/workflow-guidance.ts:13-380`
- Modify: `src/server.ts:761-840`
- Modify: `src/approval-desk/http.ts:863-1020`
- Test: `test/workflow-guidance.test.ts`
- Test: `test/server-actions.test.ts`
- Test: `test/approval-desk-http.test.ts`

**Interfaces:**
- `TriageService.recordDiagnosis` emits `diagnostic-escalated` instead of `diagnosis-completed` when the persisted diagnostic state is escalated, with the same input contract for both routes.
- The shared `latestDiagnosisAudit` selector treats both `diagnosis-completed` and `diagnostic-escalated` as diagnosis events, so read models and fix/closure gates cannot lose an escalated diagnosis.
- `diagnosisBlockers`, `fixBlockers`, and `closeBlockers` reject invalid escalated transitions from one shared implementation.
- `buildOperatorGuidance` returns `{ stage: "escalated", nextAction: "specialist-review", approval: { required: false, fields: [] } }` after an approved escalation response is sent and no newer customer reply exists.

- [ ] **Step 1: Write failing audit/gate/guidance tests**

Add one test per new invariant: escalated diagnosis creates the explicit audit action; fix and close return an escalation blocker; an approved/sent escalated recommendation returns `stage: "escalated"` and `nextAction: "specialist-review"`; a newer customer reply returns `customer-replied` and `evaluate-ticket`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- --run test/workflow-guidance.test.ts test/server-actions.test.ts test/approval-desk-http.test.ts`

Expected: FAIL because the audit action, escalation guidance, and support-state gate do not yet exist.

- [ ] **Step 3: Implement service audit projection and shared gates**

Branch only on the validated diagnostic snapshot inside `recordDiagnosis`; keep route code free of escalation-specific policy. Add the escalated state to the existing fix/close blockers and place the new guidance branch after pending review/customer-reply precedence but before fix/close readiness.

- [ ] **Step 4: Keep HTTP and MCP routes as thin delegates**

Both routes must call the same `diagnosisContextForTicket`, `recordDiagnosis`, `diagnosisBlockers`, `fixBlockers`, and `closeBlockers` functions. Do not add route-specific escalation messages or team selection.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- --run test/workflow-guidance.test.ts test/server-actions.test.ts test/approval-desk-http.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- src/triage-service.ts src/approval-desk/workflow-guidance.ts src/server.ts src/approval-desk/http.ts test/workflow-guidance.test.ts test/server-actions.test.ts test/approval-desk-http.test.ts
git commit -m "feat: enforce shared diagnostic escalation gates"
```

### Task 5: Align the Skill, read models, and parity regression coverage

**Files:**
- Modify: `.agents/skills/triaging-support-tickets/SKILL.md`
- Modify: `src/approval-desk/workflow-read-model.ts` only if the existing read model omits the new guidance stage
- Test: `test/skill.test.ts`
- Test: `test/server-read.test.ts`
- Test: `test/approval-desk-http.test.ts` only for the read-model projection

**Interfaces:**
- The Skill treats `operatorGuidance.nextAction` as authoritative. `specialist-review` is a stop/handoff state; the agent must not invent another customer question or autonomous mutation.
- HTTP and MCP workflow reads expose equivalent escalated stage, recommendation state, audit action, and blocker data.

- [ ] **Step 1: Write failing Skill/read-model parity assertions**

Assert the Skill mentions `specialist-review` as a backend-owned stop condition and does not present GPT advisory next steps as instructions. Assert both read paths expose `stage: "escalated"` after the same approved/sent escalation state.

- [ ] **Step 2: Run focused tests and validator to verify RED**

Run: `npm test -- --run test/skill.test.ts test/server-read.test.ts`

Expected: the new assertions fail until the Skill/read model is updated.

- [ ] **Step 3: Update the Skill and read model**

Describe the customer-safe escalation handoff, explicit approval gate, and re-evaluation after a newer reply. Do not include raw internal state, hypothesis IDs, or provider output in customer-facing instructions.

- [ ] **Step 4: Run focused tests and the official validator**

Run: `npm test -- --run test/skill.test.ts test/server-read.test.ts`

Expected: PASS.

Run: `python C:\Users\matia\.codex\skills\.system\skill-creator\scripts\quick_validate.py .agents/skills/triaging-support-tickets`

Expected: `Skill is valid!`.

- [ ] **Step 5: Commit**

```powershell
git add -- .agents/skills/triaging-support-tickets/SKILL.md src/approval-desk/workflow-read-model.ts test/skill.test.ts test/server-read.test.ts test/approval-desk-http.test.ts
git commit -m "docs: align Skill with diagnostic escalation handoff"
```

### Task 6: Full verification and documentation

**Files:**
- Modify: `docs/diagnostic-engine-plan.md`
- Modify: `docs/skill-evaluation.md` only if the escalation showcase/evaluation is run

- [ ] **Step 1: Run the complete suite**

Run: `npm test`

Expected: all test files and tests pass.

- [ ] **Step 2: Run static checks**

Run: `npm run typecheck`

Expected: PASS.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 3: Update the plan status**

Mark bounded ambiguity escalation complete, record the specialist-review handoff and remaining Phase 4 evaluation-harness work, and preserve the distinction between customer waiting and specialist escalation.

- [ ] **Step 4: Commit the documentation and verify the worktree**

```powershell
git add -- docs/diagnostic-engine-plan.md docs/skill-evaluation.md
git commit -m "docs: record diagnostic escalation completion"
git status --short
```

Expected: the worktree is clean.
