# Portfolio Polish Design

## Goal

Make the project easier to evaluate as a portfolio-ready AI automation demo by aligning the public documentation, screenshots, and demo guidance with the current Approval Desk behavior.

## Scope

- Update public-facing documentation to describe the current architecture:
  - deterministic classification and safety guardrails;
  - conversation-aware reclassification from original ticket plus replies;
  - recalculated evidence requirements and lifecycle state;
  - optional GPT drafting;
  - bounded GPT advisory classification signals;
  - human approval, audit trail, and local-only runtime boundaries.
- Add local screenshots under `docs/assets/` that show the current Approval Desk UI.
- Link screenshots from the README where they help explain the workflow.
- Keep cleanup small and portfolio-focused:
  - ignore local demo logs and internal `.superpowers/sdd` artifacts;
  - do not change runtime behavior unless verification exposes a concrete bug.

## Non-Goals

- No live Zendesk, Jira, email, or identity integration.
- No real customer data.
- No new product workflow beyond documentation and small polish fixes.
- No broad UI redesign.
- No claims that fixture metrics represent production accuracy.

## Acceptance Criteria

- README no longer contradicts current GPT advisory classification behavior.
- README gives a fast reviewer path: what it is, what to run, what to look at, and what the screenshots show.
- Public docs mention the conversation workspace and TKT-1010 style evolving-ticket demonstration.
- Screenshots are generated from the local synthetic demo and contain no secrets.
- `npm test` passes after the documentation/polish pass.
- A local smoke check proves the Approval Desk still creates an adaptive recommendation from a customer reply.
