# Diagnosis and Fix Drafting Workflow Design

## Goal

Add a realistic support lifecycle step between evidence collection and fix updates so the demo can show: evaluate ticket, gather evidence, diagnose the issue, announce a fix or mitigation, receive visible customer replies, then close warmly after customer confirmation.

## Scope

This phase focuses on the customer-service drafting workflow, demo controls, and ticket-specific automatic customer replies. It does not add shared-cause clustering across multiple tickets yet.

## Current Behavior

The current `diagnosing` support state means all required evidence is present and no known cause or platform-fix state was selected. It does not mean a diagnosis has actually been completed. Because of that, the UI must not let the reviewer jump straight from `diagnosing` to `Fix`.

## New Workflow

The action bar should support this flow:

1. `Evaluate` creates a recommendation from the ticket and timeline.
2. `Done` logs the customer-facing response as sent.
3. If evidence is complete, `Diagnose` becomes available.
4. `Diagnose` records an internal diagnosis context and allows another evaluation.
5. The next draft explains the customer-safe diagnosis without claiming a fix.
6. After the diagnosis response is Done, `Fix` becomes available.
7. `Fix` records an internal fix context and allows another evaluation.
8. The next draft announces the fix or mitigation and asks the customer to verify.
9. The demo can automatically add a ticket-specific customer reply after the fix update, making the ticket visibly active again.
10. If the customer reply says it works, the next evaluation moves to `ready-for-close` and sends a warm closing response.

## Diagnosis Context

GPT must not invent a diagnosis. Drafting may explain a diagnosis only when trusted context includes a diagnosis object:

```ts
interface DiagnosisContext {
  status: "completed";
  causeType:
    | "configuration"
    | "platform-delay"
    | "customer-data"
    | "integration"
    | "security"
    | "performance";
  customerSafeSummary: string;
  evidenceUsed: string[];
  confidence: "likely" | "confirmed";
  owner: "support" | "engineering" | "customer" | "integration-partner";
  recommendedNextAction: string;
  doNotSay: string[];
}
```

## Fix Context

GPT may announce a fix or mitigation only when trusted context includes a fix object:

```ts
interface FixContext {
  status: "available";
  customerSafeSummary: string;
  customerAction: string;
  verificationRequest: string;
}
```

## Scenario Coverage

The demo should include plausible diagnosis and fix contexts for the current ticket families:

- EU checkout event delay: platform processing delay after accepted API events.
- Campaign editor blank page: performance/session/frontend loading issue after concrete evidence arrives.
- Webhook delivery latency: retry or endpoint response behavior explains late deliveries.
- Campaign send stuck: audience snapshot or send-preparation job stalled.
- SMS STOP sync delay: opt-out event arrived but consent/profile timeline lagged.
- Track API timestamp rejected: local-time timestamp caused API validation failure.
- Webhook signature failure: receiver used an outdated signing secret after rotation.
- Shopify custom field missing: integration mapping/scopes did not include the expected field.
- Security/API key exposure: key rotation/containment completed after exposure review.

Known-cause tickets may not need the `Diagnose` and `Fix` buttons, because their answer can come from documented historical causes. The buttons are for tickets where support work happens after evidence collection.

## Automatic Customer Replies

Customer replies are demo fixtures, not the product's intelligence. To keep the usage flow focused on support automation, the app may automatically add ticket-specific customer replies after a support response is marked `Done`.

Automatic replies should be:

- specific to the selected ticket and current lifecycle stage;
- visible in the conversation timeline and action bar;
- timestamped after the sent support response;
- treated exactly like a real customer reply by the next evaluation;
- easy to distinguish as demo-generated in developer/audit data, without using unnatural customer-facing wording.

Automatic reply stages:

- after an information request: provide partial or complete evidence depending on the ticket scenario;
- after a diagnosis explanation: ask a natural follow-up or acknowledge the diagnosis;
- after a fix update: confirm success for solved demo paths, or report continued impact for unresolved demo paths.

A newly added automatic customer reply should make the ticket visibly active again:

- queue state becomes `customer-replied` or equivalent;
- the ticket row should stand out from ordinary waiting tickets;
- the action bar should show the latest reply preview;
- the next primary action should be `Evaluate`.

Manual reply entry can remain available as an advanced/demo override, but it should not be required for the main showcase flow.

## Button Rules

Show `Diagnose` only when:

- the latest evaluated response has been marked `Done`;
- no newer customer reply is waiting;
- `missingEvidence.length === 0`;
- the support state is `diagnosing` or `waiting-on-platform-fix`;
- no completed diagnosis context already exists after the latest customer reply.

Show `Fix` only when:

- a completed diagnosis context exists;
- the diagnosis response has been marked `Done`;
- no newer customer reply is waiting;
- no fix context already exists after the diagnosis.

Do not show either button for `needs-information`, `information-received`, `known-cause`, or `ready-for-close`.

## Drafting Policy

Add a reusable customer-service drafting policy loaded into GPT instructions and mirrored by deterministic fallback wording. The policy must be topic-general and cover:

- first contact with missing information;
- partial evidence replies;
- all evidence received but no diagnosis yet;
- diagnosis completed;
- fix or mitigation available;
- known-cause response;
- waiting on platform/internal work;
- status follow-up;
- explanation request;
- warm closure after thanks or confirmation;
- forbidden claims, especially unsupported root cause, unsupported fix, secrets, internal article IDs, and approval/audit language.

## Testing Requirements

Add tests before implementation for:

- `Diagnose` is unavailable while evidence is missing.
- `Diagnose` appears after a Done response with complete evidence.
- `Fix` is unavailable until diagnosis is recorded.
- `Fix` appears after a diagnosis response is Done.
- diagnosis context changes the next draft into a diagnosis explanation.
- fix context changes the next draft into a verify-the-fix update.
- automatic ticket-specific customer replies are added after configured Done actions.
- automatic replies make the ticket visibly active and ready for evaluation.
- GPT prompt includes the reusable drafting policy and diagnosis/fix context.
- customer confirmation still produces a warm close.

## Non-Goals

- No real multi-ticket shared-cause clustering in this phase.
- No trained classifier.
- No claim that `diagnosing` means diagnosis completed.
- No automatic fix creation from GPT text alone.
- No GPT-generated customer persona simulator in this phase.
