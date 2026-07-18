# Case Study: Governed AI Support Triage

## Summary

This project demonstrates a local AI automation workflow for B2B SaaS support
triage. It combines a Model Context Protocol server, deterministic policy
checks, conversation-aware classification, retrieved local knowledge, optional
GPT customer-response drafting, bounded GPT advisory classification signals,
human approval, and append-style audit events.

The fictional domain is **Northstar Marketing Cloud**, an ecommerce marketing
automation platform with synthetic support tickets for events, flows,
deliverability, SMS compliance, webhooks, segments, profiles, coupons, and
catalog sync.

## Problem

Support teams often need to classify tickets, route work, ask customers for the
right evidence, and keep audit trails without allowing untrusted customer text
to drive automation directly.

The risky version of this workflow would let a model read a ticket and mutate a
support system immediately. This project shows a safer architecture:

- ticket text is treated as untrusted evidence;
- deterministic policy owns safety-critical routing and escalation;
- GPT can draft customer-facing wording from trusted context;
- GPT can optionally propose auditable advisory classification signals for
  ambiguous follow-up replies, while deterministic safety rules remain final;
- validators check the draft before review;
- a human explicitly approves named fields;
- every state transition is recorded locally.

## Architecture

```mermaid
flowchart LR
    Ticket["Synthetic ticket"]
    KB["Local knowledge base"]
    MCP["MCP tools and resources"]
    Context["Conversation context"]
    Rules["Deterministic classifier and policy"]
    GPTSignals["Optional GPT advisory signals"]
    GPT["Optional GPT draft provider"]
    Checks["Draft validators"]
    Desk["Approval Desk"]
    Audit["Audit log"]

    Ticket --> MCP
    KB --> MCP
    MCP --> Context
    Context --> Rules
    Context --> GPTSignals
    GPTSignals --> Rules
    Rules --> Desk
    MCP --> GPT
    GPT --> Checks
    Checks --> Desk
    Desk -->|approve named fields| Audit
    Desk -->|reject with feedback| Audit
```

The key design choice is separation of responsibilities. The model may help
interpret messy customer language and write the response, but it does not own
authorization, hard safety escalation, mutation, or audit.

## Demo Scenario

The fastest browser demo uses `TKT-1010`, a deliberately vague ticket that
becomes classifiable after a customer reply. `TKT-1001` remains a strong
alternate incident demo for EU Checkout Started event delays.

1. The user runs `npm run demo:showcase`.
2. The Approval Desk resets local runtime state and opens a local URL.
3. The reviewer selects `TKT-1010`, adds a customer reply describing the blank
   campaign editor, and creates an updated recommendation.
4. The system re-evaluates the full conversation, recalculates evidence
   requirements, retrieves local knowledge articles, and creates a pending
   recommendation.
5. The Recommendation panel shows:
   - draft customer response;
   - recommended category, priority, and team;
   - classifier evidence and lifecycle state;
   - a "What changed" summary when recommendation history exists;
   - draft source and style;
   - validator checks;
   - retrieved context;
   - human approval status.
6. The reviewer edits or approves selected fields.
7. The service applies only approved fields and records an audit event.

## Safety Properties

- Prompt-injection text inside tickets is never authorization.
- Recommendation submission does not mutate the ticket.
- Approval requires exact ticket revision, actor, named fields, and
  `confirm: true`.
- Security and outage routing are enforced by deterministic code.
- GPT advisory classification signals are bounded, visible, and cannot
  override deterministic security, outage, SLA, or approval rules.
- GPT drafting falls back to local deterministic text if provider calls fail or
  validator checks warn.
- Customer responses are recorded in audit data only; the demo has no outbound
  messaging integration.

## Evidence

The committed fixture evaluator reports:

```json
{
  "ticketCount": 30,
  "categoryAccuracy": 1,
  "routingAccuracy": 1,
  "priorityAgreement": 1,
  "securityEscalationRecall": 1,
  "outageEscalationRecall": 1,
  "duplicatePrecision": 1,
  "duplicateRecall": 1,
  "knowledgeCitationCoverage": 1,
  "approvalSafetyViolations": 0
}
```

These metrics are reproducible fixture checks, not real customer support
performance claims.

## What To Review In The Code

- `src/server.ts`: MCP tools, resources, prompts, and safety annotations.
- `src/triage-service.ts`: submission, approval, rejection, and audit logic.
- `src/approval-desk/draft-response-provider.ts`: GPT drafting, structured
  output parsing, advisory reasoning contracts, validator fallback, and safe
  error handling.
- `src/approval-desk/classifier.ts`: deterministic classification, weighted
  signals, metadata handling, safety precedence, and GPT advisory signal
  resolution.
- `src/approval-desk/conversation-context.ts`: normalized ticket and reply
  context for reclassification.
- `src/approval-desk/http.ts`: local Approval Desk API.
- `src/approval-desk/ui.ts`: browser review and approval interface.
- `data/knowledge/`: local clean-room knowledge articles.

