# Diagnostic Engine Implementation Plan

> This plan is the architectural reference for the next diagnostic-engine phases. It is adjusted to the repository state after commit `6b53236` (`refactor shared diagnostic workflow authority`).

## Goal

Evolve support handling from checklist-driven, one-pass triage into an evidence-aware iterative diagnostic lifecycle. Every evaluation uses the accumulated conversation and authoritative workflow context; a recommendation remains a proposal behind explicit human approval; diagnosis, fixes, verification, and closure advance only when their evidence and lifecycle preconditions are satisfied.

## Current audit

### Already enforced

- Customer replies are persisted as audit events and make prior recommendations stale. `diagnosisBlockers`, `buildOperatorGuidance`, and the recommendation read models require re-evaluation when a reply is newer than the evaluated context.
- Missing required evidence blocks diagnosis except for deterministic known-cause paths.
- `likely` and `confirmed` diagnosis confidence are distinct. The shared diagnostic playbook keeps platform and campaign-editor diagnoses `likely` until confirming reply evidence exists.
- Fix availability requires a recorded `confirmed` diagnosis owned by engineering or an integration partner.
- Close actions require a `ready-for-close` recommendation and an explicitly approved/sent closing response.
- Approval is a hard boundary in both HTTP and MCP paths. Only explicitly approved fields can be applied or sent.
- Prompt-injection detection is a deterministic preflight. GPT classification/drafting is skipped for affected tickets, the operator/audit warning is retained, and the customer response does not expose the internal detection.
- HTTP and MCP now call the same shared `diagnosisContextForTicket` and `fixContextForTicket` functions. MCP passes the accumulated customer-reply audits into diagnosis.

### Partially enforced

- Evidence readiness is separate from confidence in the current `DiagnosisContext`, but the model has only one completed diagnosis shape. It cannot yet represent multiple active candidates, explicitly ruled-out candidates, or a discriminating question.
- The workflow exposes `diagnosis-ready`, `diagnosis-recorded`, `fix-ready`, and `verification` stages, but diagnostic ambiguity is not a first-class blocker. A broad fallback can still produce a `likely` completed context instead of an explicit ambiguous/escalated state.
- Fix verification re-enters evaluation through the workflow, but the terminal conditions are encoded mainly through recommendation lifecycle rules rather than a dedicated verification state/result.
- The triaging Skill correctly requires workflow reads, full conversation evaluation, approval, and stopping while waiting, but it still mentions GPT advisory next steps in a way that can distract from backend authority. `operatorGuidance.nextAction`, evidence, blockers, and approval fields must remain the only operational authority.

### Missing or unsafe

- Production diagnostics still contain fixture-specific branches:
  - `src/approval-desk/diagnostic-playbooks.ts` selects the campaign-editor playbook for `ticket.id === "TKT-1010"`.
  - `src/approval-desk/diagnostic-workflow.ts` selects a campaign-editor fix for `ticket.id === "TKT-1010"`.
  - `src/approval-desk/automatic-customer-replies.ts` emits campaign-editor replies for `ticket.id === "TKT-1010"`.
- The diagnostic engine does not yet ask for the smallest evidence that distinguishes remaining hypotheses. Evidence requests are primarily checklist-derived.
- There is no risk-sensitive multi-turn evaluation harness for premature diagnosis, premature resolution, unnecessary questions, ambiguity escalation, or failed-fix reopening.

## Architectural decisions

1. Preserve `EvidenceReadiness`, deterministic classifier/risk policy, audit repositories, approval gates, workflow guidance, and the shared diagnostic workflow module.
2. Keep GPT classification and drafting advisory. GPT may supply bounded, auditable suggestions, but deterministic safety, routing, evidence, diagnosis state, approval, audit, and closure rules remain authoritative.
3. Add diagnostic ambiguity incrementally rather than replacing `DiagnosisContext` in one rewrite. First remove fixture branches; then introduce a small diagnostic-state/candidate result that can be projected into the existing audit and drafting shapes.
4. Use semantic ticket content, recommendation classification, knowledge IDs, evidence, and conversation history for playbook selection. Ticket IDs may remain in fixtures and expected-outcome data only.
5. Prefer the existing `get_ticket_workflow` read model as the authoritative MCP context read. Do not add a separate workflow-state tool unless a later phase proves that the current read model cannot expose a required state.

## Phased implementation

### Phase 1 — Semantic diagnostic authority (current)

Remove all diagnostic/fix/customer-reply production branches keyed to a fixture ID. Keep the campaign-editor behavior by recognizing semantic context such as `performance-troubleshooting`, campaign-editor symptoms, and the recorded diagnosis summary. Change the MCP regression fixture ID while preserving its content and assert that diagnosis/fix behavior is unchanged.

Files:

