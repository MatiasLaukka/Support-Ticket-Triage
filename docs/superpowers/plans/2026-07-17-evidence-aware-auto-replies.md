# Evidence-Aware Auto Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generic synthetic customer replies with natural evidence-aware replies shared by MCP tools and the Approval Desk HTTP workflow.

**Architecture:** Add a focused `automatic-customer-replies` module that consumes the ticket, latest recommendation, and prior audit trail. Both `src/server.ts` and `src/approval-desk/http.ts` call this module so operator and UI demos behave the same. The module stays deterministic: it answers requested evidence and diagnostic follow-up prompts; it does not invent independent customer reasoning.

**Tech Stack:** TypeScript, Vitest, local JSON fixtures, MCP in-memory client tests, Approval Desk HTTP tests.

## Global Constraints

- Do not build a second autonomous customer simulator.
- Auto replies must respond to the recommendation's current `missingEvidence`, `supportState`, `knownCause`, and prior replies.
- A diagnosis is not final while required evidence remains missing, unless a known cause is confirmed.
- TKT-1010 must support multiple rounds: vague clarification, likely diagnosis, diagnostic follow-up evidence, confirmed diagnosis.
- No auto reply may contain `available for this ticket`.

---

### Task 1: Shared Reply Module

**Files:**
- Create: `src/approval-desk/automatic-customer-replies.ts`
- Modify: `src/server.ts`
- Modify: `src/approval-desk/http.ts`
- Test: `test/server-actions.test.ts`
- Test: `test/approval-desk-http.test.ts`

**Interfaces:**
- Consumes: `Ticket`, `TriageRecommendation`, `AuditEvent`, `EvidenceRequirement`.
- Produces: `automaticReplyForTicket(input): string | undefined`.

- [ ] Add failing tests proving MCP and HTTP return natural evidence replies.
- [ ] Add the shared module with natural evidence value mapping.
- [ ] Remove duplicated generic reply functions from server and HTTP route files.
- [ ] Verify focused tests pass.

### Task 2: Progressive Replies

**Files:**
- Modify: `src/approval-desk/automatic-customer-replies.ts`
- Test: `test/approval-desk-http.test.ts`
- Test: `test/server-actions.test.ts`

**Interfaces:**
- Consumes prior customer reply count after support responses.
- Produces partial evidence first when many evidence items are missing, remaining evidence later.

- [ ] Add failing tests for TKT-1001 partial then complete evidence.
- [ ] Implement prior-reply-aware evidence slicing.
- [ ] Verify that remaining evidence reaches `missingEvidence: []` after the second reply where appropriate.

### Task 3: Diagnostic Follow-Up Replies

**Files:**
- Modify: `src/approval-desk/automatic-customer-replies.ts`
- Test: `test/approval-desk-http.test.ts`

**Interfaces:**
- Consumes likely diagnosis context from the audit trail.
- Produces TKT-1010 browser/session or frontend-loading differentiator evidence after the likely-diagnosis update is sent.

- [ ] Add failing tests for TKT-1010 automatic diagnostic follow-up.
- [ ] Implement TKT-1010 follow-up reply that confirms frontend-loading evidence when the prior diagnosis is likely.
- [ ] Verify fix remains blocked until confirmed diagnosis is recorded after the new evidence is evaluated.

### Task 4: Quality Gate

**Files:**
- Test: `test/server-actions.test.ts`
- Test: `test/approval-desk-http.test.ts`

- [ ] Add a no-generic-auto-reply assertion.
- [ ] Run focused tests.
- [ ] Run the broader test suite if focused tests pass.
