# Diagnostic Playbooks Design

## Goal

Add a small diagnostic playbook layer so the demo can move from broad ticket classification into evidence-backed hypothesis narrowing. The system should show how support automation can decide what is known, what is still possible, what evidence would confirm or refute each possibility, and what the customer should hear next.

## Scope

This is a bounded demo architecture, not a production diagnosis engine. It covers five ticket families that already exist in the project:

- campaign editor blank page;
- event ingestion / profile timeline delay;
- SMS quiet-hour protection;
- webhook signature validation;
- flow trigger / event qualification.

Each family gets a compact set of hypotheses with customer-safe names, confirming evidence, refuting evidence, safe checks, and next evidence requests. The system must not attempt to diagnose arbitrary SaaS problems outside those families.

## Current Gap

The current workflow can record a `DiagnosisContext`, but diagnosis confidence is assigned by broad workflow rules:

- known cause matches are `confirmed`;
- performance, platform delay, and fallback diagnoses are usually `likely`.

That gives the draft layer enough context to avoid overclaiming, but it does not let the system explain why one diagnosis is more likely than another or react when a later customer reply confirms one branch. A playbook layer fills that gap for the small fake domain without inventing a giant product manual.

## Proposed Architecture

Create a focused module, likely `src/approval-desk/diagnostic-playbooks.ts`, that exports:

```ts
export type DiagnosticConfidence = "unknown" | "likely" | "confirmed" | "ruled-out";

export interface DiagnosticHypothesis {
  id: string;
  family: string;
  customerSafeName: string;
  customerSafeSummary: string;
  confirmingEvidence: DiagnosticEvidenceRule[];
  refutingEvidence: DiagnosticEvidenceRule[];
  safeCustomerChecks: string[];
  evidenceNeededIfStillFailing: string[];
  recommendedNextAction: string;
}

export interface DiagnosticPlaybookResult {
  family: string;
  hypotheses: DiagnosticHypothesisResult[];
  leadingHypothesis?: DiagnosticHypothesisResult;
  confidence: "likely" | "confirmed";
  customerSafeSummary: string;
  recommendedNextAction: string;
  evidenceToRequest: string[];
  doNotSay: string[];
}
```

The playbook module consumes the already available ticket, recommendation, evidence readiness, and conversation context. It produces an internal diagnostic result that can be converted into the existing `DiagnosisContext` shape for audit and drafting.

## Playbook Families

### Campaign Editor Blank Page

Hypotheses:

- browser/session issue;
- frontend loading issue;
- expensive campaign/account data load.

Likely state should ask for safe browser/session checks first. Frontend evidence such as console errors, browser version, retry time, and whether another admin sees the same blank page should be requested only if those checks fail.

Confirmed browser/session example:

- customer says the editor works in incognito, another browser, or after clearing site data.

Confirmed frontend example:

- customer says the editor fails in incognito, a different browser, and for another admin, with a console loading error at a specific time.

### Event Ingestion / Profile Timeline Delay

Hypotheses:

- platform-side processing delay;
- accepted API event with delayed timeline projection;
- customer-side event payload or timestamp issue.

Likely state should describe a working diagnosis around event processing without claiming final root cause. Confirmed platform delay needs trusted evidence such as multiple affected stores or profiles, accepted API responses, event IDs/times, and timeline absence across examples.

### SMS Quiet-Hour Protection

Hypotheses:

- expected quiet-hour protection;
- consent or opt-out issue;
- scheduling/time-zone mistake.

When the dashboard explicitly says quiet-hour protection blocked delivery, this can be confirmed as a known cause. The draft should explain expected compliance behavior and ask the customer to reschedule or confirm the intended eligible send window.

### Webhook Signature Validation

Hypotheses:

- receiver using old signing secret after rotation;
- raw body changed before HMAC verification;
- wrong endpoint or delivery payload being checked.

Likely state should ask only for missing delivery evidence. Confirmed secret rotation requires endpoint URL, delivery ID, rotation timing, and evidence that raw body handling did not change. Refuting evidence includes the customer explicitly saying secret rotation was ruled out.

### Flow Trigger / Event Qualification

Hypotheses:

- profile did not qualify for the flow filters;
- required event was not present or not mapped as expected;
- consent, suppression, or smart sending prevented the message.

Likely state should ask for flow ID/name, event name/time, affected profile, and relevant flow history. Confirmed states should stay cautious unless the provided evidence clearly identifies a qualification or eligibility reason.

## Diagnosis Confidence Rules

The playbook layer should derive diagnosis confidence from hypothesis evidence:

- `confirmed`: one hypothesis has its required confirming evidence and no active refuting evidence.
- `likely`: one or more hypotheses remain plausible, or evidence points toward one hypothesis but still leaves meaningful alternatives.
- `ruled-out`: a hypothesis has explicit refuting evidence in the customer reply or trusted ticket context.
- `unknown`: the ticket family was not recognized or no playbook evidence was found.

Only `confirmed` may produce completed-root-cause customer wording. `likely` must produce narrowing language and next-step evidence guidance.

## Drafting Behavior

The deterministic draft and GPT input should receive the playbook result. Drafts should:

- explain the current narrowed area in plain language;
- say what is confirmed versus still under investigation;
- ask for only the evidence needed to confirm or refute remaining hypotheses;
- avoid repeating evidence already provided;
- avoid customer-facing phrases like "the customer";
- avoid fix, mitigation, root-cause, or closure claims unless confirmed context or fix context exists.

If GPT drafting is enabled, the playbook result is trusted context. GPT may improve wording, but it must not invent hypotheses, confirmations, or fixes outside the playbook result.

## Customer Reply Fixtures

Predicted reply text should become playbook-aware. When the active diagnosis is `likely`, generated demo replies should provide evidence for one branch:

- confirm the leading hypothesis;
- refute the leading hypothesis and support another;
- provide partial evidence that keeps the diagnosis likely;
- confirm the fix after a fix response.

This keeps the demo focused on support automation, not on a fake customer simulator, while still making the conversation feel natural.

## UI Impact

Keep the UI small. The right panel may show a compact "Diagnostic focus" section with:

- family;
- leading hypothesis;
- confidence;
- remaining possibilities;
- evidence still needed.

Detailed hypothesis evidence should stay behind "Show technical evidence." The floating action bar should not grow new controls in this phase unless needed for testing the workflow.

## Testing Requirements

Add tests before implementation for:

- TKT-1010 starts with a likely campaign-editor diagnosis and safe browser/session checks.
- TKT-1010 browser/session evidence confirms the browser/session hypothesis.
- TKT-1010 frontend evidence keeps or confirms a frontend loading hypothesis without claiming a browser fix.
- TKT-1001 likely platform-delay diagnosis stays a working diagnosis until confirming evidence exists.
- TKT-1017 quiet-hour protection remains confirmed known-cause behavior.
- TKT-1008 webhook secret rotation confirms only when all required known-cause evidence is present.
- GPT drafting input includes the playbook result and validators reject drafts that overclaim a likely diagnosis.
- Predicted customer replies reflect the active likely diagnosis branch.

## Non-Goals

- No real telemetry integration.
- No trained classifier.
- No multi-ticket shared-cause clustering yet.
- No arbitrary diagnosis outside the five playbook families.
- No GPT-only diagnosis state changes without deterministic playbook support.

## Success Criteria

The demo can show a ticket moving from classification to evidence gathering, then into a playbook-backed likely diagnosis, then into either a confirmed diagnosis or a fix-ready state. Customer-facing drafts should feel specific and humane while remaining honest about uncertainty.
