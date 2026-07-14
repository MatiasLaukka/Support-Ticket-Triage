# Classifier Evidence UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make deterministic classifier reasoning visible in the Approval Desk without adding more always-on clutter to the recommendation and approval panels.

**Architecture:** Keep the change inside the existing Approval Desk browser UI and its fake-browser tests. Add small renderer/helper functions around `classificationSignals` rather than restructuring the page, then place the full evidence card only in draft review and a compact reference in approval mode.

**Tech Stack:** TypeScript, static HTML/JS template in `src/approval-desk/ui.ts`, Vitest fake DOM harness in `test/approval-desk-ui.test.ts`, existing HTTP tests for data contract confidence.

## Global Constraints

- Show classifier reasoning without making the recommendation panel harder to present.
- Draft-stage recommendations show a compact classifier evidence block.
- Expanded view shows grouped classifier signals with readable labels and reasons.
- Approval stage stays visually compact and does not duplicate the full evidence block.
- Recommendations without stored signals render gracefully.
- Existing approval controls, GPT Assist, draft response, and audit behavior remain unchanged.
- Use a normal `<details>` disclosure for the expanded evidence.
- Keep chip labels short.
- Do not rely only on color to communicate safety or disagreement.
- Avoid dense tables; use stacked rows.
- Escape all rendered signal text.
- Do not add a separate classifier dashboard.
- Do not redesign the whole Approval Desk layout.
- Do not show every internal signal by default.
- Do not add editing controls for classifier signals.
- Do not let classifier evidence change approval behavior; it is explanatory only.

---

## File Structure

- Modify `src/approval-desk/ui.ts`
  - Add CSS classes for a compact classifier card, signal chips, grouped signal rows, and approval-stage reference.
  - Add `renderClassifierEvidenceCard(recommendation)` for draft review.
  - Add `renderClassifierEvidenceReference(recommendation)` for approval mode.
  - Add signal helper functions: `classifierSignalGroup`, `classifierSignalLabel`, `classifierSignalRank`, `renderClassifierSignalRows`, `formatSignalWeight`, and `classificationSignalCount`.
  - Add one delegated click handler for the approval-stage `Review` button.
- Modify `test/approval-desk-ui.test.ts`
  - Extend the shared `fixtureRecommendation` with representative `classificationSignals`.
  - Add draft-stage rendering assertions.
  - Add approval-stage compact reference assertions and `Review` button behavior.
  - Add legacy/no-signal rendering assertions.
- No HTTP or domain model changes are expected. The existing `TriageRecommendation` shape already carries `classificationSignals`.

---

### Task 1: Add Failing UI Tests For Classifier Evidence

**Files:**
- Modify: `test/approval-desk-ui.test.ts`

**Interfaces:**
- Consumes: existing `startApprovalDeskApp`, `fixtureRecommendation`, fake DOM harness, and `approvalDeskHtml`.
- Produces: failing expectations for `Classifier evidence`, `Why this classification?`, grouped signals, approval compact reference, and legacy empty state.

- [ ] **Step 1: Extend the recommendation fixture with representative signals**

In `test/approval-desk-ui.test.ts`, add `classificationSignals` to `fixtureRecommendation` after `confidence: 0.87,`:

```ts
  classificationSignals: [
    {
      ruleId: "category-authentication",
      target: "category:authentication",
      weight: 0.55,
      reason: "Ticket text mentions login and account access failures.",
    },
    {
      ruleId: "metadata-priority",
      target: "metadata:priority:P3",
      weight: 0.15,
      reason: "Customer submitted the ticket as normal priority.",
    },
    {
      ruleId: "risk-security",
      target: "risk:security:possible",
      weight: 0.4,
      reason: "<script>Security-sensitive account access language was detected.</script>",
    },
    {
      ruleId: "knowledge-account-access",
      target: "knowledge:account-access-reset",
      weight: 0.3,
      reason: "Account access reset documentation matches the reported symptoms.",
    },
    {
      ruleId: "known-cause-login-session-expiry",
      target: "knownCause:login-session-expiry",
      weight: 0.5,
      reason: "Known login session expiry symptoms match the ticket.",
    },
    {
      ruleId: "metadata-disagreement-priority",
      target: "disagreement:priority",
      weight: 0.35,
      reason: "Submitted priority was lower than the detected account access risk.",
    },
  ],
```

