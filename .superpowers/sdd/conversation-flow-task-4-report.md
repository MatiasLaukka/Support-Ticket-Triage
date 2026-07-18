## Task 4 - Approval Desk UI Conversation Flow

- Replaced queue filters with conversation workflow states: Active, Draft ready, Waiting, Customer replied, Resolved, and All.
- Consumed Task 3 ticket detail fields in the UI: `conversationTimeline`, `recommendationHistory`, and `recommendationSummary.workflowState`.
- Added compact ticket-panel conversation timeline rendering for original tickets, sent support responses, and customer replies.
- Persisted demo customer replies through `POST /api/tickets/:ticketId/customer-replies` and refreshed selected ticket, queue, and evidence afterward.
- Added approved-response `Mark response as sent` action through `POST /api/recommendations/:recommendationId/mark-sent` with the same refresh flow.
- Updated recommendation creation gating and copy for customer replies, plus compact collapsed previous-recommendation history.

Verification:
- `npm run typecheck`
- `npx vitest run --dir test test/approval-desk-ui.test.ts`
