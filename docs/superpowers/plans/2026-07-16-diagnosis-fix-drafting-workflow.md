# Diagnosis and Fix Drafting Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trusted diagnosis/fix contexts, action-bar workflow controls, automatic ticket-specific customer replies, and reusable customer-service drafting policy.

**Architecture:** Keep deterministic workflow state and audit events as the authority. GPT receives diagnosis/fix context and drafting policy as trusted input, but cannot create diagnosis/fix events by itself. The UI action bar remains the command center; the right panel remains read-only.

**Tech Stack:** TypeScript, Node.js, Zod, Vitest, local JSON repositories, single-file Approval Desk UI.

## Global Constraints

- No real multi-ticket shared-cause clustering in this phase.
- Do not treat `diagnosing` as diagnosis completed.
- `Fix` requires a prior completed diagnosis event.
- Customer replies are automatic demo fixtures, not GPT-generated customer simulation.
- GPT must receive trusted diagnosis/fix context before explaining diagnosis or announcing a fix.
- No production code without a failing test first.

---

### Task 1: Domain and Timeline Events

**Files:**
- Modify: `src/domain.ts`
- Modify: `src/approval-desk/conversation-history.ts`
- Test: `test/conversation-history.test.ts`

**Interfaces:**
- Produces audit actions `diagnosis-completed` and `fix-available`.
- Produces conversation timeline items with `kind: "diagnosis"` and `kind: "fix"`.

- [ ] **Step 1: Write failing timeline tests for diagnosis/fix events**
- [ ] **Step 2: Run targeted test and verify failure**
- [ ] **Step 3: Add schemas and timeline mapping**
- [ ] **Step 4: Run targeted test and verify pass**

### Task 2: Backend Workflow Actions

**Files:**
- Modify: `src/approval-desk/http.ts`
- Test: `test/approval-desk-http.test.ts`

**Interfaces:**
- Produces `POST /api/tickets/:ticketId/diagnosis`
- Produces `POST /api/tickets/:ticketId/fix`
- Both append audit events and return updated ticket detail.

- [ ] **Step 1: Write failing HTTP tests for Diagnose/Fix gating**
- [ ] **Step 2: Run targeted test and verify failure**
- [ ] **Step 3: Implement endpoints and gating**
- [ ] **Step 4: Run targeted test and verify pass**

### Task 3: Recommendation Context and Drafting

**Files:**
- Modify: `src/approval-desk/recommendation-builder.ts`
- Modify: `src/approval-desk/draft-response-provider.ts`
- Create: `src/approval-desk/customer-service-drafting-policy.ts`
- Test: `test/approval-desk-recommendation.test.ts`
- Test: `test/openai-draft-provider.test.ts`

**Interfaces:**
- Consumes diagnosis/fix timeline events.
- Adds trusted `diagnosisContext` and `fixContext` to draft input.
- Includes reusable customer-service policy in GPT instructions.

- [ ] **Step 1: Write failing draft tests for diagnosis/fix context**
- [ ] **Step 2: Run targeted tests and verify failure**
- [ ] **Step 3: Implement context extraction and drafting policy**
- [ ] **Step 4: Run targeted tests and verify pass**

### Task 4: Automatic Customer Replies

**Files:**
- Modify: `src/approval-desk/http.ts`
- Modify: `src/approval-desk/ui.ts`
- Test: `test/approval-desk-http.test.ts`
- Test: `test/approval-desk-ui.test.ts`

**Interfaces:**
- After configured `Done` actions, appends a ticket-specific automatic customer reply.
- Automatic replies are visible in timeline and make the ticket `customer-replied`.

- [ ] **Step 1: Write failing tests for automatic reply after fix Done**
- [ ] **Step 2: Run targeted tests and verify failure**
- [ ] **Step 3: Implement automatic reply fixtures and UI visibility**
- [ ] **Step 4: Run targeted tests and verify pass**

### Task 5: Action Bar Buttons

**Files:**
- Modify: `src/approval-desk/ui.ts`
- Test: `test/approval-desk-ui.test.ts`

**Interfaces:**
- Shows `Diagnose` only after Done, complete evidence, no waiting reply, and no diagnosis.
- Shows `Fix` only after diagnosis response Done and no waiting reply.
- Keeps manual reply entry available as override.

- [ ] **Step 1: Write failing UI tests for button visibility**
- [ ] **Step 2: Run targeted UI tests and verify failure**
- [ ] **Step 3: Implement action bar buttons and click handlers**
- [ ] **Step 4: Run targeted UI tests and verify pass**

### Task 6: Verification

**Files:**
- No production files unless failures reveal integration gaps.

- [ ] **Step 1: Run focused tests**
- [ ] **Step 2: Run full test suite**
- [ ] **Step 3: Run typecheck/build if not already covered**
- [ ] **Step 4: Summarize changes and known limits**
