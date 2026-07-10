# Marketing Automation Domain Upgrade Design

## Goal

Upgrade the demo from a generic support desk into a realistic marketing
automation support workflow with richer synthetic knowledge, tickets, expected
outcomes, and customer-facing draft responses. The result should feel like an
AI automation engineer project for a real B2B SaaS product without copying
Klaviyo or any other vendor documentation.

## Product Frame

Use a fictional product named **Northstar Marketing Cloud**. It is a
Klaviyo-like marketing automation platform for ecommerce teams, but all
fixtures, docs, names, and examples must be original synthetic content.

The product supports:

- ecommerce integrations and catalog sync;
- customer profiles and consent state;
- event tracking and activity timelines;
- flows and trigger filters;
- campaigns and send failures;
- segmentation rules;
- email deliverability and suppression;
- SMS compliance;
- webhook signing and delivery;
- coupon and product-feed sync.

The repository must stay local-only. It must not claim to be affiliated with
Klaviyo, must not copy Klaviyo docs, and must not include live customer data,
API keys, external service calls, or hosted-service claims.

## Current Problem

The current knowledge base is small and generic. Recommendations can cite
internal knowledge IDs correctly, but the customer-facing drafts have too
little useful domain detail. Even after replacing raw IDs with readable text,
some drafts still feel like placeholders because the synthetic domain lacks
enough concrete product concepts.

The upgraded demo should let the automation produce responses such as:

> We are investigating why the abandoned-cart flow did not trigger. Please
> confirm the profile email, cart event timestamp, whether the event appears in
> the activity timeline, and whether the profile is excluded by consent or flow
> filters. We will compare the event payload, profile consent state, and trigger
> rules before recommending the next update.

That is the bar: customer-readable, actionable, and grounded in the local
knowledge articles.

## Clean-Room Knowledge Base

Replace the current 10 generic knowledge articles with 10 synthetic marketing
automation articles:

| ID | Title | Purpose |
| --- | --- | --- |
| `event-tracking-debugging` | Event Tracking Debugging | Event payload, timestamp, profile identifier, metric name, and activity timeline checks. |
| `profile-sync-issues` | Profile Sync Issues | Email/customer ID matching, consent state, duplicate profiles, and recent import/API sync. |
| `shopify-integration-sync` | Shopify Integration Sync | Store connection, product/customer/order sync, scopes, and delayed ecommerce events. |
| `flow-trigger-troubleshooting` | Flow Trigger Troubleshooting | Trigger event, flow filters, profile qualification, smart sending, and consent exclusions. |
| `email-deliverability` | Email Deliverability | Suppression, bounce/spam signals, DNS alignment, list quality, and sending reputation. |
| `sms-compliance` | SMS Compliance | Consent source, opt-in timestamp, quiet hours, region restrictions, and opt-out handling. |
| `webhook-signature-validation` | Webhook Signature Validation | Signing secret rotation, raw body handling, delivery ID, timestamp tolerance, and retries. |
| `campaign-send-failures` | Campaign Send Failures | Audience snapshot, scheduled time, suppression counts, template validation, and send status. |
| `segmentation-audience-rules` | Segmentation And Audience Rules | Segment definition, profile attributes, event recency, boolean logic, and recalculation delay. |
| `coupon-catalog-sync` | Coupon And Catalog Sync | Catalog feed timestamps, SKU/product identifiers, coupon pool availability, and ecommerce sync state. |

Each article should be 250-500 words, not a one-paragraph stub. Each should
include:

- frontmatter with `id`, `title`, and `tags`;
- a short overview;
- diagnostic inputs to collect from the customer;
- safe next actions the support team can take;
- guardrail language about not over-promising fixes before evidence;
- customer-facing phrasing hints that can be used by response generation.

## Tickets And Outcomes

Regenerate the 30 synthetic tickets around the new domain while preserving the
existing repository schemas and safety scenarios.

Required scenarios:

