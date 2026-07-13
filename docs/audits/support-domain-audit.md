# Support Domain Audit

Date: 2026-07-13

This audit compares representative seed tickets and expected outcomes against
`data/knowledge/support-operations-playbook.md`. It focuses on four questions:

- Does routing match the playbook?
- Does required evidence match the situation?
- Does known-cause handling behave safely?
- Does the draft response ask for useful customer information?

## Summary

Routing labels mostly match the playbook. The biggest gap is evidence quality:
when a ticket cites multiple knowledge articles, the system currently unions all
article evidence requirements. That can make customer drafts too broad,
especially for security and SMS/profile cases.

Known-cause handling is good for the two implemented causes:

- SMS quiet-hour protection answers immediately when the dashboard explicitly
  says quiet-hour protection blocked delivery.
- Webhook secret rotation detects the likely cause but still asks for required
  confirmatory evidence.

The next implementation phase should improve evidence selection before building
the classifier.

## Ticket Findings

| Ticket | Routing | Evidence | Known cause / solution | Recommendation |
| --- | --- | --- | --- | --- |
| `TKT-1008` webhook signatures after secret rotation | Good: `integration`, `P2`, `integrations`. | Good: asks for endpoint URL, delivery ID, and raw body handling. Does not ask for secret value. | Good: detects `webhook-secret-rotation`, but waits for confirmatory evidence. | Keep. |
| `TKT-1017` SMS quiet hours | Mostly good: `api`, `P2`, `api-platform`, but playbook should explicitly state SMS compliance delivery blocks are API-platform owned in this fictional org. | Good: no extra evidence required because dashboard states quiet-hour protection. | Good: answers as expected compliance behavior and recommends eligible sending window. | Keep, but clarify ownership in playbook or labels. |
| `TKT-1027` Track API timestamp | Good route: `api`, `P3`, `api-platform`. | Weak: asks for ecommerce platform and profile email, but should ask for event timestamp, time zone, API response, request ID, and redacted payload. | Missing: playbook defines Track API local-time timestamp as a known cause, but code does not detect it yet. | Add known cause and API timestamp evidence requirements. |
| `TKT-1018` Shopify custom field mapping | Good route: `integration`, `P3`, `integrations`. | Mostly good: asks for store URL, object ID, and last sync time. Missing explicit expected field/source update time. | Missing: playbook defines Shopify custom field mapping as a known cause, but code does not detect it yet. | Add known cause and field mapping evidence. |
| `TKT-1030` SMS STOP not reflected | Good route: `account-access`, `P3`, `identity`. | Too broad: asks campaign, scheduled send time, catalog sync time, etc. Should ask for masked recipient/profile, STOP timestamp, channel, and consent timeline. | Missing: playbook defines SMS STOP sync delay as a known cause, but code does not detect it yet. | Add SMS opt-out evidence set and known cause. |
| `TKT-1028` webhook delivery latency | Good route: `integration`, `P2`, `integrations`. | Too signature-focused: asks signing secret and timestamp tolerance. Latency case should ask delivery ID, event creation time, delivery attempt time, endpoint status, and retry history. | Missing: playbook defines webhook delivery latency as a known cause, but code does not detect it yet. | Split webhook latency evidence from signature evidence. |
| `TKT-1001` event ingestion incident | Good route: `incident`, `P1`, `incident-response`, outage/SLA. | Too broad: asks object ID and catalog sync time from Shopify sync. Incident response should ask for affected store URLs, sample profiles, event timestamps, request IDs/API responses, and whether accepted events are missing from timelines. | Good: avoids claiming root cause; frames as possible platform delay. | Add incident-specific evidence set instead of unioning event tracking + Shopify sync. |
| `TKT-1004` API key exposure | Good route: `security`, `P1`, `security`. | Too broad and partly irrelevant: asks webhook delivery/signing evidence and catalog sync time. Security containment needs exposure scope, key identifier, where it was shared, whether used, affected logs, rotation status, and audit/source IP details. | Missing dedicated security knowledge article and evidence set. | Add security incident article/evidence; avoid unrelated webhook/profile evidence. |

## Cross-Cutting Gaps

### Evidence Union Is Too Blunt

The current evidence system maps each knowledge article to a fixed list and
unions those lists. This is simple, but it produces noisy drafts when a ticket
has multiple knowledge articles.

Better approach:

- add issue-pattern evidence sets for known causes and common incident types;
- use knowledge-article evidence only as a fallback;
- dedupe semantically similar asks such as store URL/site URL/endpoint URL;
- choose evidence by problem pattern, not only by attached knowledge article.

### Known Cause Catalog Is Too Small

The playbook now defines these known causes, but only two exist in code:

- implemented: SMS quiet-hour protection;
- implemented: webhook secret rotation mismatch;
- missing: Track API local-time timestamp;
- missing: Shopify custom field mapping;
- missing: SMS STOP sync delay;
- missing: webhook delivery latency.

### Security Needs Its Own Article

Security tickets currently borrow `profile-sync-issues` and
`webhook-signature-validation`, which makes evidence asks noisy. Add a dedicated
security article for API key exposure, unknown key creation, containment,
rotation, audit history, and redacted log preservation.

### Some Playbook Ownership Should Be Clarified

`TKT-1017` routes SMS quiet-hour behavior to `api-platform`. That can be valid
in this fictional org, but the playbook currently phrases SMS as compliance
support without naming ownership. Add a line that SMS send/compliance execution
issues are API-platform owned, while consent/profile state issues route to
identity.

## Suggested Next Implementation Order

1. Add a dedicated security knowledge article and security evidence set.
2. Add missing known causes from the playbook.
3. Split webhook signature evidence from webhook latency evidence.
4. Add incident-specific event-ingestion evidence.
5. Add SMS opt-out evidence separate from SMS campaign-send evidence.
6. Re-run this audit and only then build the classifier.
