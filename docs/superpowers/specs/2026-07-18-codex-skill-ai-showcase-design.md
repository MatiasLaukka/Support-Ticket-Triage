# Codex Skill AI Showcase Design

## Goal

Turn the existing `triaging-support-tickets` Codex Skill into a repeatable,
portfolio-grade demonstration of governed AI automation. The Skill should use
optional GPT assistance for both bounded classification advice and
customer-response drafting, explain exactly how AI affected the result, guide
the operator to the next valid action after every workflow transition, and
complete a ticket through diagnosis, fix verification, and closure without
weakening deterministic policy or human approval.

## Portfolio Story

The showcase should demonstrate more than a model-generated reply. A reviewer
should be able to see one system coordinate:

- untrusted customer text;
- deterministic classification and safety policy;
- bounded GPT classification advice;
- GPT-polished customer drafting;
- knowledge-backed evidence requirements;
- human approval of named fields;
- multi-turn conversation state;
- diagnosis and fix gates;
- deterministic fallback;
- an auditable final result.

The demo must remain fully usable without an OpenAI API key. GPT adds value
when configured, but it is never a hidden runtime requirement.

## Current State and Gap

The Approval Desk HTTP path can request GPT classification reasoning and turn
that reasoning into capped advisory classification signals. The deterministic
classifier combines those signals with rule matches and retains hard safety
precedence. The Approval Desk and MCP `evaluate_ticket` paths can both use the
OpenAI-capable customer-response draft provider.

The MCP Skill path is not yet equivalent to the Approval Desk path:

- `evaluate_ticket` does not call the GPT classification-reasoning provider;
- model use is controlled indirectly by process environment rather than an
  explicit Skill-facing preference;
- recommendation output does not provide one coherent trace for classification
  advice, drafting, fallback, validation, latency, and optional token usage;
- the Skill does not require that trace to be explained before approval;
- next operator actions are described in Skill prose instead of being returned
  as structured backend-owned workflow guidance;
- existing Skill evaluation evidence does not show a repeatable live journey
  through GPT assistance, approval, diagnosis, fix, verification, and closure.

`record_diagnosis`, `mark_fix_available`, and `close_ticket` already exist as
MCP tools and are named in the Skill workflow. This phase should prove and
polish those capabilities rather than creating replacement tools.

## Core Principles

1. GPT may advise classification, but deterministic policy owns the final
   classification, lifecycle, escalation, approval, diagnosis, fix, and close
   decisions.
2. GPT may draft customer-facing language only from trusted structured context.
3. GPT failures never prevent the governed workflow from producing a safe
   deterministic recommendation.
4. AI use and fallback must be visible without revealing prompts, credentials,
   raw provider responses, internal paths, or unsanitized errors.
5. The backend, not the Skill prompt, owns which workflow action is valid next.
6. Every customer response and ticket mutation still requires explicit human
   approval of named fields.

## Shared AI Evaluation Boundary

Create one shared Approval Desk AI-evaluation orchestration module used by both
the HTTP Approval Desk and MCP `evaluate_ticket` paths. It should accept the
ticket, conversation context, deterministic classification, knowledge
articles, diagnosis and fix context, AI preference, response style, and
injectable classification and drafting providers.

The shared module should:

1. build the deterministic classification baseline;
2. optionally request schema-constrained GPT classification reasoning;
3. convert valid reasoning into capped advisory signals;
4. re-run the deterministic classifier with those advisory signals;
5. retrieve the final trusted knowledge set;
6. build the deterministic recommendation and response;
7. optionally request a GPT-polished response from final trusted context;
8. validate the provider draft and fall back when necessary;
9. return the recommendation plus a structured AI execution trace.

This removes the current orchestration difference between Approval Desk HTTP
and Codex Skill evaluation. Provider creation and environment handling should
remain at process boundaries, while the shared module accepts injected
providers so tests never require live network access.

## Skill-Facing AI Preference

Extend `evaluate_ticket` with `aiPreference`:

- `auto`: preserve environment-configured provider behavior;
- `gpt-preferred`: attempt both GPT advisory classification and GPT drafting
  when the required provider and credentials are available, with independent
  deterministic fallback for either stage;
- `deterministic`: skip external model calls for both stages.

The default remains `auto` for backward compatibility. The
`triaging-support-tickets` Skill should explicitly use `gpt-preferred` for the
portfolio showcase. `responseStyle` remains a separate input because model use
and response tone are independent decisions.

## AI Execution Trace

Persist one structured `aiExecutionTrace` with the recommendation. It should
contain the requested preference and two independent stage traces.

### Classification trace

- status: `skipped`, `used`, or `fallback`;
- model identifier when a model was called;
- sanitized fallback category and explanation when applicable;
- GPT candidate category, team, priority, knowledge IDs, confidence, and
  customer-safe explanation;
- advisory signals accepted into deterministic scoring;
- advisory signals rejected by schema, allowlist, or safety policy;
- deterministic overrides that changed or constrained GPT advice;
- final category, team, priority, knowledge IDs, confidence, and escalation
  state;