- abandoned-cart flow does not trigger;
- Shopify product catalog sync delay;
- webhook signature failures after secret rotation;
- email campaign stuck before send;
- SMS message blocked by consent or quiet hours;
- segment count differs from expected audience;
- profile merge or duplicate profile issue;
- order event missing from activity timeline;
- coupon code not attached to campaign;
- deliverability drop or elevated bounce rate;
- prompt-injection ticket that asks the automation to bypass approval;
- security credential exposure scenario;
- multi-ticket incident or outage cluster;
- SLA-breached ticket;
- VIP/customer-pressure ticket that must not bypass policy;
- ambiguous ticket lacking reproduction details.

Keep 30 tickets with IDs `TKT-1001` through `TKT-1030`. Preserve coverage of
all existing domain enum values unless a separate schema migration is planned.
If current enums such as `api`, `integration`, `performance`, and `billing` are
still used, map the marketing automation scenarios into those categories rather
than changing the schema.

Expected outcomes must cite the new knowledge IDs and preserve deterministic
evaluation behavior:

- `npm run evaluate` should still report 30 tickets;
- knowledge citation coverage should remain 1;
- approval safety violations should remain 0;
- duplicate precision/recall should remain 1 for the designed duplicate groups.

## Customer-Facing Draft Responses

The recommendation builder should generate draft customer responses from
customer-facing templates keyed by knowledge article ID. These templates should
ask for useful details and describe concrete investigation steps.

Requirements:

- Never expose raw knowledge IDs in `draftCustomerResponse`.
- Keep raw `knowledgeArticleIds` in recommendations, rationale, audits, and
  evidence where internal traceability is useful.
- Compose multiple article templates without obvious repetition.
- Include ticket-specific context when available, such as affected flow,
  metric, endpoint, campaign, segment, profile, SKU, or region.
- Avoid unsupported claims such as "fixed", "confirmed root cause", or
  "incident resolved" unless the local workflow has evidence for that state.
- Keep customer drafts editable and approval-gated in the Approval Desk.

Example for `flow-trigger-troubleshooting`:

> We are investigating why the flow did not trigger. Please confirm the profile
> email, trigger event name, event timestamp, and whether the profile appears in
> the flow analytics. We will compare the event payload, flow filters, consent
> state, and smart sending settings before recommending the next update.

Example for `webhook-signature-validation`:

> We are investigating the webhook signature failure. Please share the delivery
> ID, failure timestamp, affected endpoint URL, recent signing secret rotation
> time, and whether raw body handling changed. We will compare the signed
> payload, timestamp tolerance, and retry history before recommending the next
> update.

## Demo Narrative

Update the README and demo script to describe the fictional product and the
stronger knowledge base. The one-command demo should still work:

```powershell
npm run demo:approval-desk
```

The recommended walkthrough should use a marketing automation ticket that
shows:

1. local knowledge search;
2. useful customer-facing draft response;
3. human approval gate;
4. evidence dashboard metrics;
5. audit trail after approval or rejection.

The docs should explicitly say the product and data are synthetic and inspired
by common marketing automation support patterns, not copied from a real vendor.

## Implementation Boundaries

Do not add external scraping, live documentation ingestion, API calls, or a
real Klaviyo dependency. If a future version wants real vendor docs, it should
use links and summaries with attribution rather than copying full text, and
only after checking the applicable license/terms.

Do not change MCP tool names, Approval Desk routes, runtime persistence, or the
human approval safety model as part of this upgrade. This is a data/domain and
response-quality upgrade, not a new workflow engine.

## Testing Strategy

Add or update tests to prove:

- generated fixture knowledge files are exactly the new clean-room article set;
- every expected outcome references an existing new knowledge ID;
- ticket fixtures include the required marketing automation scenarios;
- recommendation drafts include actionable customer instructions;
- recommendation drafts do not expose raw knowledge IDs;
- `npm run evaluate` preserves expected quality metrics;
- the Approval Desk still creates, displays, approves, rejects, and audits
  recommendations after the data upgrade;
- docs do not contain copied-vendor claims, hiring-pitch framing, or
  hosted-service claims.

## Success Criteria

The upgrade is done when:

- the generic knowledge base has been replaced by richer synthetic marketing
  automation knowledge;
- fixtures and expected outcomes are regenerated deterministically;
- generated customer responses are specific enough to be useful to a customer;
- internal IDs remain available for auditability without leaking into customer
  drafts;
- the one-command demo still runs locally;
- focused tests, build, evaluation, and whitespace checks pass;
- the branch is pushed for review.
