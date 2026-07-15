# Conversation Workspace And Conversation-Aware Reclassification Design

## Goal

Make the Approval Desk demo prove the serious automation loop:

1. A ticket arrives with limited context.
2. Support sends an approved response.
3. The customer replies in their own words.
4. The system re-evaluates the full conversation.
5. Classification, evidence readiness, lifecycle state, and the next draft all update from the latest context.

The demo should stop relying on synthetic customer replies as the main story. Synthetic replies can remain as optional helpers, but the primary flow should let the demo user type realistic customer replies into a conversation workspace.

## Current State

The project already has most of the backend building blocks:

- deterministic classifier signals for category, priority, team, knowledge, risk, and escalation;
- evidence readiness with required, provided, and missing evidence;
- lifecycle states such as `needs-information`, `information-received`, `known-cause`, `waiting-on-platform-fix`, `diagnosing`, and `ready-for-close`;
- GPT-assisted drafting and assist metadata;
- optional GPT reasoning that can propose structured classification signals for ambiguous conversation context;
- conversation timeline events for original tickets, sent support responses, customer replies, and recommendation events;
- recommendation history and approval audit behavior.

The weakness is orchestration. The UI can append synthetic replies and the backend can read conversation history, but the demo still feels like a static ticket checklist. A vague ticket can remain anchored to its original vague category even after a reply clarifies the real product area. This makes follow-up drafts ask for weak generic evidence, such as a screenshot of a blank page, instead of moving into diagnosis.

## Product Principle

The original ticket is not frozen truth.

Every recommendation should be generated from the current conversation context:

- original subject and description;
- all customer replies;
- support responses already sent;
- requester and account facts;
- known causes;
- retrieved knowledge context;
- submitted metadata as weak evidence only.

New customer replies can change the likely category, team, priority, lifecycle state, required evidence, and next draft.

## Conversation Workspace

The center panel should become the primary working area for a selected ticket.

It should show:

- compact ticket summary;
- requester and account context;
- original ticket;
- support responses that were marked sent;
- customer replies;
- recommendation events;
- an `Add customer reply` composer below the timeline.

The composer should be a real workflow control, not a debug box:

- textarea label: `Add customer reply`;
- helper text: `Paste or type the customer's latest message. The next recommendation will use the full timeline.`;
- button: `Add customer reply`;
- after submit, refresh ticket detail, queue state, evidence panel, and the recommendation controls.

Existing synthetic reply buttons should move into a collapsed helper labelled `Insert sample reply`. Their copy should make clear they are shortcuts for demo setup, not the main customer simulator:

- `Insert vague sample`;
- `Insert partial evidence sample`;
- `Insert complete evidence sample`;
- `Insert known-cause sample`;
- `Insert resolved sample`.

## Recommendation Workspace

The right panel should explain what changed after the latest reply.

The top of the recommendation panel should continue to prioritize the customer-facing draft, but the surrounding context should become clearer:

- draft customer response;
- lifecycle state;
- category, priority, and team;
- evidence summary;
- draft context summary, including whether the response was deterministic or GPT-assisted;
- GPT reasoning signals when they influenced classification;
- classifier evidence behind a collapsed `Why this routing?` panel;
- previous recommendations collapsed below.

When the latest recommendation differs from the previous recommendation, show a compact change summary:

- category changed from `other` to `product`;
- team changed from `support` to `product`;
- lifecycle changed from `needs-information` to `diagnosing`;
- missing evidence changed from `Problem summary, Steps taken, Screenshot or error` to `Campaign name or ID, Approximate time, Browser/session details, Other users affected`.

This change summary is a demo feature. It makes the automation understandable without bloating the approval form.

## Conversation-Aware Reclassification

Recommendation creation should classify the ticket from a combined context object, not just the original ticket fields.

The combined context should include:

- normalized original ticket text;
- normalized customer replies, with recent customer replies weighted more heavily;
- requester role, department, technical level, and seniority;
- customer plan, region, and VIP status;
- current ticket tags and submitted metadata as weak signals;
- account facts extracted from the ticket and replies.

The classifier should be able to transition vague tickets into specific categories:

- vague initial ticket -> `other/support`;
- reply mentions Track API timestamp and 400 -> `api/api-platform`;
- reply mentions webhook signature after secret rotation -> `integration/integrations`;
- reply mentions private API key in logs -> `security/security`;
- reply mentions campaign editor blank page -> `performance/product` unless the scope indicates incident response;
- reply mentions SMS quiet hours -> known cause with SMS compliance guidance.

Submitted metadata remains weak evidence. Strong customer-reply content can override it.

## Vague Ticket Behavior

Vague tickets should not stay vague once the customer clarifies the issue.

Example: TKT-1010 starts as:

- subject: `Problem`;
- description: `It does not work`;
- classification: `other/support`;
- lifecycle: `needs-information`.

If the customer replies:

> I was trying to open the campaign editor, but the page stayed blank. The steps were: I opened the campaign, clicked Edit, and then the page stayed blank.

The next recommendation should shift to a specific diagnosis:

- likely issue: campaign editor blank page / app loading failure;
- category: `performance`;
- team: `product`;
- lifecycle: `diagnosing` or `information-received`;
- provided evidence: problem summary and reproduction steps;
- useful missing evidence: campaign name or ID, approximate time, browser/session details, whether other users are affected;
- optional evidence: screenshot or exact error message, if one appears;
- not a blocker: screenshot of a blank page.