- Modify `src/approval-desk/diagnostic-playbooks.ts` to select the campaign-editor playbook from semantic recommendation/context only.
- Modify `src/approval-desk/diagnostic-workflow.ts` to select fix wording from the recorded semantic diagnosis, not `ticket.id`.
- Modify `src/approval-desk/automatic-customer-replies.ts` to select simulated campaign-editor evidence/resolution replies from semantic context, not `ticket.id`.
- Modify `test/server-actions.test.ts` to use a non-fixture ticket ID for the shared-playbook regression and cover the semantic fix path without adding a duplicate UI test.
- Add a focused source audit assertion or repository check only if existing tests cannot prove all three branches are ID-independent.

Verification:

```powershell
npm test -- --run test/server-actions.test.ts test/approval-desk-http.test.ts
```

Expected result: all selected lifecycle tests pass, including the existing TKT-1010 UI coverage and the changed-ID MCP regression.

### Phase 2 — Explicit diagnostic state and ambiguity

Introduce a small deterministic diagnostic result behind the current `DiagnosisContext` projection. The result must distinguish `not-started`, `insufficient-evidence`, `ambiguous`, `working-diagnosis`, `confirmed`, and `escalated`, and must carry candidate hypotheses with confidence, confirming/refuting evidence, and the smallest useful discriminating request. `missingEvidence` remains evidence readiness; it must not be used as a diagnosis-complete flag.

Files:

- Create `src/approval-desk/diagnostic-state.ts` with Zod-validated candidate/state types and deterministic helpers.
- Extend `src/approval-desk/diagnostic-playbooks.ts` to return candidate state and evidence discrimination metadata while preserving the existing `DiagnosisContext` projection for audit compatibility.
- Modify `src/approval-desk/workflow-guidance.ts` so ambiguous states block `record_diagnosis` and either request targeted evidence or surface specialist escalation.
- Modify `src/approval-desk/recommendation-builder.ts` and deterministic drafting helpers so likely/ambiguous wording cannot claim a final root cause or fix.
- Modify `src/triage-service.ts` schemas only when the projected audit needs persisted diagnostic-state fields.

Required tests (one behavior per test, only where not already covered):

- Complete evidence with two plausible causes stays ambiguous.
- A high-value discriminating reply moves one candidate to confirmed and another to ruled out.
- Unresolvable ambiguity escalates instead of generating infinite questions.
- A likely diagnosis cannot unlock `mark_fix_available` or closure.

### Phase 3 — Skill and authoritative context alignment

Update `.agents/skills/triaging-support-tickets/SKILL.md` to describe the iterative lifecycle without presenting GPT next steps as instructions. The agent must read `get_ticket_workflow`, evaluate the full accumulated conversation, follow `operatorGuidance.nextAction`, present evidence/blockers/approval fields, stop at human gates, and re-evaluate after every customer reply or fix verification result.

Files:

- Modify `.agents/skills/triaging-support-tickets/SKILL.md`.
- Update its referenced AI workflow guidance only where it conflicts with deterministic backend authority.
- Update `docs/skill-evaluation.md` after the new evaluation run; do not embed raw GPT advisory next steps as operational instructions.

Verification:

- Run the official Skill validator.
- Run the existing skill evaluation and inspect the captured customer responses, operator guidance, audit fields, stale-context blockers, and approval stops.

### Phase 4 — Multi-turn diagnostic evaluation harness

Build a deterministic evaluation harness around diagnostic families rather than around one fixture. Scenarios must cover vague-to-evidence, partial evidence, misleading/contradictory evidence, ambiguity, specialist escalation, failed fixes, customer confirmation, stale recommendations, and adversarial text. Simulated customer replies may reveal hidden evidence only in response to the active diagnostic question; they must not bypass approval or policy.

Files:

- Create `test/diagnostic-evaluation.test.ts` or an equivalent existing evaluation module after Phase 2 makes the state contract stable.
- Reuse `src/approval-desk/diagnostic-playbooks.ts`, `workflow-guidance.ts`, and the existing repositories rather than creating a parallel fake engine.
- Extend `docs/skill-evaluation.md` with risk-sensitive metrics and scenario results.

Metrics:

- premature diagnosis rate;
- premature resolution rate;
- candidate recall and discriminating-question rate;
- unnecessary-question rate;
- diagnostic escalation correctness;
- stale-context action rate;
- approval bypass and unsafe autonomous action rate;
- turns to diagnosis and resolution;
- human intervention and GPT token/cost telemetry where available.

### Phase 5 — Workflow/read-model review and portfolio presentation

After the diagnostic state is stable, verify whether `get_ticket_workflow` already provides ticket, conversation, recommendation, workflow, evidence, diagnosis, and fix/verification state. Only add a tool if a concrete missing read capability is demonstrated. Then refresh the case study/demo to show multi-turn evidence, ambiguity, approval, verification, and legitimate closure without relying primarily on TKT-1010.

## Scope guardrails

- Do not implement live telemetry or integrations in this effort.
- Do not train or fine-tune a model.
- Do not allow GPT to mutate approval fields or diagnostic state.
- Do not treat complete evidence checklists as diagnosis or resolution.
- Do not add tests that duplicate existing HTTP/MCP lifecycle coverage; each new test must prove a new invariant or regression.
- Do not change `docs/diagnostic-engine-plan.md` and code in the same phase without running the relevant focused and full test suites.