- [ ] **Step 2: Add a draft-stage rendering test**

Add this test after `renders escaped recommendation review evidence` or near the existing draft review tests:

```ts
  it("shows compact classifier evidence with grouped escaped signal details", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();

    const html = app.el("recommendationPanel").innerHTML;
    expect(html).toContain("Classifier evidence");
    expect(html).toContain("Category: authentication");
    expect(html).toContain("Priority: P2");
    expect(html).toContain("Team: identity");
    expect(html).toContain("Confidence: 0.87");
    expect(html).toContain("Why this classification?");
    expect(html).toContain("Safety signal");
    expect(html).toContain("Known cause");
    expect(html).toContain("Submitted metadata");
    expect(html).toContain("Customer text");
    expect(html).toContain("Safety rules");
    expect(html).toContain("Other supporting rules");
    expect(html).toContain("category-authentication");
    expect(html).toContain("metadata-priority");
    expect(html).toContain("&lt;script&gt;Security-sensitive account access language was detected.&lt;/script&gt;");
    expect(html).not.toContain("<script>Security-sensitive");
    expect(html.indexOf("Recommended Triage")).toBeLessThan(
      html.indexOf("Classifier evidence"),
    );
    expect(html.indexOf("Classifier evidence")).toBeLessThan(
      html.indexOf("Draft Customer Response"),
    );
    expect(html.indexOf("Classifier evidence")).toBeLessThan(
      html.indexOf("GPT Assist"),
    );
  });
```

- [ ] **Step 3: Add approval-stage compact reference test**

Extend the existing `shows draft review before revealing approval controls` test after `app.el("continueApproval").dispatch("click");`:

```ts
    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Classification evidence available - 6 signals",
    );
    expect(app.el("recommendationPanel").innerHTML).toContain(
      "data-action=\"review-classifier-evidence\"",
    );
    expect(app.el("recommendationPanel").innerHTML).not.toContain(
      "Why this classification?",
    );

    app.el("recommendationPanel").dispatch("click", {
      target: { dataset: { action: "review-classifier-evidence" } },
    });

    expect(app.el("approvalStage").hidden).toBe(true);
    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Why this classification?",
    );

    app.el("continueApproval").dispatch("click");
```

This returns the test to approval mode before the existing `backToRecommendation` assertions run.

- [ ] **Step 4: Add legacy/no-signal graceful state test**

Add this test near the new classifier evidence test:

```ts
  it("renders a graceful classifier evidence fallback for legacy recommendations", async () => {
    const app = await startApprovalDeskApp({
      recommendation: {
        ...fixtureRecommendation,
        classificationSignals: undefined,
      },
    });
    await app.selectFirstTicket();
    await app.createRecommendation();

    const html = app.el("recommendationPanel").innerHTML;
    expect(html).toContain("Classifier evidence");
    expect(html).toContain("Category: authentication");
    expect(html).toContain("No classifier signal snapshot stored for this recommendation.");
    expect(html).not.toContain("Why this classification?");
  });
```

- [ ] **Step 5: Run the focused test and verify it fails for the intended reason**

Run:

```powershell
npm test -- --run test/approval-desk-ui.test.ts
```

Expected: FAIL with missing `Classifier evidence`, `Why this classification?`, or `Classification evidence available - 6 signals`. If it fails because the fake DOM `dispatch` signature does not accept the second argument, adapt Step 3 to call the new button handler through an existing fake DOM event shape before implementation.

- [ ] **Step 6: Commit the failing tests**

```powershell
git add -- test/approval-desk-ui.test.ts
git commit -m "test: cover classifier evidence ui"
```

---

### Task 2: Implement Draft-Stage Classifier Evidence Card

**Files:**
- Modify: `src/approval-desk/ui.ts`

**Interfaces:**
- Consumes: `recommendation.classificationSignals?: Array<{ ruleId: string; target: string; weight: number; reason: string }>` plus existing `category`, `priority`, `team`, and `confidence`.
- Produces:
  - `renderClassifierEvidenceCard(recommendation): string`
  - `classificationSignalCount(recommendation): number`
  - helper functions used by Task 3.

