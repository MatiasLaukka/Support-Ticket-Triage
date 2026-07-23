# Diagnostic Engine Implementation Plan

> This plan is the architectural reference for the diagnostic-engine phases. It reflects the merged repository state at commit `dd4d40a` (`feat: add known event correlation and diagnostic harness`).

## Goal

Evolve support handling from checklist-driven, one-pass triage into an evidence-aware iterative diagnostic lifecycle. Every evaluation uses the accumulated conversation and authoritative workflow context; a recommendation remains a proposal behind explicit human approval; diagnosis, fixes, verification, and closure advance only when their evidence and lifecycle preconditions are satisfied.

## Implementation status

- Complete: shared UI/MCP diagnostic and fix authority (`6b53236`).
- Complete: semantic fixture-independent playbook, fix, and simulated-reply routing (`799c498`).
- Complete first increment: persisted `diagnosticState` snapshots for ambiguous campaign-editor diagnoses (`276e667`).
- Complete first increment: Skill wording now treats backend workflow guidance as the only operational instruction (`d3ab333`; official validator passes).
- Complete increment: the shared workflow authority now uses persisted diagnostic state to block ambiguous fixes, requires the approved diagnosis response before fix availability, and surfaces targeted evidence requests to both UI and MCP read models.
- Complete increment: bounded diagnostic ambiguity escalation is enforced with deterministic specialist routing, explicit escalation audits, safe customer messaging, and shared UI/MCP gates.
- Complete increment: bounded deterministic known-event correlation links in-window tickets to local, auditable incident records without changing the shared diagnostic authority.
- Complete increment: the broad deterministic multi-turn evaluation harness covers ordinary triage, known causes/events, evidence, ambiguity, escalation, fixes, stale replies, and adversarial text.
- Next: review the workflow/read model and portfolio presentation using the harness results.

## Current audit

### Already enforced

- Customer replies are persisted as audit events and make prior recommendations stale. `diagnosisBlockers`, `buildOperatorGuidance`, and the recommendation read models require re-evaluation when a reply is newer than the evaluated context.
- Missing required evidence blocks diagnosis except for deterministic known-cause paths.
- `likely` and `confirmed` diagnosis confidence are distinct. The shared diagnostic playbook keeps platform and campaign-editor diagnoses `likely` until confirming reply evidence exists.
- Fix availability requires a recorded `confirmed` diagnosis owned by engineering or an integration partner.
- Fix availability also requires that the diagnosis response has been sent and that no newer customer reply is awaiting evaluation. An `ambiguous` diagnostic state remains a permissible working diagnosis for evidence gathering, but it cannot unlock a fix. After two non-discriminating cycles, or contradictory evidence, the state becomes `escalated`; escalated diagnoses cannot unlock fixes or closure.
- Close actions require a `ready-for-close` recommendation and an explicitly approved/sent closing response.
- Approval is a hard boundary in both HTTP and MCP paths. Only explicitly approved fields can be applied or sent.
- Prompt-injection detection is a deterministic preflight. GPT classification/drafting is skipped for affected tickets, the operator/audit warning is retained, and the customer response does not expose the internal detection.
- Known causes and known events are separate concepts. The deterministic event catalog links only scoped, time-bounded service symptoms to an active, investigating, or resolved event; recommendations persist the event ID and match reasons for operator/audit use.
- HTTP and MCP now call the same shared `diagnosisContextForTicket`, `fixContextForTicket`, `latestDiagnosisAudit`, operator-guidance, and gate functions. MCP passes the accumulated customer-reply audits into diagnosis. Escalated recommendations remain `in-progress`, carry `supportState: "escalated"`, route deterministically to a specialist team, and wait at `specialist-review` after the approved response is sent.

### Partially enforced

- Evidence readiness is separate from confidence in the current `DiagnosisContext`, and persisted `diagnosticState` snapshots represent multiple plausible campaign-editor candidates, bounded attempts, evidence requests, and specialist routing. The broader candidate/refutation model still needs more diagnostic families.
- The workflow exposes `diagnosis-ready`, `diagnosis-recorded`, `fix-ready`, `verification`, and `escalated` stages. Ambiguity is a first-class fix/close blocker; targeted evidence is shown while ambiguity is bounded, then specialist review becomes a stop/handoff state with no new autonomous question.
- Fix verification re-enters evaluation through the workflow, but the terminal conditions are encoded mainly through recommendation lifecycle rules rather than a dedicated verification state/result.
- The triaging Skill now requires workflow reads, full conversation evaluation, approval, and stopping at specialist handoff without using GPT next-step text as agent instructions. `operatorGuidance.nextAction`, evidence, blockers, and approval fields remain the only operational authority.

### Remaining opportunities

- The diagnostic engine does not yet ask for the smallest evidence that distinguishes every remaining hypothesis. Evidence requests are still primarily checklist-derived; this is a future refinement, not a gap in the current safety gates.
- The candidate/refutation model has deeper coverage for campaign-editor ambiguity than for other diagnostic families. Extending that model is future work; the current harness already covers ambiguity, escalation, failed-fix recheck, stale replies, and adversarial text.

## Architectural decisions

1. Preserve `EvidenceReadiness`, deterministic classifier/risk policy, audit repositories, approval gates, workflow guidance, and the shared diagnostic workflow module.
2. Keep GPT classification and drafting advisory. GPT may supply bounded, auditable suggestions, but deterministic safety, routing, evidence, diagnosis state, approval, audit, and closure rules remain authoritative.
3. Add diagnostic ambiguity incrementally rather than replacing `DiagnosisContext` in one rewrite. First remove fixture branches; then introduce a small diagnostic-state/candidate result that can be projected into the existing audit and drafting shapes.
4. Use semantic ticket content, recommendation classification, knowledge IDs, evidence, and conversation history for playbook selection. Ticket IDs may remain in fixtures and expected-outcome data only.
5. Prefer the existing `get_ticket_workflow` read model as the authoritative MCP context read. Do not add a separate workflow-state tool unless a later phase proves that the current read model cannot expose a required state.

