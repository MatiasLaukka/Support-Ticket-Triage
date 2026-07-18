# Explanation Request Follow-Ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make customer replies like "Okay. What's the problem?" produce a plain-language explanation of the current diagnosis instead of repeating the previous evidence or ETA draft.

**Architecture:** Keep `supportState` as the operational workflow state and add an `explanation-request` customer turn type beside `status-follow-up`. Deterministic rules identify common explanation-intent phrases; GPT can still draft wording, but validation forces fallback if it repeats the diagnostic checklist.

**Tech Stack:** TypeScript, Vitest, local Approval Desk recommendation builder, deterministic draft validator.

## Global Constraints

- Do not add a broad `needs-clarification` support state for this behavior.
- Do not let customer text directly mutate ticket fields or bypass approval.
- Keep GPT advisory bounded: deterministic lifecycle and validators remain final.
- Keep the UI unchanged for this slice unless tests prove an API contract needs exposing.

---

### Task 1: Explanation Intent Regression

**Files:**
- Modify: `test/approval-desk-recommendation.test.ts`

**Interfaces:**
- Consumes: `buildApprovalDeskRecommendationInput(...)`
- Produces: failing regression coverage for `explanation-request`

- [ ] **Step 1: Write the failing deterministic test**

Add a test using `TKT-1001`, a previous platform-fix support response, and the customer reply `Okay. What's the problem?`.

- [ ] **Step 2: Run the focused test**

Run: `npx vitest run test/approval-desk-recommendation.test.ts -t "answers platform-fix explanation requests"`

Expected: FAIL because the current turn type is still treated as a vague/status follow-up.

### Task 2: Deterministic Explanation Draft

**Files:**
- Modify: `src/approval-desk/draft-response-provider.ts`
- Modify: `src/approval-desk/recommendation-builder.ts`

**Interfaces:**
- Consumes: `CustomerReplyStage`
- Produces: `explanation-request` turn type and a deterministic explanation draft

- [ ] **Step 1: Extend turn type**

Add `explanation-request` to the shared conversation turn type union.

- [ ] **Step 2: Detect explanation intent**

Add a helper matching common phrases such as `what's the problem`, `what happened`, `why is this happening`, and `what is wrong`.

- [ ] **Step 3: Build customer-facing explanation**

For platform-fix context, explain the suspected event-processing delay, clearly saying it is not confirmed root cause yet. Avoid asking for the same evidence unless new missing evidence is genuinely needed.

- [ ] **Step 4: Run the focused test**

Run: `npx vitest run test/approval-desk-recommendation.test.ts -t "answers platform-fix explanation requests"`

Expected: PASS.

### Task 3: GPT Guard

**Files:**
- Modify: `test/approval-desk-recommendation.test.ts`
- Modify: `src/approval-desk/draft-response-provider.ts`

**Interfaces:**
- Consumes: `conversationContext.turnType`
- Produces: validator warning and fallback for explanation-request drafts that repeat diagnostic asks

- [ ] **Step 1: Write a failing provider test**

Mock an OpenAI draft that answers an explanation request by asking for store URL/request ID again.

- [ ] **Step 2: Add validator check**

Reject provider drafts for `explanation-request` when they contain checklist/request phrasing or missing-evidence labels.

- [ ] **Step 3: Verify**

Run focused tests, then `npm test`.

### Task 4: Restart Demo

**Files:**
- No code changes.

**Interfaces:**
- Consumes: built `dist`
- Produces: live local demo at `http://127.0.0.1:5177`

- [ ] **Step 1: Stop stale demo Node processes**
- [ ] **Step 2: Start `npm run demo:showcase`**
- [ ] **Step 3: Verify HTTP 200 from `/`**