- [ ] **Step 1: Add CSS for compact evidence presentation**

In `src/approval-desk/ui.ts`, add this CSS after the existing `.chip` block:

```css
      .classifier-card {
        background: #f8fbff;
      }

      .classifier-card .chips {
        margin-bottom: 0.35rem;
      }

      .classifier-summary {
        display: grid;
        gap: 0.45rem;
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        margin-bottom: 0.65rem;
      }

      .classifier-signal-group {
        border-top: 1px solid var(--line);
        margin-top: 0.75rem;
        padding-top: 0.75rem;
      }

      .classifier-signal-group h4 {
        font-size: 0.92rem;
        margin: 0 0 0.45rem;
      }

      .classifier-signal-row {
        background: white;
        border: 1px solid var(--line);
        border-radius: 12px;
        display: grid;
        gap: 0.3rem;
        margin-top: 0.45rem;
        padding: 0.65rem;
      }

      .classifier-signal-row code {
        color: var(--muted);
        font-size: 0.8rem;
        white-space: pre-wrap;
        word-break: break-word;
      }
```

- [ ] **Step 2: Reorder the draft recommendation panel**

In `renderRecommendation()`, replace the draft-stage string assembly inside the final `else` branch with this ordering. Keep all existing content, but move it into this sequence:

```js
          els.recommendationPanel.innerHTML =
            '<div class="hero-card"><strong>Recommended Triage</strong>' +
              '<div class="chips">' +
                chip('Category: ' + recommendation.category) +
                chip('Priority: ' + recommendation.priority) +
                chip('Team: ' + recommendation.team) +
                chip('Risk: ' + (recommendation.escalationRequired ? 'escalation' : 'none')) +
              '</div>' +
            '</div>' +
            renderClassifierEvidenceCard(recommendation) +
            '<div class="hero-card description"><strong>Draft Customer Response</strong>' + escapeHtml(recommendation.draftCustomerResponse) + '</div>' +
            '<p class="hint">Continue to approval when the draft looks ready.</p>' +
            '<details><summary>Why this draft is safe</summary>' +
              '<div class="chips">' +
                chip('Source: ' + (recommendation.draftCustomerResponseSource ?? 'legacy')) +
                chip('Style: ' + (recommendation.draftCustomerResponseStyle ?? 'balanced')) +
                chip('Checks: ' + formatDraftCheckSummary(recommendation.draftCustomerResponseChecks)) +
                chip('Human approval: pending') +
              '</div>' +
              '<p>' + escapeHtml(formatDraftSafetyNarrative(recommendation)) + '</p>' +
              '<p class="meta"><strong>Retrieved context</strong> ' + escapeHtml(formatList(recommendation.knowledgeArticleIds)) + '</p>' +
              '<p class="meta"><strong>Human approval</strong> Reviewer must approve or edit before use.</p>' +
            '</details>' +
            renderGptAssistCard(recommendation.gptAssist) +
            '<details><summary>Evidence and internal details</summary>' +
              '<div class="details-grid">' +
                card('Recommendation ID', recommendation.id) +
                card('Source revision', String(recommendation.sourceRevision)) +
                card('Confidence', String(recommendation.confidence)) +
                card('knowledgeArticleIds', formatList(recommendation.knowledgeArticleIds)) +
                card('Outage risk', recommendation.outageRisk) +
                card('Security risk', recommendation.securityRisk) +
                card('SLA risk', recommendation.slaRisk) +
                card('Support state', recommendation.supportState ?? 'not assessed') +
                card('Known cause', recommendation.knownCause ?? 'none') +
                card('Escalation required', recommendation.escalationRequired ? 'yes' : 'no') +
                card('Escalation reasons', formatList(recommendation.escalationReasons)) +
                card('Missing information', formatList(recommendation.missingInformation)) +
                card('Missing evidence', formatEvidenceLabels(recommendation.missingEvidence)) +
                card('Provided evidence', formatEvidenceLabels(recommendation.providedEvidence)) +
              '</div>' +
              '<div class="card description"><strong>Rationale</strong>' + escapeHtml(recommendation.rationale) + '</div>' +
              '<div class="card description"><strong>Duplicate candidates</strong>' + escapeHtml(formatDuplicateCandidates(recommendation.duplicateCandidates)) + '</div>' +
              '<div class="card description"><strong>Next action</strong>' + escapeHtml(recommendation.recommendedNextAction) + '</div>' +
              '<div class="card description"><strong>Draft validation checks</strong>' + escapeHtml(formatDraftChecks(recommendation.draftCustomerResponseChecks)) + '</div>' +
            '</details>' +
            '<details><summary>All proposed ticket values</summary>' +
              '<div class="details-grid">' +
              card('Category', recommendation.category) +
              card('Priority', recommendation.priority) +
              card('Team', recommendation.team) +
              card('Assignee', recommendation.assignee === undefined ? 'unchanged' : String(recommendation.assignee)) +
              card('Status', recommendation.ticketStatus ?? 'unchanged') +
              card('Tags', Array.isArray(recommendation.tags) ? recommendation.tags.join(', ') : 'unchanged') +
              '</div>' +
            '</details>';
```

