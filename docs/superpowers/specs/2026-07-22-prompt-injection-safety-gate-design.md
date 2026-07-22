# Prompt-Injection Safety Gate

## Goal

Prevent untrusted prompt-injection text from reaching GPT classification or
customer-response drafting while preserving deterministic triage of the
legitimate support issue. The safety decision must be visible to operators and
auditable, but must not be disclosed in the customer-facing draft.

## Design

### 1. Deterministic preflight assessment

Add a small pure detector in the Approval Desk classification boundary. It
receives the combined ticket and conversation text and returns a sanitized
assessment containing:

- `detected`: boolean;
- stable matched rule IDs for approval bypass, policy override, or concealment;
- an operator-safe warning explaining that GPT stages were skipped.

The detector is not the business classifier. The normal deterministic classifier
still runs because it is the trusted owner of category, priority, team, evidence,
and escalation. The detector runs before any external reasoning or drafting
provider is called.

### 2. GPT stage bypass

When the assessment detects prompt injection:

- do not call the classification reasoning provider;
- do not call the customer-response drafting provider;
- retain the deterministic classification and deterministic customer draft;
- preserve policy-conflict/security/SLA/missing-information escalation signals;
- record the requested AI preference separately from the safety override.

When no injection is detected, the existing advisory GPT flow is unchanged.

### 3. Auditable operator warning

Extend the persisted AI execution trace with a structured safety record:

```text
safety: {
  promptInjectionDetected: true,
  matchedRules: [...],
  action: "gpt-stages-skipped",
  warning: "Untrusted instruction-like ticket content detected; deterministic triage was used."
}
```

The same sanitized safety record is copied into the recommendation-submitted
audit event's `after` payload. Operator guidance and the Skill reporting
template surface the warning. Raw ticket text, model prompts, and provider
payloads are never copied into the warning.

### 4. Customer-facing behavior

The deterministic draft addresses the underlying support issue and requests
only legitimate missing evidence. It does not mention prompt injection,
internal safety rules, GPT, skipped providers, or a refusal to process the
ticket.

### 5. Workflow behavior

The ticket remains in the normal governed lifecycle. The operator sees the
warning, deterministic recommendation, policy-conflict escalation when
applicable, and the existing explicit approval gate. Diagnosis, fix, response,
and closure gates are unchanged.

## Verification

Add tests that prove:

1. TKT-1005 triggers the detector and never invokes either injected GPT stub.
2. A normal ticket still invokes GPT classification and drafting as before.
3. The deterministic TKT-1005 result remains integration/P2/integrations with
   `policy-conflict` and the normal missing-evidence draft.
4. The persisted trace and submission audit contain only the sanitized safety
   record.
5. The customer draft contains no prompt-injection or internal safety wording.
6. The official Skill validator, full test suite, and live MCP evaluation still
   pass; the live run stops at human review without approval or sending.

## Non-goals

- Do not reject or abandon tickets merely because they contain prompt injection.
- Do not make GPT authoritative for classification or workflow actions.
- Do not add automatic external inbox polling.
- Do not expose raw injection text or internal safety telemetry to customers.
