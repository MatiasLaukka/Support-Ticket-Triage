# Deterministic Weighted Ticket Classifier Design

## Goal

Replace the Approval Desk's runtime dependency on `expected-outcomes.json` with a deterministic, explainable classifier. The classifier should recommend category, priority, team, knowledge articles, escalation reasons, and confidence from ticket content and account context. `expected-outcomes.json` should remain available for fixture generation and evaluation, but it should not be the source of truth for live recommendations.

The design keeps high-risk automation deterministic and auditable. GPT may continue drafting customer-facing language and assist content, but GPT must not own category, priority, routing, escalation, or approval safety decisions.

## Current State

`buildApprovalDeskRecommendationInput` currently requires an `ExpectedOutcome`. That outcome supplies the recommendation's category, priority, team, knowledge articles, and required escalations. Newer modules improve evidence readiness, known-cause detection, lifecycle state, and customer drafts, but they still depend on the expected outcome being selected first.

This makes the demo reliable, but it weakens the automation story: the system is not yet classifying a new ticket from first principles.

## Classifier Output

Create a classifier module that returns a structured result:

```ts
interface TicketClassification {
  category: Category;
  priority: Priority;
  team: Team;
  knowledgeArticleIds: string[];
  requiredEscalations: RequiredEscalation[];
  confidence: number;
  signals: ClassificationSignal[];
}

interface ClassificationSignal {
  ruleId: string;
  target: string;
  weight: number;
  reason: string;
}
```

The `signals` array is part of the product, not debug noise. It allows tests, audit output, and the dashboard to explain why the classifier reached a decision.

## Rule Layers

The classifier should evaluate normalized ticket text and metadata through explicit rule groups. Rules emit weighted signals. A resolver then converts the signal scores into the final triage fields.

### 1. Submitted Metadata Signals

Submitted metadata should be used as weak-to-medium evidence, not as truth. The classifier should read the ticket's current or customer-selected category, priority, team, status, and tags, then emit low-weight signals from them.

Examples:

- customer-selected `api` category emits a small API signal;
- customer-selected `P1` emits an urgency signal, but cannot force `P1` without impact or risk evidence;
- existing tags such as `shopify`, `webhook`, `security`, or `sms` emit topic signals;
- current team can increase confidence when it agrees with ticket text, but it should not override stronger content signals.

This layer should also produce disagreement signals when submitted metadata conflicts with stronger classifier evidence. For example, if the customer selected `api` but the body clearly describes a Shopify catalog sync issue, the classifier should route to integrations and record why it overrode the submitted category.

### 2. Safety And Escalation Rules

Safety rules run first and can override normal routing:

- security exposure: API keys, secrets, tokens, credential leakage, signing-secret exposure;
- prompt-injection or claimed approval attempts;
- likely outage or platform delay: regional impact, multiple stores/accounts, delayed event ingestion, timeline gaps;
- SLA breach or severe production impact;
- policy conflict: pressure to bypass normal handling.

These rules emit escalation signals and may force `security` or `incident-response` routing.

### 3. Product Area Rules

Product rules identify the main support topic:

- API: Track API, payloads, validation responses, request IDs, timestamps;
- Webhooks: delivery IDs, endpoint responses, signatures, HMAC, retries, secret rotation;
- Integrations: Shopify/Magento/WooCommerce sync, catalog fields, product/object sync;
- Campaigns: SMS/email sends, quiet hours, bounces, deliverability;
- Flows and automation: triggers, profile qualification, viewed product, abandoned cart;
- Billing, account access, authentication, performance, and feature requests.

These rules emit category, team, and knowledge article candidates.

### 4. Known Cause Rules

Known-cause rules run after product-area signals, because they are topic-specific. They should reuse the existing known-cause catalog where possible.

Examples:

- SMS quiet hours;
- webhook secret rotation mismatch;
- Track API local-time timestamp;
- Shopify custom field mapping;
- SMS STOP sync delay;
- webhook delivery latency.

Known-cause signals can refine evidence requirements, support state, investigation steps, and draft strategy.

### 5. Priority Rules

Priority should combine impact, risk, and urgency instead of relying only on urgent wording:

- `P1`: security exposure, confirmed outage, or severe cross-account/platform impact;
- `P2`: production workflow blocked, likely outage, SLA risk, or important integration failure;
- `P3`: isolated issue, likely workaround, account/configuration issue;
- `P4`: feature request, cosmetic issue, low business impact.

Priority rules should be deterministic and explainable through signals.

### 6. Evidence Readiness Rules

Evidence readiness remains separate from classification, but it should consume the classifier result instead of an expected outcome. It must deduplicate overlapping requirements, so shared evidence such as store URL, profile/customer ID, event ID, request ID, and payload examples are not asked for twice.

## Resolver Behavior

The resolver should:

1. Sum signals by target.
2. Treat submitted metadata as supporting evidence, not a hard decision.
3. Apply hard precedence for security and outage escalation.
4. Select the strongest product area when no override applies.
5. Attach knowledge articles from the winning product area and known cause.
6. Derive confidence from score strength, agreement with submitted metadata, and margin over the runner-up.
7. Return all winning, disagreement, and relevant secondary signals for auditability.

Confidence should decrease when two product areas are close, when only weak terms matched, or when required context is missing.

## Integration

Add a new classifier path without deleting expected-outcome evaluation:

- `src/approval-desk/classifier.ts`: deterministic rules, scoring, resolver, signal types;
- `recommendation-builder.ts`: accepts either an explicit outcome for tests/fixtures or a classifier result for live recommendations;
- `evaluation.ts` or evaluator script: compares classifier output against `expected-outcomes.json`;
- tests: classifier unit tests for rule behavior and integration tests proving runtime recommendations can be built without expected outcomes.

The Approval Desk API should eventually use the classifier by default. Tests and fixture generation may still inject expected outcomes where exact gold-label reproducibility is useful.

## Testing Strategy

Start with red tests that prove the current system cannot classify without expected outcomes. Then add:

- one unit test per major rule group;
- submitted metadata tests proving customer/current category, priority, team, and tags influence but do not dominate classification;
- disagreement tests proving strong ticket text can override submitted category or priority while recording an audit signal;
- known-cause classifier tests for the existing catalog;
- safety precedence tests, especially security over integration and outage over normal API routing;
- confidence tests for clear and ambiguous tickets;
- evaluation coverage comparing all 30 synthetic tickets against expected outcomes.

The first implementation should aim to match most current expected outcomes, but it may intentionally disagree where the deterministic rule is more realistic. Any intentional disagreement must be documented in the audit notes.

## Non-Goals

- Do not train or fine-tune a model.
- Do not let GPT decide routing, priority, escalation, or approval fields.
- Do not replace evidence readiness, known-cause definitions, or customer drafting in this phase.
- Do not add a large UI redesign. If signals are exposed in the dashboard, keep it compact and secondary.