The draft should thank the customer, explain that the details narrowed the problem to the campaign editor loading path, and say support is checking the relevant app path and possible service/browser/session causes.

## GPT Scope

GPT reasoning should be able to affect classification, but only through a structured advisory lane that remains auditable and bounded.

The main requirement is that classification and draft generation adapt to evolving vague situations. Deterministic rules should still own hard safety decisions, but GPT can help interpret messy customer replies when keyword rules are too brittle.

When GPT reasoning is enabled, it should receive the same full conversation context as the deterministic classifier:

- original ticket;
- full timeline;
- requester/account facts;
- known cause candidates;
- retrieved knowledge snippets, when available.

GPT reasoning should return structured advisory output, not free-form authority:

- likely issue type;
- candidate category, team, priority, and knowledge article IDs;
- confidence and uncertainty;
- evidence from the timeline that supports the suggestion;
- missing evidence that would change the classification;
- explanation written for audit/reviewer use.

The classifier resolver may convert GPT advisory output into low-to-medium-weight `classificationSignals`, marked clearly as GPT-suggested. Those signals can help break ties or reclassify vague tickets after new customer replies, but they must not override hard deterministic safety rules.

The deterministic layer still controls final:

- category, priority, team, and escalation fields;
- approval requirements;
- secret/safety validation;
- no unsupported fix claims;
- no irrelevant or duplicate evidence requests.

The product story should be explicit: GPT can reason over messy language and propose classification evidence, while deterministic resolver rules keep the final routing, lifecycle, and approval path auditable and safe.

## Evidence Recalculation

Evidence requirements must be recalculated after reclassification.

The original vague-ticket checklist should not remain active after a reply reveals a product area. For example:

- `Problem summary` and `Steps taken` become provided;
- `Screenshot or error` becomes optional unless the customer mentions a visible error;
- product-specific evidence replaces generic evidence;
- duplicate requirements are deduped across categories and knowledge articles.

Evidence should distinguish:

- required before next diagnosis;
- useful if available;
- optional context;
- already provided.

Only required missing evidence should drive customer asks in the draft.

## Backend Flow

Recommendation creation should follow this sequence:

1. Load ticket, recommendation history, and conversation timeline.
2. Build a combined conversation context.
3. Run deterministic classification on the combined context.
4. Optionally run GPT reasoning for ambiguous or vague-to-specific contexts.
5. Convert accepted GPT reasoning into bounded advisory classification signals.
6. Resolve final classification from deterministic and advisory signals.
7. Detect known causes on the combined context.
8. Extract account facts and evidence from the combined context.
9. Recalculate evidence readiness from the updated classification and known cause.
10. Infer lifecycle state.
11. Generate the next draft from the current lifecycle and evidence state.
12. Call GPT drafting when configured, passing the same context and validating the result.
13. Validate the draft against safety and lifecycle consistency rules.
14. Persist recommendation and audit events.

The API should not require the UI to send classification or lifecycle state. The UI sends only customer reply text and normal recommendation request metadata.

## UI Flow

Primary demo loop:

1. Select ticket.
2. Review original ticket and current timeline.
3. Create first recommendation.
4. Approve and mark support response as sent.
5. Type a customer reply in the Conversation Workspace.
6. Create updated recommendation.
7. Review what changed: classification, lifecycle, evidence, and draft.
8. Continue until known cause, waiting for fix, or ready for close.

If the user adds a customer reply while a previous approved draft has not been marked sent, allow it but make the state understandable:

- the customer reply appears after the latest actual sent support response or after the original ticket if no response was sent;
- any unsent recommendation is superseded by the new recommendation;
- recommendation history keeps the audit trail.

## Non-Goals

- Do not train or fine-tune a model.
- Do not make GPT the owner of approval fields.
- Do not let GPT bypass deterministic security, outage, SLA, or approval guardrails.
- Do not create a full production support inbox.
- Do not require a large new documentation corpus in this phase.
- Do not remove synthetic replies; demote them to helpers.
- Do not make the UI manually choose lifecycle state.

## Testing

Add or update tests for:

- manual customer reply composer posts to `/api/tickets/:id/customer-replies`;
- UI refreshes timeline, queue state, and recommendation controls after a manual reply;
- synthetic reply helpers still work but are visually secondary;
- vague ticket reclassifies after specific customer reply;
- TKT-1010 blank campaign editor reply stops treating screenshot as required;
- Track API reply can reclassify a vague ticket to API;
- security reply can reclassify a vague ticket to security;
- GPT reasoning can contribute bounded classification signals for ambiguous replies;
- deterministic safety rules override conflicting GPT reasoning;
- evidence readiness recalculates after reclassification;
- GPT-assisted drafts, when enabled, receive full timeline context;
- previous recommendations remain auditable after updated recommendations;
- draft validation blocks unsupported fix claims and unsafe asks.

## Acceptance Criteria

- A demo user can type their own customer reply and generate a new recommendation from the full timeline.
- A vague ticket can transition into another category after the reply provides enough context.
- The recommendation panel visibly explains what changed after the latest reply.
- GPT reasoning signals are visible when they affect classification.
- Drafts ask only for required missing evidence, not generic stale checklist items.
- GPT-assisted drafts, when enabled, use timeline context without overriding deterministic routing or approval safety.
- Existing approval, audit, queue, and recommendation history behavior continues to work.