This satisfies the placement rule: proposed field summary, classifier evidence, draft response, then GPT Assist.

- [ ] **Step 3: Add classifier evidence helper functions**

Add these functions after `chip(value)` and before `formatList(values)`:

```js
      function renderClassifierEvidenceCard(recommendation) {
        const signals = Array.isArray(recommendation.classificationSignals)
          ? recommendation.classificationSignals
          : [];
        const summary =
          '<div class="classifier-summary">' +
            card('Category', recommendation.category) +
            card('Priority', recommendation.priority) +
            card('Team', recommendation.team) +
            card('Confidence', String(recommendation.confidence)) +
          '</div>';
        if (signals.length === 0) {
          return '<div class="hero-card classifier-card"><strong>Classifier evidence</strong>' +
            summary +
            '<p class="hint">No classifier signal snapshot stored for this recommendation.</p>' +
          '</div>';
        }
        const topChips = signals
          .slice()
          .sort(function (left, right) {
            return classifierSignalRank(right) - classifierSignalRank(left);
          })
          .slice(0, 3)
          .map(function (signal) {
            return chip(classifierSignalLabel(signal));
          })
          .join('');
        return '<div class="hero-card classifier-card"><strong>Classifier evidence</strong>' +
          summary +
          '<div class="chips">' + topChips + '</div>' +
          '<details><summary>Why this classification?</summary>' +
            renderClassifierSignalRows(signals) +
          '</details>' +
        '</div>';
      }

      function classificationSignalCount(recommendation) {
        return Array.isArray(recommendation.classificationSignals)
          ? recommendation.classificationSignals.length
          : 0;
      }

      function renderClassifierSignalRows(signals) {
        const groups = [
          ['Customer text', signals.filter(function (signal) { return classifierSignalGroup(signal) === 'Customer text'; })],
          ['Submitted metadata', signals.filter(function (signal) { return classifierSignalGroup(signal) === 'Submitted metadata'; })],
          ['Safety rules', signals.filter(function (signal) { return classifierSignalGroup(signal) === 'Safety rules'; })],
          ['Known cause', signals.filter(function (signal) { return classifierSignalGroup(signal) === 'Known cause'; })],
          ['Other supporting rules', signals.filter(function (signal) { return classifierSignalGroup(signal) === 'Other supporting rules'; })]
        ];
        return groups
          .filter(function (entry) { return entry[1].length > 0; })
          .map(function (entry) {
            return '<section class="classifier-signal-group"><h4>' + escapeHtml(entry[0]) + '</h4>' +
              entry[1].map(renderClassifierSignalRow).join('') +
            '</section>';
          })
          .join('');
      }

      function renderClassifierSignalRow(signal) {
        return '<div class="classifier-signal-row">' +
          '<strong>' + escapeHtml(classifierSignalLabel(signal)) + ' · weight ' + escapeHtml(formatSignalWeight(signal.weight)) + '</strong>' +
          '<span>' + escapeHtml(signal.reason ?? 'No reason recorded.') + '</span>' +
          '<code>' + escapeHtml((signal.ruleId ?? 'unknown-rule') + ' -> ' + (signal.target ?? 'unknown-target')) + '</code>' +
        '</div>';
      }

      function classifierSignalGroup(signal) {
        const target = String(signal.target ?? '');
        const ruleId = String(signal.ruleId ?? '');
        if (target.startsWith('metadata:') || ruleId.startsWith('metadata-')) {
          return 'Submitted metadata';
        }
        if (target.startsWith('risk:') || target.startsWith('escalation:') || ruleId.startsWith('risk-') || ruleId.startsWith('escalation-')) {
          return 'Safety rules';
        }
        if (target.startsWith('knownCause:') || ruleId.startsWith('known-cause-')) {
          return 'Known cause';
        }
        if (target.startsWith('category:') || target.startsWith('team:') || target.startsWith('priority:')) {
          return 'Customer text';
        }
        return 'Other supporting rules';
      }

      function classifierSignalLabel(signal) {
        const target = String(signal.target ?? '');
        if (target.startsWith('risk:') || target.startsWith('escalation:')) {
          return 'Safety signal';
        }
        if (target.startsWith('knownCause:')) {
          return 'Known cause';
        }
        if (target.startsWith('disagreement:')) {
          return 'Metadata disagreement';
        }
        if (target.startsWith('metadata:')) {
          return 'Submitted metadata';
        }
        if (target.startsWith('category:')) {
          return 'Category reason';
        }
        if (target.startsWith('priority:')) {
          return 'Priority reason';
        }
        if (target.startsWith('team:')) {
          return 'Team reason';
        }
        if (target.startsWith('knowledge:')) {
          return 'Knowledge context';
        }
        return 'Supporting signal';
      }

      function classifierSignalRank(signal) {
        const target = String(signal.target ?? '');
        const base = Number(signal.weight ?? 0);
        if (target.startsWith('risk:') || target.startsWith('escalation:')) {
          return base + 10;
        }
        if (target.startsWith('knownCause:')) {
          return base + 8;
        }
        if (target.startsWith('category:') || target.startsWith('team:') || target.startsWith('priority:')) {
          return base + 5;
        }
        if (target.startsWith('disagreement:')) {
          return base + 4;
        }
        if (target.startsWith('metadata:')) {
          return base - 2;
        }
        return base;
      }

      function formatSignalWeight(value) {
        return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '0.00';
      }
```

