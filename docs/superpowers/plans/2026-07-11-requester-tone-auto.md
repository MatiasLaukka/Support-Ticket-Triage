# Requester Tone Auto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Default customer response drafting to a GPT/deterministic recommended tone derived from requester metadata, while preserving manual override.

**Architecture:** Add requester metadata to ticket fixtures and schema. Extend draft style input with `auto`, resolve it to a recommended style before drafting, and store both recommended tone and selected tone in GPT Assist. Keep the Approval Desk UI compact with one line for recommended tone and one line for selected style.

**Tech Stack:** TypeScript, Zod, Vitest, existing fixture generator, existing Approval Desk HTML/JS.

---

### Task 1: Ticket Requester Metadata

**Files:**
- Modify: `src/domain.ts`
- Modify: `scripts/generate-fixtures.ts`
- Regenerate: `data/seed/tickets.json`
- Test: `test/domain.test.ts`
- Test: `test/fixtures.test.ts`

- [x] **Step 1: Write failing tests**

Add tests proving `TicketSchema` accepts `requester` with name, role, department, technical level, and seniority. Add fixture assertions that all 30 generated tickets have requester metadata and cover marketing, engineering, executive, and operations roles.

- [x] **Step 2: Verify RED**

Run `npm test -- --run test/domain.test.ts test/fixtures.test.ts`.
Expected: FAIL because requester is not in the strict ticket schema or fixtures.

- [x] **Step 3: Implement schema and fixtures**

Add requester schemas/types and populate requester data in `scripts/generate-fixtures.ts`, then run `npm run build` and `npm run generate:fixtures`.

- [x] **Step 4: Verify GREEN**

Run `npm test -- --run test/domain.test.ts test/fixtures.test.ts`.
Expected: PASS.

### Task 2: Auto Style And Recommended Tone

**Files:**
- Modify: `src/domain.ts`
- Modify: `src/approval-desk/http.ts`
- Modify: `src/approval-desk/draft-response-provider.ts`
- Modify: `src/approval-desk/recommendation-builder.ts`
- Test: `test/openai-draft-provider.test.ts`
- Test: `test/approval-desk-recommendation.test.ts`
- Test: `test/approval-desk-http.test.ts`

- [x] **Step 1: Write failing tests**

Add tests that `auto` resolves to requester-based recommended tone, OpenAI input includes requester metadata and resolved style, and manual override preserves recommended tone separately from selected style.

- [x] **Step 2: Verify RED**

Run `npm test -- --run test/openai-draft-provider.test.ts test/approval-desk-recommendation.test.ts test/approval-desk-http.test.ts`.
Expected: FAIL because `auto`, recommended tone, and tone reason are missing.

- [x] **Step 3: Implement tone resolution**

Add `DraftCustomerResponseStyleInputSchema` with `auto`, add `recommendedTone`, `selectedTone`, and `toneReason` to `GptAssistSchema`, and update drafting input/output to use resolved style while keeping manual overrides explicit.

- [x] **Step 4: Verify GREEN**

Run `npm test -- --run test/openai-draft-provider.test.ts test/approval-desk-recommendation.test.ts test/approval-desk-http.test.ts`.
Expected: PASS.

### Task 3: Compact UI And Loading State

**Files:**
- Modify: `src/approval-desk/ui.ts`
- Test: `test/approval-desk-ui.test.ts`

- [x] **Step 1: Write failing UI tests**

Assert the draft style selector defaults to `auto`, create recommendation shows "Generating GPT draft and assist...", and GPT Assist renders recommended tone, selected style, and reason.

- [x] **Step 2: Verify RED**

Run `npm test -- --run test/approval-desk-ui.test.ts`.
Expected: FAIL because the UI does not expose those labels.

- [x] **Step 3: Implement compact UI**

Add `Auto recommended` as the first draft style option, show the loading state while recommendation creation is in flight, and update the assist card chips.

- [x] **Step 4: Verify GREEN**

Run `npm test -- --run test/approval-desk-ui.test.ts`.
Expected: PASS.

### Task 4: Final Verification And Commit

- [x] Run `npm test`.
- [x] Run `npm run evaluate`.
- [x] Run `git diff --check`.
- [x] Commit as `feat: recommend response tone from requester`.
- [x] Push the branch.