- optional provider latency and token usage when returned by the API.

### Drafting trace

- status: `skipped`, `used`, or `fallback`;
- actual source: `deterministic`, `openai`, or `fallback`;
- model identifier when a model was called;
- requested style, recommended style, and selected style;
- sanitized fallback category and explanation when applicable;
- validation checks and their `pass`, `warn`, or `fail` status;
- optional provider latency and token usage when returned by the API.

Allowed fallback categories are `not-configured`, `timeout`,
`provider-error`, `invalid-schema`, and `guardrail-rejected`. Provider details
must be mapped to these categories before persistence or client output.

Do not store raw prompts, API keys, authorization headers, raw provider
payloads, filesystem paths, stack traces, or provider error bodies.

## Classification Governance

GPT classification output remains advisory:

- response data must pass a strict schema;
- category, team, and priority candidates must use domain enum values;
- knowledge IDs must exist in the local knowledge catalog;
- confidence must be between `0` and `1`;
- advisory weights remain capped at the existing maximum;
- GPT cannot remove deterministic security, outage, SLA, policy-conflict, or
  missing-information escalation signals;
- GPT cannot directly set lifecycle state, known cause, diagnosis, fix, ticket
  status, approval, or closure;
- final classification always comes from the deterministic classifier after it
  combines allowed advisory signals with deterministic evidence.

The trace must make the distinction visible: GPT suggested evidence; the
deterministic engine decided the stored outcome.

## Drafting Guardrails

Provider drafts must continue passing the existing response validators and add
two response-quality checks.

### Style-specific maximum length

Count customer-facing words including the sign-off. Enforce these maximums:

| Style | Maximum words |
| --- | ---: |
| `concise` | 140 |
| `balanced` | 240 |
| `empathetic` | 280 |
| `technical` | 340 |
| `executive-update` | 200 |

For `auto`, use the selected style's limit. A provider draft over the limit is
rejected with `guardrail-rejected` and uses deterministic fallback. Existing
deterministic templates must be regression-tested against the same limits.

### Irrelevant information requests

Build the allowed request set from:

- current `missingEvidence`;
- evidence still needed by the active diagnostic playbook;
- a customer verification action from trusted fix context.

A clearly identifiable request outside that set fails the provider draft and
uses deterministic fallback. An ambiguous possible extra request creates a
warning that remains visible for human review. This check must not flag a
greeting, acknowledgement, impact summary, explanation, next-support-action,
or sign-off as an evidence request.

Existing blocking checks remain in force for secrets, sensitive credentials,
internal IDs, model or approval language, premature diagnosis/fix/closure
claims, status-follow-up repetition, and duplicate evidence requests.

## Backend-Owned Next-Step Guidance

Extend the workflow read model and `evaluate_ticket` output with structured
`operatorGuidance`:

- current workflow stage;
- concise summary of what changed in the latest transition;
- next permitted action;
- reason that action is next;
- whether explicit human approval is required;
- exact recommendation fields awaiting approval;
- tool that becomes valid after approval;
- conditions still blocking diagnosis, fix, verification, or closure;
- customer next step, when the customer owns the next action.

Guidance is derived from persisted recommendation and audit state. It must not
trust a model-generated next action. Invalid actions continue to be rejected by
the service even if a client ignores the guidance.

After every update, the Skill must present two separate statements:

- **Customer next step:** the current customer request or verification action;
- **Your next step:** the exact operator decision, approval, or wait state.

When approval is required, the Skill must name the fields and explain which
tool can be called only after approval. It must not imply that it will continue
automatically through a human gate.

## Resettable TKT-1010 Showcase Journey

Use the existing campaign-editor ticket because it supports ambiguity,
reclassification, evidence gathering, diagnostic narrowing, confirmed
diagnosis, engineering fix, verification, and closure.

The repeatable journey is:

1. Reset an isolated synthetic fixture and read TKT-1010 workflow state.
2. Evaluate with `aiPreference: "gpt-preferred"` and `responseStyle: "auto"`.
3. Present final classification, both AI traces, proposed fields, customer
   draft, and next-step guidance.
4. Wait for explicit approval of named fields and the customer response.
5. Mark the approved response done and append the deterministic synthetic
   customer reply returned by the workflow.
6. Re-read and re-evaluate the full timeline so new customer evidence can
   change classification, evidence readiness, and lifecycle state.
7. Continue approval and evidence turns until diagnosis requirements are met.
8. Call `record_diagnosis`, present the diagnosis update and next steps, and
   wait for approval before sending its response.
9. Call `mark_fix_available` only after the backend records a confirmed
   engineering-owned diagnosis.
10. Re-evaluate, present the fix-verification response and guidance, and wait
    for explicit approval before sending it.
11. Process the synthetic resolved confirmation, evaluate `ready-for-close`,
    approve and send the closing response, then call `close_ticket`.