- [ ] **Step 4: Run the focused UI test**

Run:

```powershell
npm test -- --run test/approval-desk-ui.test.ts
```

Expected: the draft-stage and legacy tests pass. The approval-stage compact reference assertions may still fail until Task 3.

- [ ] **Step 5: Commit the draft evidence card**

```powershell
git add -- src/approval-desk/ui.ts test/approval-desk-ui.test.ts
git commit -m "feat: show classifier evidence in draft review"
```

---

### Task 3: Add Approval-Stage Compact Reference And Review Action

**Files:**
- Modify: `src/approval-desk/ui.ts`
- Modify: `test/approval-desk-ui.test.ts`

**Interfaces:**
- Consumes: `classificationSignalCount(recommendation)` from Task 2.
- Produces: `renderClassifierEvidenceReference(recommendation): string` and a delegated `review-classifier-evidence` click action.

- [ ] **Step 1: Add compact approval reference CSS**

In `src/approval-desk/ui.ts`, add this CSS after `.stage-actions`:

```css
      .classifier-reference {
        align-items: center;
        background: var(--panel-soft);
        border: 1px solid var(--line);
        border-radius: 12px;
        display: flex;
        gap: 0.65rem;
        justify-content: space-between;
        margin-top: 0.75rem;
        padding: 0.65rem 0.75rem;
      }

      .inline-review-button {
        padding: 0.45rem 0.7rem;
        white-space: nowrap;
      }
```

- [ ] **Step 2: Render the compact reference in approval mode**

In the `state.stage === 'approval'` branch of `renderRecommendation()`, append `renderClassifierEvidenceReference(recommendation)` inside the hero card after the chips:

