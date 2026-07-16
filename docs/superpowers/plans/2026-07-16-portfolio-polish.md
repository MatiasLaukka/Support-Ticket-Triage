# Portfolio Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the repository for portfolio review by updating public documentation, adding screenshots, and verifying the current local demo behavior.

**Architecture:** Keep the product code stable unless verification reveals a real bug. Treat README and public docs as the main surface, and generate screenshots from the local Approval Desk with synthetic data only.

**Tech Stack:** TypeScript, Node.js, PowerShell, Vitest, local Approval Desk UI, Markdown documentation.

## Global Constraints

- Do not use real customer data or secrets.
- Do not make production claims from synthetic fixture metrics.
- Keep GPT advisory classification described as bounded and auditable.
- Preserve deterministic safety, routing, approval, and audit boundaries.
- Do not add a live external support integration.

---

### Task 1: Repository Hygiene

**Files:**
- Modify: `.gitignore`

**Steps:**
- [ ] Add local Approval Desk logs and `.superpowers/sdd/` to `.gitignore`.
- [ ] Confirm `git status --short` no longer shows generated log and SDD artifacts.

### Task 2: Documentation Refresh

**Files:**
- Modify: `README.md`
- Modify: `docs/case-study.md`
- Modify: `docs/demo-results.md`
- Modify: `docs/demo-script.md`
- Modify: `docs/capture-guide.md`
- Modify: `docs/roadmap.md`

**Steps:**
- [ ] Update architecture text so GPT drafting and GPT advisory classification are both described accurately.
- [ ] Add a short reviewer/demo path near the top of the README.
- [ ] Add conversation workspace and TKT-1010 evolving-ticket scenario descriptions.
- [ ] Keep all metric language clearly tied to synthetic fixtures.
- [ ] Remove or update stale wording that says GPT only drafts.

### Task 3: Screenshots

**Files:**
- Create: `docs/assets/approval-desk-overview.png`
- Create: `docs/assets/approval-desk-conversation.png`
- Create: `docs/assets/approval-desk-recommendation.png`

**Steps:**
- [ ] Run the built Approval Desk against a temporary data root.
- [ ] Capture synthetic, local-only screenshots of the evidence dashboard, conversation workspace, and recommendation panel.
- [ ] Link the screenshots from the README.

### Task 4: Verification

**Commands:**
- `npm test`
- local smoke check for TKT-1010 with a campaign-editor reply

**Steps:**
- [ ] Run the full test suite.
- [ ] Run a local smoke check that adds a TKT-1010 customer reply and creates a recommendation.
- [ ] Commit the finished polish pass.
