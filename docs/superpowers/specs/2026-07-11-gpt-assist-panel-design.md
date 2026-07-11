# GPT Assist Panel Design

## Goal

Extend the Approval Desk from "GPT drafts the customer response" to "GPT
provides bounded agent-assist material for review." The feature should help a
support reviewer understand what to ask, what to check next, and what tone the
draft is using, while preserving the current deterministic ownership of routing,
priority, escalation, safety, approval, and audit behavior.

## Current State

The Approval Desk currently builds a deterministic recommendation, optionally
calls OpenAI for `draftCustomerResponse`, validates that draft, and stores the
result as a pending recommendation. The dashboard displays the draft, retrieved
knowledge context, validator checks, proposed ticket fields, and approval
controls. Approval or rejection goes through the same service and audit
repositories regardless of whether the recommendation came from the browser UI
or an MCP client such as Codex.

## Recommended Approach

Use a hybrid enrichment provider. Keep the existing deterministic
recommendation as the source of truth, but allow the optional OpenAI provider to
return structured assist fields:

- likely missing information;
- suggested investigation steps;
- selected tone;
- inferred audience level;
- customer-facing draft response.

The deterministic fallback should return equivalent local assist fields so the
demo still works without an API key or when the OpenAI request fails.

## Data Model

Add optional fields to `TriageRecommendation`:

```ts
gptAssist?: {
  source: "deterministic" | "openai" | "fallback";
  missingInfoSuggestions: string[];
  investigationSteps: string[];
  tone: "balanced" | "concise" | "empathetic" | "technical" | "executive-update";
  audience: "merchant-admin" | "developer" | "executive";
  checks: DraftCustomerResponseCheck[];
}
```

The existing top-level fields remain unchanged. `missingInformation` stays the
deterministic recommendation signal. `gptAssist.missingInfoSuggestions` is a
review aid and may be more customer-friendly or topic-specific.

## Provider Flow

1. `recommendation-builder` creates the deterministic base recommendation.
2. The drafting provider receives the ticket, expected outcome, retrieved
   articles, deterministic draft, and requested response style.
3. In deterministic mode, the provider returns a deterministic draft plus local
   assist fields.
4. In OpenAI mode, the provider asks for strict JSON containing the draft and
   assist fields.
5. Validators check:
   - non-empty draft;
   - no internal knowledge article IDs;
   - no approval bypass language;
   - no unsafe resolution promise;
   - no secrets requested in missing information;
   - investigation steps are reviewer-facing and not customer promises.
6. If OpenAI fails or validation warns on blocking checks, use fallback assist
   content and record the fallback warning.

## UI

Add a "GPT Assist" card near the draft customer response. It should show:

- tone and audience chips;
- likely missing information as short bullets;
- suggested investigation steps as short bullets;
- source and validation status.

The panel should be visibly advisory. It must not look like approved customer
communication or an automatic action. The customer response textarea remains
the only customer-facing text that can be approved.

## Approval And Audit Boundary

No new approvable field is needed for the assist panel in the first version.
The assist content is stored with the pending recommendation for review and
appears in audit evidence indirectly through the recommendation snapshot. The
existing approval flow continues to record only named approved fields, edited
customer response text, actor, revision, recommendation ID, citations, and the
audit result.

If a recommendation is created through Codex via MCP, the same repositories are
used as long as Codex and the Approval Desk point at the same local runtime
state. The dashboard will then show pending recommendations, approvals,
rejections, metrics, and audit events created by the MCP workflow.

## Error Handling

- Missing `OPENAI_API_KEY`: keep deterministic local assist.
- OpenAI 429 or network failure: fallback assist with a warning check.
- Invalid JSON or schema mismatch: fallback assist with a warning check.
- Unsafe assist content: fallback assist and preserve the validator warning.

## Testing

Add or update tests for:

- deterministic recommendations include assist content;
- OpenAI provider parses structured assist JSON;
- provider fallback includes assist content and warning checks;
- validators reject internal article IDs, approval bypass, unsafe promises, and
  secret requests;
- HTTP recommendation creation returns assist content;
- UI renders the GPT Assist panel;
- approval and rejection audit behavior remains unchanged.

## Out Of Scope

- Letting GPT choose category, priority, team, escalation, or approval rules.
- Sending customer responses externally.
- Adding a new database or queue.
- Persisting API prompts or raw OpenAI responses.
- Making assist fields independently approvable.