12. Read the final workflow and audit trail and summarize model involvement,
    deterministic decisions, approvals, revisions, diagnosis, fix, customer
    confirmation, and closure.

No showcase step may bypass service guards merely to keep the demo moving.

## Codex Skill Changes

Update the Skill instructions and default prompt so the Codex interface:

- requests `gpt-preferred` for the showcase while explaining deterministic
  fallback;
- reports classification and drafting traces separately;
- distinguishes GPT advice from deterministic outcomes;
- reports fallback and guardrail warnings before approval;
- ends every stage with Customer next step and Your next step;
- reads the workflow after each response or lifecycle action;
- uses `record_diagnosis`, `mark_fix_available`, and `close_ticket` only when
  backend guidance and service preconditions permit them;
- preserves all current approval, rejection, stale-revision, escalation, and
  untrusted-ticket-text hard stops.

The Skill should remain concise enough to guide an agent reliably. Detailed
field definitions and trace interpretation belong in a focused reference file
linked from `SKILL.md`, not repeated throughout the main workflow.

## Verification Strategy

### Unit and contract tests

Add tests for:

- `aiPreference` parsing, defaults, and strict invalid-value rejection;
- classification trace creation for skipped, used, and fallback paths;
- drafting trace creation for skipped, used, and fallback paths;
- knowledge-ID allowlisting and advisory weight caps;
- deterministic security and escalation overrides;
- sanitized fallback categories without provider details;
- style-specific maximum lengths;
- relevant, irrelevant, and ambiguous information-request detection;
- operator guidance at approval, waiting-for-customer, diagnosis-ready,
  diagnosis-recorded, fix-ready, waiting-for-verification, ready-for-close,
  and closed stages.

### MCP integration tests

Use injected providers to prove:

- valid GPT classification advice and drafting are both used by
  `evaluate_ticket`;
- either GPT stage can fall back independently;
- no-key deterministic evaluation completes successfully;
- AI trace and operator guidance survive recommendation persistence and
  workflow reads;
- Diagnose, Fix, verification, and closure tools enforce their existing
  service gates.

Tests must use controlled provider doubles and must not call the live OpenAI
API.

### End-to-end showcase

Add `npm run demo:skill-showcase` to run the isolated TKT-1010 journey through
the same MCP contracts exposed to Codex. Its default mode uses controlled GPT
provider doubles for repeatability. An explicitly enabled live mode may use the
existing OpenAI environment configuration.

The showcase produces a sanitized report containing:

- ordered MCP tool calls;
- classification and drafting traces;
- guardrail results and fallback categories;
- operator approvals;
- workflow state transitions;
- diagnosis and fix audit events;
- final ticket and audit state.

The report must never contain credentials, raw prompts, raw provider responses,
or machine-specific paths.

### Skill evidence

Update structural Skill tests for the AI preference, dual traces, next-step
language, and lifecycle tools. Add a concise live-demo script with expected
checkpoints and a saved sanitized example transcript. Run the official Skill
validator when it is available in the environment; if it remains unavailable,
state that limitation precisely in the evaluation document.

## Documentation

Update the README and Skill evaluation material to show:

- the two bounded GPT roles;
- the deterministic decision boundary;
- the optional/fallback behavior;
- the operator approval boundary;
- the resettable showcase command;
- how to configure live GPT mode without storing a key;
- how to interpret AI traces and next-step guidance;
- an example of GPT advice being overridden by deterministic safety policy.

## Non-Goals

- No autonomous outbound customer messaging.
- No GPT-controlled approval, diagnosis, fix, or closure.
- No arbitrary agent-generated recommendation JSON in the showcase path.
- No real customer data or live support connector.
- No raw chain-of-thought, prompt, credential, or provider payload storage.
- No cost estimator tied to mutable external model pricing.
- No new Diagnose, Fix, or Close tools; existing tools are retained and
  proven.
- No requirement for a live OpenAI key in tests or the default showcase.

## Acceptance Criteria

- MCP `evaluate_ticket` supports `auto`, `gpt-preferred`, and `deterministic`.
- Codex Skill evaluation can use both bounded GPT classification advice and GPT
  customer-response drafting.
- The Approval Desk HTTP and MCP Skill paths share the same AI orchestration.
- Recommendations persist separate classification and drafting traces.
- The trace shows model use, deterministic overrides, fallback, guardrails,
  latency, and token usage when available.
- Missing credentials or either provider failure produces a safe deterministic
  recommendation with visible sanitized fallback.
- Drafts enforce style-specific length limits and reject clearly irrelevant
  information requests.
- Backend-owned next-step guidance is present after every workflow transition.
- The Skill always reports Customer next step and Your next step.
- The resettable TKT-1010 showcase reaches diagnosis, fix, verification,
  ready-for-close, and closed states through existing service gates.
- Automated tests make no live OpenAI requests.
- The saved showcase report contains no secrets, raw prompts, provider payloads,
  or machine-specific paths.
- Existing approval, rejection, stale-revision, escalation, audit, and
  deterministic-only workflows remain passing.

