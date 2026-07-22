# Auditable AI Workflow

## Two AI Stages

Treat GPT classification advice as bounded, advisory evidence. Let the deterministic classifier own the final stored outcome. Let drafting polish trusted content only after every response guardrail passes.

## Reporting Template

- Classification trace: attempted/skipped/fallback; GPT candidates; accepted/rejected advice; deterministic overrides; final outcome.
- Drafting trace: attempted/skipped/fallback; actual source; selected style; guardrail checks and warnings; fallback category or `none`.
- Customer next step: copy the backend-owned customer action in plain language.
- Your next step: copy the backend-owned operator action, approval fields, blockers, and unlocked tool.

## Safe Fallback

With `gpt-preferred`, report only `not-configured`, `timeout`, `provider-error`, `invalid-schema`, or `guardrail-rejected`. Never expose raw prompts, API keys, authorization data, provider payloads, internal paths, or raw provider errors.

## Human Gates

Use AI traces to explain a recommendation; never use them to authorize approval, diagnosis, fix, sending, or closure. Stop whenever `operatorGuidance.approval.required` is true.
