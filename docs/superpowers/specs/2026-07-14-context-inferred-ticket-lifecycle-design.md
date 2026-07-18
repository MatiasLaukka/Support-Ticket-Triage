# Context-Inferred Ticket Lifecycle Design

## Goal

Show that the automation can infer the current support lifecycle state from ticket text, customer replies, known causes, account facts, and evidence readiness. The demo should make multi-turn ticket handling visible without letting UI controls directly choose the state.

## Current State

The backend already computes useful lifecycle-like fields:

- `supportState`;
- `knownCause`;
- `requiredEvidence`;
- `providedEvidence`;
- `missingEvidence`;
- `nextInvestigationSteps`;
- `draftCustomerResponse`;
- `conversationHistory` from audit events.

The Approval Desk UI surfaces some of these values in internal details, but the reviewer cannot easily demonstrate how the state changes after a customer replies. There is also no clear UI distinction between a button that simulates a customer reply and the automation's inferred lifecycle state.

## Core Principle

Lifecycle state must be inferred from context, not from the order of demo actions.

Scenario controls may add synthetic customer replies, but they must not set `supportState` directly. A first ticket or first reply can still be inferred as `known-cause`, `waiting-on-platform-fix`, `ready-for-close`, `diagnosing`, `needs-information`, or `information-received` depending on the evidence and language present.

## Lifecycle States

Use the existing support states where possible. The state labels should remain backend-owned and deterministic:

- `needs-information`: required evidence is missing.
- `information-received`: at least one useful new evidence item is present, but required evidence is still incomplete.
- `known-cause`: context matches a known cause and enough required evidence exists to recommend the known path.
- `waiting-on-platform-fix`: evidence points to an internal/platform issue the customer cannot resolve themselves.
- `ready-for-close`: the latest customer context clearly confirms the issue is resolved.
- `diagnosing`: enough evidence exists to investigate, but no known cause or platform-fix path is clear.

The detector must not assume chronological progress. It should evaluate the whole available context, with the latest customer reply weighted for resolution confirmations or new facts.

## Demo Interaction

Add a **Conversation Context** section for the selected ticket.

The section should include scenario controls that append realistic customer reply text:

- `Add vague reply`
- `Add partial evidence`
- `Add complete evidence`
- `Add known-cause evidence`
- `Add platform-fix context`
- `Add resolved confirmation`
- `Clear replies`

These controls are demo fixtures. They simulate customer messages but do not set lifecycle state. After a reply is added, the reviewer creates a new recommendation. The recommendation should be generated from the ticket plus current replies.

The section should show the current synthetic replies so the reviewer can see what context the automation is reading.

Keep this section visually compact. By default it should show a short summary such as the number of replies currently attached and the most recent reply preview. The full reply list and scenario controls should be tucked into a disclosure or similarly lightweight panel so the ticket subject, description, draft response, classifier evidence, and lifecycle summary remain the main presentation elements.

## Recommendation View

The recommendation panel should include a compact lifecycle summary, preferably near the classifier evidence and before the customer draft:

- detected lifecycle state;
- known cause, if any;
- provided evidence count;
- missing evidence count;
- next recommended action.

Details can remain collapsible:

- provided evidence labels;
- missing evidence labels;
- lifecycle rationale;
- current customer replies used as context.

Approval controls should remain focused on approving named fields. Lifecycle evidence is explanatory only and must not bypass human approval.

## Backend Flow

Recommendation creation should accept the current synthetic replies from the Approval Desk demo state.

The backend should:

1. Combine the selected ticket with current customer replies.
2. Extract reusable account facts from the ticket and replies.
3. Analyze evidence readiness from the combined context.
4. Detect known causes from the combined context, with negation handling.
5. Infer `supportState` from evidence, known cause, platform-impact language, and resolution confirmation.
6. Generate the deterministic or GPT-assisted draft from the inferred state.

The UI may store synthetic replies in browser state for the demo. They do not need to be persisted across page reloads in this phase.

## Inference Rules

The lifecycle detector should prefer explicit evidence over sequence:

- A vague first ticket with missing required fields becomes `needs-information`.
- A first ticket with all required evidence and a matched known cause can become `known-cause`.
- A reply with some evidence but remaining required fields becomes `information-received`.
- A ticket or reply describing broad service impact, incident review, or internal processing delay can become `waiting-on-platform-fix` when the customer cannot self-remediate.
- A customer message that clearly says the issue is fixed becomes `ready-for-close`, unless negated by unresolved language.
- If required evidence is present but no known cause or platform-fix path is detected, use `diagnosing`.

Negation and contradiction handling matters:

- "This is not fixed" must not become `ready-for-close`.
- "We ruled out secret rotation" must not become a secret-rotation known cause.
- "One profile is missing one event after multiple retries" must not become a platform outage just because it contains "multiple".

## Customer Draft Behavior

Draft responses should match the inferred state:

- `needs-information`: acknowledge the problem and ask only for missing evidence.
- `information-received`: thank the customer for what they provided and ask only for remaining evidence.
- `known-cause`: explain the likely cause and the corrective path, with any necessary confirmation request.
- `waiting-on-platform-fix`: acknowledge the platform-side issue and set expectations for investigation/fix updates.
- `diagnosing`: explain what support will check next and avoid premature cause claims.
- `ready-for-close`: thank the customer and close warmly without asking for more diagnostics.

Drafts must avoid duplicate evidence requests when multiple categories require the same item.

## Non-Goals

- Do not build a full manual conversation editor yet.
- Do not persist synthetic replies to disk in this phase.
- Do not let demo controls set `supportState` directly.
- Do not remove existing approval/audit safeguards.
- Do not add a separate lifecycle dashboard.

## Testing

Add backend tests that prove lifecycle state is inferred from content rather than step order:

- vague reply -> `needs-information`;
- partial evidence -> `information-received`;
- complete known-cause evidence as first context -> `known-cause`;
- platform-impact context as first context -> `waiting-on-platform-fix`;
- resolved confirmation as first context -> `ready-for-close`;
- negated resolution stays out of `ready-for-close`;
- ruled-out known cause stays out of that known cause.

Add UI tests that prove:

- scenario buttons append customer reply text;
- generated recommendations use the current replies;
- lifecycle summary appears in the recommendation panel;
- clearing replies changes the next recommendation context;
- lifecycle controls do not directly set `supportState`.

## Acceptance Criteria

- A reviewer can demonstrate at least three different lifecycle states from one selected ticket by adding different customer reply fixtures.
- The UI clearly distinguishes customer conversation context from the backend-detected lifecycle state.
- Recommendation drafts change according to the inferred state.
- Known-cause and missing-evidence handling still come from backend rules, not UI state.
- Existing classifier evidence, approval controls, GPT Assist, and audit behavior continue to work.
