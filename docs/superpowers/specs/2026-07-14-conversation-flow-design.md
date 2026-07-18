# Approval Desk Conversation Flow Design

## Goal

Evolve the Approval Desk from a one-shot recommendation demo into a multi-turn support conversation demo. The system should preserve the original ticket, sent support responses, customer replies, and recommendation versions so a presenter can show how automation handles a real customer interaction over several turns.

## Core Model

The ticket, not the recommendation, becomes the main workflow object. Recommendations are versioned artifacts inside the ticket conversation.

The visible workflow states should be conversation-centered:

- `Active`: the ticket needs support action.
- `Draft ready`: a recommendation exists and waits for review.
- `Waiting for customer`: an approved response has been sent and the next action belongs to the customer.
- `Customer replied`: the customer has replied after a sent support response and the ticket needs an updated recommendation.
- `Resolved`: the latest customer message or support action indicates the issue is complete.
- `All`: unfiltered queue view.

The old labels `pending` and `approved` are still valid internal recommendation resolution values, but they should not be the primary queue language.

## Conversation Events

Add audit-backed conversation events rather than storing replies only in browser memory.

Required new audit actions:

- `customer-response-sent`: a support response was sent to the customer.
- `customer-reply-received`: a customer reply was received and attached to the ticket context.
- `recommendation-superseded`: a pending recommendation was replaced by a newer recommendation after new context arrived.

Approval should no longer mean "the ticket is locked." Approval means a reviewer accepted the selected fields and customer response. After approval, the demo should be able to record the response as sent.

For showcase purposes, add a button to move an approved recommendation to sent:

- Label: `Mark response as sent`
- Location: recommendation/action area when the current recommendation is approved but not sent.
- Behavior: creates `customer-response-sent` with `sentAt = approvedAt + 5 minutes`.
- The button should make the transition visible immediately in the conversation timeline.

This phase should not add a background scheduler. The button simulates the "sent after 5 minutes" event for demos while keeping the timestamp realistic.

## Recommendation Versioning

Creating an updated recommendation must not erase previous recommendations.

Rules:

- If no pending recommendation exists, create a new recommendation from the full ticket conversation context.
- If a pending recommendation exists and new customer context has arrived, mark the old pending recommendation as superseded, preserve it in history, and create a new recommendation.
- If a response has already been sent, keep that sent response in conversation history and allow a new recommendation after a customer reply.
- If a response is approved but not sent, the UI should guide the reviewer to either mark it sent or explicitly supersede it before creating a new draft.
- Approved and sent recommendations should not need to be canceled before the next customer turn.

Recommendation history should be visible but secondary. The right panel shows the current recommendation by default. Older recommendations live behind a compact `Previous recommendations` disclosure or timeline item.

## Customer Replies

Customer replies should become local conversation events instead of browser-only state.

The demo can continue to use synthetic reply buttons, but clicking one should create a `customer-reply-received` event for the selected ticket. The event stores:

- `id`
- `ticketId`
- `createdAt`
- `actor` or customer display name
- `body`
- optional `source`, such as `demo-scenario`

When a customer reply is received after a sent support response, the ticket moves to `Customer replied` and can receive a new recommendation.

The recommendation builder should receive the full relevant conversation context:

- original ticket subject and description
- customer replies
- sent support responses
- prior recommendation summaries where useful

The lifecycle inference remains backend-owned. Scenario buttons may add customer text, but must not set lifecycle state directly.

## UI Shape

The center panel becomes the source of truth for the ticket conversation.

It should show:

- original ticket details, with requester and key context still compact
- conversation timeline under the original ticket
- latest customer reply preview
- full original/reply/support-response content behind compact disclosures when needed

Timeline item types:

- `Original ticket`
- `Support response sent`
- `Customer reply`
- `Recommendation superseded`
- `Recommendation approved`

The right panel remains focused:

- current recommendation
- current draft response
- lifecycle summary
- approval actions
- sent/supersede actions when relevant

Avoid turning the right panel into a full audit log. The audit/history story belongs mostly in the center panel.

## Queue Filters

Replace recommendation-centric filters with conversation-centric filters:

- `Active`
- `Draft ready`
- `Waiting`
- `Customer replied`
- `Resolved`
- `All`

Default filter: `Active`, containing tickets that need support action now, including tickets with a new customer reply.

Color coding should reflect support action:

- needs action: strong/high-visibility accent
- draft ready: review accent
- waiting for customer: muted/neutral
- resolved: success
- security/high-risk tickets should still keep a visible risk marker independent of workflow state

## API Shape

Add endpoints or equivalent route behavior for:

- adding a customer reply to a ticket
- marking an approved recommendation response as sent
- superseding a pending recommendation when a newer recommendation is created
- returning ticket detail with conversation timeline and recommendation history

The implementation should use existing audit and recommendation repositories as the conversation source for this phase. A full separate conversation repository is out of scope.

## Safety And Audit Boundaries

The existing human approval boundary remains intact:

- No customer-facing response is considered sent until approval occurs and the sent event is logged.
- Customer text remains untrusted evidence.
- Customer replies can influence lifecycle inference, missing evidence, known-cause handling, and draft content, but they cannot directly approve fields or bypass review.
- Superseded recommendations remain auditable.
- Sent support responses remain visible in history.

The GPT drafting validator must continue checking the final lifecycle state and retrieved context before accepting provider drafts.

## Testing

Add focused tests for:

- approved recommendation can be marked sent and appears in conversation history
- customer reply after sent response moves ticket to customer-replied/active
- updated recommendation uses original ticket plus all customer replies
- pending recommendation is superseded, not erased, when new context creates a new recommendation
- approved/sent recommendation does not block a new recommendation after customer reply
- queue filters reflect conversation state
- UI keeps original ticket and replies accessible without bloating the right panel

## Out Of Scope

- Real email sending
- Real inbound inbox integration
- Scheduled background jobs
- Full CRM-style thread management
- Multi-agent assignment workflows
- External persistence beyond the existing local demo storage

## Open Implementation Notes

Prefer the smallest model that preserves the demo story:

- Use audit events as the conversation source if practical.
- Add only the repository methods needed for conversation state.
- Keep UI changes compact and demo-oriented.
- Do not remove internal recommendation resolution values; translate them into friendlier conversation states for display.
