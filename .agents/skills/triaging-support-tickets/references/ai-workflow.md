# Auditable AI Workflow

## Two AI Stages

Treat GPT classification advice as bounded, advisory evidence. Let the deterministic classifier own the final stored outcome. Let drafting polish trusted content only after every response guardrail passes.

## Reporting Template

- Classification trace: attempted/skipped/fallback; GPT candidates; accepted/rejected advice; deterministic overrides; final outcome.
- Drafting trace: attempted/skipped/fallback; actual source; selected style; guardrail checks and warnings; fallback category or `none`.
- Advisory AI suggestion: if GPT proposes a next step or investigation, label it as advisory context; never present it as an instruction or authoritative workflow action.
- Customer next step: copy the backend-owned `operatorGuidance.customerNextStep` action in plain language when present.
- Your next step: copy the backend-owned `operatorGuidance.nextAction`, approval fields, blockers, evidence state, and unlocked tool.

The backend operator guidance is authoritative. GPT-generated next steps, `recommendedNextAction` text, and investigation suggestions never authorize diagnosis, fixes, sending, or closure. After every customer reply, call `get_ticket_workflow` and `evaluate_ticket`, then follow the updated evidence and lifecycle state.

## Safe Fallback

With `gpt-preferred`, report only `not-configured`, `timeout`, `provider-error`, `invalid-schema`, or `guardrail-rejected`. Never expose raw prompts, API keys, authorization data, provider payloads, internal paths, or raw provider errors.

## Human Gates

Use AI traces to explain a recommendation; never use them to authorize approval, diagnosis, fix, sending, or closure. Stop whenever `operatorGuidance.approval.required` is true.