```js
              '<div class="chips">' +
                chip('Category: ' + recommendation.category) +
                chip('Priority: ' + recommendation.priority) +
                chip('Team: ' + recommendation.team) +
                chip('Status: ' + (recommendation.ticketStatus ?? 'unchanged')) +
              '</div>' +
              renderClassifierEvidenceReference(recommendation) +
            '</div>';
```

Add this helper after `renderClassifierEvidenceCard(recommendation)`:

```js
      function renderClassifierEvidenceReference(recommendation) {
        const count = classificationSignalCount(recommendation);
        const label = count === 1
          ? 'Classification evidence available - 1 signal'
          : 'Classification evidence available - ' + count + ' signals';
        return '<div class="classifier-reference">' +
          '<span>' + escapeHtml(label) + '</span>' +
          '<button type="button" class="inline-review-button" data-action="review-classifier-evidence">Review</button>' +
        '</div>';
      }
```

- [ ] **Step 3: Add delegated click handler for the Review button**

After the existing `els.continueApproval.addEventListener(...)` block, add:

```js
      els.recommendationPanel.addEventListener('click', function (event) {
        if (event.target?.dataset?.action === 'review-classifier-evidence' && state.recommendation !== null) {
          state.stage = 'draft';
          renderRecommendation();
        }
      });
```

- [ ] **Step 4: Adjust the fake DOM dispatch helper if needed**

If Task 1 showed the fake DOM cannot pass an event object to listeners, update the `FakeElement.dispatch` method in `test/approval-desk-ui.test.ts` to accept an optional event object:

```ts
  dispatch(type: string, event: Record<string, unknown> = {}) {
    for (const listener of this.listeners[type] ?? []) {
      listener({
        target: this,
        ...event,
      });
    }
  }
```

Expected behavior: existing calls such as `dispatch("click")` keep working; the new test can pass `{ target: { dataset: { action: "review-classifier-evidence" } } }`.

- [ ] **Step 5: Run the focused UI test**

Run:

```powershell
npm test -- --run test/approval-desk-ui.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the approval compact reference**

```powershell
git add -- src/approval-desk/ui.ts test/approval-desk-ui.test.ts
git commit -m "feat: add approval classifier evidence reference"
```

---

### Task 4: Full Verification And Cleanup

**Files:**
- Modify only if verification exposes a real issue:
  - `src/approval-desk/ui.ts`
  - `test/approval-desk-ui.test.ts`

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: passing focused and full test suite, no accidental scratch files staged.

- [ ] **Step 1: Run focused UI tests**

```powershell
npm test -- --run test/approval-desk-ui.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run HTTP regression tests around recommendation data**

```powershell
npm test -- --run test/approval-desk-http.test.ts
```

Expected: PASS. This confirms the UI-only change did not need API contract changes and that `classificationSignals` still survives recommendation creation/detail paths.

- [ ] **Step 3: Run the full suite**

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 4: Inspect local changes**

```powershell
git status --short
```

Expected: only intentional tracked changes are committed. Existing untracked `.superpowers/sdd/*` scratch files may remain untracked and must not be staged.

- [ ] **Step 5: If verification required fixes, commit them**

Only run this if Step 1, 2, or 3 required code/test edits:

```powershell
git add -- src/approval-desk/ui.ts test/approval-desk-ui.test.ts
git commit -m "fix: polish classifier evidence ui"
```

---

## Self-Review

**Spec coverage:** The plan maps each design requirement to a task: compact draft card in Task 2, grouped `<details>` view in Task 2, approval compact reference in Task 3, legacy/no-signal fallback in Task 1 and Task 2, escaping in Task 1 assertions and Task 2 helpers, no approval behavior changes by keeping classifier evidence explanatory only.

**Placeholder scan:** The plan intentionally avoids deferred placeholders. Every code-changing step includes concrete snippets, exact files, exact commands, and expected outcomes.

**Type consistency:** The planned helpers all consume the existing recommendation object and `classificationSignals` shape already used by the backend. Function names are consistent across tasks: `renderClassifierEvidenceCard`, `renderClassifierEvidenceReference`, and `classificationSignalCount`.