## Phased implementation

### Phase 1 — Semantic diagnostic authority (complete)

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

### Phase 2 — Explicit diagnostic state, ambiguity, and bounded escalation (complete)

Introduce a small deterministic diagnostic result behind the current `DiagnosisContext` projection. The result distinguishes ambiguous, confirmed, and escalated outcomes and carries candidate hypotheses, bounded attempts, confirming evidence, specialist routing, and targeted requests. `missingEvidence` remains evidence readiness; it is not a diagnosis-complete flag.

Files:

- Create `src/approval-desk/diagnostic-state.ts` with Zod-validated candidate/state types and deterministic helpers.
- Extend `src/approval-desk/diagnostic-playbooks.ts` to return candidate state and evidence discrimination metadata while preserving the existing `DiagnosisContext` projection for audit compatibility.
- Modify `src/approval-desk/workflow-guidance.ts` so ambiguous states block fix availability/closure, require the diagnosis response to be sent before fix work, and surface targeted evidence requests. Escalated states block diagnosis/fix/closure continuation and surface `specialist-review` after the approved escalation response is sent.
- Modify `src/approval-desk/recommendation-builder.ts` and deterministic drafting helpers so likely/ambiguous wording cannot claim a final root cause or fix.
- Modify `src/triage-service.ts` schemas only when the projected audit needs persisted diagnostic-state fields.

Required tests (one behavior per test, only where not already covered):

- Complete evidence with two plausible causes stays ambiguous.
- A high-value discriminating reply moves one candidate to confirmed and another to ruled out.
- Unresolvable ambiguity escalates after the bounded attempt limit instead of generating infinite questions.
- A likely diagnosis cannot unlock `mark_fix_available` or closure.

### Phase 3 — Skill and authoritative context alignment (complete)

Update `.agents/skills/triaging-support-tickets/SKILL.md` to describe the iterative lifecycle without using GPT next steps as instructions. The agent must read `get_ticket_workflow`, evaluate the full accumulated conversation, follow `operatorGuidance.nextAction`, present evidence/blockers/approval fields, stop at human gates and specialist handoff, and re-evaluate after every customer reply or fix verification result.

Files:

- Modify `.agents/skills/triaging-support-tickets/SKILL.md`.
- Update its referenced AI workflow guidance only where it conflicts with deterministic backend authority.
- Update `docs/skill-evaluation.md` after the new evaluation run; do not embed raw GPT advisory next steps as operational instructions.

Verification:

- Run the official Skill validator.
- Run the existing skill evaluation and inspect the captured customer responses, operator guidance, audit fields, stale-context blockers, and approval stops.

### Phase 4 — Bounded known-event correlation (complete)

Add a local deterministic known-event catalog on top of the existing known-cause catalog. Known-event matching requires a related known cause, service and symptom matches, and a ticket creation timestamp inside the event window. Active events project to the existing `waiting-on-platform-fix` state; resolved events retain confirmed known-cause guidance; investigating events remain non-confirmed. No event link bypasses diagnosis, approval, fix, verification, or closure gates.

Files:

- `src/approval-desk/known-event-catalog.ts` owns event definitions and matching.
- `src/approval-desk/classifier.ts`, `evidence-readiness.ts`, and `recommendation-builder.ts` persist event IDs and match reasons.
- `diagnostic-workflow.ts`, `triage-service.ts`, and the MCP read path expose event metadata without leaking it into customer drafts.
- `test/known-event-catalog.test.ts` and focused classifier/evidence/diagnostic tests cover positive, negative, active, investigating, and resolved event behavior.

### Phase 5 — Multi-turn diagnostic evaluation harness (complete)

Build a deterministic evaluation harness around diagnostic families rather than around one fixture. The initial runner covers eleven scenarios across eight families: ordinary triage, known causes, active/out-of-window known events, partial evidence, ambiguity, bounded specialist escalation, failed-fix recheck, customer confirmation, stale replies, and adversarial prompt-injection text. Simulated customer replies may reveal hidden evidence only in response to the active diagnostic question; they must not bypass approval or policy.

Files:

- Create `src/approval-desk/diagnostic-evaluation.ts` and `test/diagnostic-evaluation.test.ts` after the event/state contract is stable.
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
- known-event precision and recall;
- turns to diagnosis and resolution;
- human intervention and GPT token/cost telemetry where available.

### Phase 6 — Workflow/read-model review and portfolio presentation (next)

After the diagnostic state is stable, verify whether `get_ticket_workflow` already provides ticket, conversation, recommendation, workflow, evidence, diagnosis, and fix/verification state. Only add a tool if a concrete missing read capability is demonstrated. Then refresh the case study/demo to show multi-turn evidence, ambiguity, approval, verification, and legitimate closure without relying primarily on TKT-1010.

## Scope guardrails

- Do not implement live telemetry or integrations in this effort.
- Do not train or fine-tune a model.
- Do not allow GPT to mutate approval fields or diagnostic state.
- Do not treat complete evidence checklists as diagnosis or resolution.
- Do not add tests that duplicate existing HTTP/MCP lifecycle coverage; each new test must prove a new invariant or regression.
- Do not change `docs/diagnostic-engine-plan.md` and code in the same phase without running the relevant focused and full test suites.
