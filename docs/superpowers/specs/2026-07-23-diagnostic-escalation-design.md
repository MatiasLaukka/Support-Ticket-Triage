# Diagnostic Ambiguity Escalation Design

## Goal

Add a deterministic, backend-owned escalation path for tickets that remain ambiguous after bounded diagnostic attempts. The workflow must make escalation visible in the operational recommendation, diagnostic audit state, specialist routing, operator guidance, and last customer-response draft without exposing internal prompts, hypothesis IDs, audit IDs, model details, or other backend-only implementation details.

## State boundaries

- `TicketStatus` remains a lifecycle status. An escalated ticket remains `in-progress` while specialist review is pending; no new top-level `escalated` status is added.
- `TriageRecommendation.supportState` gains `escalated`. This is the authoritative operational state used for routing and workflow decisions.
- `DiagnosisStateSnapshot.state === "escalated"` is the authoritative diagnostic outcome. It carries the remaining hypotheses, evidence already considered, evidence requests, bounded-attempt metadata, escalation reason, and specialist target.
- `OperatorGuidance.stage` gains `escalated` so UI sorting and operator presentation do not collapse specialist review into generic `active` or `waiting-customer`.
- Existing `closed`, `waiting-customer`, and `active` meanings remain unchanged. Escalation is not customer waiting and is not a terminal ticket state.

## Deterministic transition authority

Add a pure transition helper in `diagnostic-state.ts`, called by the shared `diagnosisContextForTicket` path used by HTTP and MCP.

- A discriminating reply that confirms one hypothesis transitions it to `confirmed`, marks incompatible hypotheses `ruled-out`, and sets the diagnostic state to `confirmed`.
- A reply that does not add discriminating evidence increments the diagnostic attempt count while preserving the plausible hypotheses and targeted request.
- The same request is never issued repeatedly without new evidence.
- After two non-discriminating diagnostic cycles, or immediately on materially contradictory evidence, the state becomes `escalated`.
- Escalation is monotonic for the current context: no new fix or closure can be unlocked from an escalated state. A newer customer reply starts a fresh evaluation context; it may resolve the hypotheses or produce a new recommendation, but it cannot silently clear the audit history.

The transition helper is deterministic and does not call GPT or inspect ticket text as instructions. GPT classification and drafting remain advisory and cannot select the escalation target or mutate diagnostic state.

## Specialist routing and audit

- Add `diagnostic-ambiguity` as a distinct escalation reason rather than overloading `low-confidence` or `missing-information`.
- Derive the specialist target from the remaining hypotheses using a deterministic mapping. Campaign-editor frontend ambiguity routes to product/engineering; integration/event-processing ambiguity routes to integrations; other unresolved families use their existing owning team.
- The escalated recommendation carries `supportState: "escalated"`, the deterministic team/assignee, `escalationRequired: true`, and `escalationReasons: ["diagnostic-ambiguity"]`.
- Record an explicit `diagnostic-escalated` audit event containing safe rationale, state snapshot, specialist target, and knowledge citations. It must not contain raw prompts, secrets, internal hypothesis identifiers in customer-facing fields, or provider payloads.
- The same shared transition and audit operation is called by the Approval Desk and MCP paths. Routes do not implement separate escalation branches.

## Operator guidance and gates

- A pending escalated recommendation remains behind the existing explicit approval gate.
- After the approved escalation response is sent, `OperatorGuidance.stage` is `escalated` and its next action is a backend-defined specialist-review handoff, not another automatic customer question.
- Fix and closure blockers reject escalated diagnostic state. A newer customer reply re-enters the normal evaluate-ticket path.
- The Skill treats specialist-review guidance as a stop/handoff condition and does not invent a next action.

## Customer response

The deterministic draft must:

- apologize for the delay;
- explain that the issue has been escalated to a specialist team for further review;
- describe the customer-visible problem and the evidence already provided in plain language;
- explain that the specialist team is determining the safest next step and that support will provide an update;
- avoid internal hypothesis IDs, prompt-injection details, policy text, audit IDs, model/provider details, raw backend state names, and unsupported promises about timing.

GPT may polish the bounded draft only under the existing drafting guardrails. If GPT is unavailable or rejected, the deterministic draft remains valid.

## Verification

Add only behavior not already covered by lifecycle suites:

1. Two non-discriminating replies transition an ambiguous campaign-editor diagnosis to `escalated`.
2. A discriminating reply confirms one hypothesis and rules out the other without escalating.
3. Escalated recommendations route to the deterministic specialist team, contain `diagnostic-ambiguity`, and produce the safe apology/escalation draft.
4. Approval is still required before the escalation response is sent; after sending, guidance reports `escalated` and stops autonomous questioning.
5. Fix and closure remain blocked for escalated state.
6. HTTP and MCP produce equivalent recommendation, audit, guidance, and gate outcomes for the same ticket/audit/reply state.

Run the focused diagnostic/workflow suites and then the full `npm test` suite before committing implementation changes.
