# Context-Inferred Ticket Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Approval Desk demo add synthetic customer replies while the backend infers lifecycle state from ticket and reply content, then show that inference compactly in the UI.

**Architecture:** Reuse the existing `customerReplies` path in `recommendation-builder.ts` and expose it through the Approval Desk HTTP/UI layer. Keep synthetic replies in browser state only, send them with recommendation creation, and render lifecycle evidence as a compact summary plus collapsible details.

**Tech Stack:** TypeScript, Zod, Node HTTP server, static Approval Desk HTML/JS in `src/approval-desk/ui.ts`, Vitest backend and fake-browser UI tests.

## Global Constraints

- Lifecycle state must be inferred from context, not from the order of demo actions.
- Scenario controls may add synthetic customer replies, but they must not set `supportState` directly.
- A first ticket or first reply can still be inferred as `known-cause`, `waiting-on-platform-fix`, `ready-for-close`, `diagnosing`, `needs-information`, or `information-received` depending on the evidence and language present.
- Keep the Conversation Context section visually compact.
- By default Conversation Context should show a short summary such as the number of replies currently attached and the most recent reply preview.
- The full reply list and scenario controls should be tucked into a disclosure or similarly lightweight panel.
- The ticket subject, description, draft response, classifier evidence, and lifecycle summary remain the main presentation elements.
- Lifecycle evidence is explanatory only and must not bypass human approval.
- Do not build a full manual conversation editor yet.
- Do not persist synthetic replies to disk in this phase.
- Do not let demo controls set `supportState` directly.
- Do not remove existing approval/audit safeguards.
- Do not add a separate lifecycle dashboard.
- Existing classifier evidence, approval controls, GPT Assist, and audit behavior continue to work.

---

## File Structure

- Modify `src/approval-desk/http.ts`
  - Extend recommendation creation body to accept `customerReplies`.
  - Map UI reply input to the existing builder `CustomerReply` shape with the endpoint ticket ID.
  - Pass mapped replies into both deterministic and GPT-assisted recommendation building.
- Modify `src/approval-desk/recommendation-builder.ts`
  - Tighten lifecycle inference where the existing logic is too sequence-like.
  - Keep existing `supportState`, `knownCause`, `providedEvidence`, `missingEvidence`, and draft behavior as the public interface.
- Modify `src/approval-desk/ui.ts`
  - Add compact Conversation Context state and rendering.
  - Add synthetic reply scenario buttons that append text only.
  - Send current replies with recommendation creation.
  - Add compact lifecycle summary in recommendation draft view.
- Modify tests:
  - `test/approval-desk-recommendation.test.ts` for lifecycle inference from content.
  - `test/approval-desk-http.test.ts` for request body passthrough.
  - `test/approval-desk-ui.test.ts` for compact UI and POST payload behavior.

---

### Task 1: HTTP Reply Passthrough

**Files:**
- Modify: `src/approval-desk/http.ts`
- Test: `test/approval-desk-http.test.ts`

**Interfaces:**
- Consumes: `buildApprovalDeskRecommendationInputWithDrafting({ customerReplies })`.
- Produces: HTTP request body field:

```ts
customerReplies?: Array<{
  id: string;
  createdAt: string;
  body: string;
}>
```

The HTTP route maps each item to `{ id, ticketId, createdAt, body }`.

- [ ] **Step 1: Write failing HTTP test for customer reply passthrough**

Add this test in `test/approval-desk-http.test.ts` near recommendation creation tests:

```ts
  it("passes customer reply context into lifecycle-aware recommendation creation", async () => {
    const { json } = await startFixture();

    const created = await json("/api/tickets/TKT-1008/recommendations", {
      method: "POST",
      body: JSON.stringify({
        actor: "approval-desk",
        customerReplies: [
          {
            id: "demo-reply-1",
            createdAt: "2026-06-10T09:05:00.000Z",
            body:
              "Endpoint URL is https://hooks.juniper.example/webhooks/orders and delivery ID is deliv_7788.",
          },
        ],
      }),
    });

    expect(created.status).toBe(201);
    expect(created.body.recommendation).toMatchObject({
      ticketId: "TKT-1008",
      supportState: "information-received",
    });
    expect(created.body.recommendation.providedEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "endpoint-url" }),
        expect.objectContaining({ id: "delivery-id" }),
      ]),
    );
    expect(created.body.recommendation.missingEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "raw-body-change-status" }),
      ]),
    );
  });
```

- [ ] **Step 2: Run the focused HTTP test and verify it fails**

Run:

```powershell
npm test -- --run test/approval-desk-http.test.ts
```

Expected: FAIL because `SubmitBodySchema` rejects `customerReplies`.

- [ ] **Step 3: Extend the submit body schema**

In `src/approval-desk/http.ts`, add a schema before `SubmitBodySchema`:

```ts
const CustomerReplyBodySchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    createdAt: z.iso.datetime(),
    body: z.string().trim().min(1).max(4_000),
  })
  .strict();
```

Then extend `SubmitBodySchema`:

```ts
const SubmitBodySchema = z
  .object({
    actor: z.string().trim().min(1).default("approval-desk"),
    responseStyle: DraftCustomerResponseStyleInputSchema.default("auto"),
    customerReplies: z.array(CustomerReplyBodySchema).max(8).default([]),
  })
  .strict();
```

- [ ] **Step 4: Pass replies into recommendation builders**

In `createRecommendation`, after loading `ticket`, add:

```ts
  const customerReplies = body.customerReplies.map((reply) => ({
    ...reply,
    ticketId,
  }));
```

Pass `customerReplies` to both builder calls:

```ts
  const deterministicInput = buildApprovalDeskRecommendationInput({
    ticket,
    outcome,
    actor: body.actor,
    customerReplies,
  });
```

and:

```ts
  const input = await buildApprovalDeskRecommendationInputWithDrafting({
    ticket,
    outcome,
    actor: body.actor,
    knowledgeArticles,
    responseStyle: body.responseStyle,
    customerReplies,
    draftProvider:
      options.draftProvider ??
      createCustomerResponseDraftProviderFromEnv(process.env, {
        responseStyle: body.responseStyle,
      }),
  });
```

- [ ] **Step 5: Run focused HTTP test**

Run:

```powershell
npm test -- --run test/approval-desk-http.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- src/approval-desk/http.ts test/approval-desk-http.test.ts
git commit -m "feat: pass conversation context to recommendations"
```

---

### Task 2: Content-Based Lifecycle Inference Tests

**Files:**
- Modify: `src/approval-desk/recommendation-builder.ts`
- Test: `test/approval-desk-recommendation.test.ts`

**Interfaces:**
- Consumes: existing `buildApprovalDeskRecommendationInput({ customerReplies })`.
- Produces: stronger lifecycle inference behavior without adding new public fields.

- [ ] **Step 1: Add tests proving state is content-based, not sequence-based**

Add this test block in `test/approval-desk-recommendation.test.ts` near the existing customer follow-up lifecycle tests:

```ts
  it("infers lifecycle state from reply content rather than reply order", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1008");
    const outcome = outcomes.get("TKT-1008")!;

    const completeKnownCauseFirst = buildApprovalDeskRecommendationInput({
      ticket,
      outcome,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-complete-known-cause",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:05:00.000Z",
          body:
            "Endpoint URL is https://hooks.juniper.example/webhooks/orders. Delivery ID is deliv_7788. Raw body handling has not changed since yesterday.",
        },
      ],
    });

    expect(completeKnownCauseFirst.supportState).toBe("known-cause");
    expect(completeKnownCauseFirst.missingEvidence).toEqual([]);
    expect(completeKnownCauseFirst.draftCustomerResponse).toContain(
      "current signing secret",
    );

    const resolvedAsFirstReply = buildApprovalDeskRecommendationInput({
      ticket,
      outcome,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-resolved",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:05:00.000Z",
          body: "This works now. The issue is resolved on our end.",
        },
      ],
    });

    expect(resolvedAsFirstReply.supportState).toBe("ready-for-close");
    expect(resolvedAsFirstReply.draftCustomerResponse).toContain(
      "Glad to hear that resolved it.",
    );

    const negatedKnownCause = buildApprovalDeskRecommendationInput({
      ticket,
      outcome,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-ruled-out",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:05:00.000Z",
          body:
            "We ruled out signing secret rotation. Endpoint URL is https://hooks.juniper.example/webhooks/orders and delivery ID is deliv_7788.",
        },
      ],
    });

    expect(negatedKnownCause.knownCause).not.toBe("webhook-secret-rotation");
  });
```

- [ ] **Step 2: Add platform-fix first-context test**

Add:

```ts
  it("can infer waiting-on-platform-fix from first context when impact is platform-side", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1001");
    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: outcomes.get("TKT-1001")!,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-platform-impact",
          ticketId: "TKT-1001",
          createdAt: "2026-06-10T09:05:00.000Z",
          body:
            "This is affecting all EU stores and recent Checkout Started events are delayed even though the API accepted them.",
        },
      ],
    });

    expect(input.supportState).toBe("waiting-on-platform-fix");
    expect(input.draftCustomerResponse).toContain(
      "possible platform delay affecting event processing",
    );
  });
```

- [ ] **Step 3: Run focused test and inspect failures**

Run:

```powershell
npm test -- --run test/approval-desk-recommendation.test.ts
```

Expected: one or more failures where current inference still treats known cause too eagerly or lacks platform-impact handling from reply context.

- [ ] **Step 4: Adjust lifecycle inference minimally**

In `analyzeCustomerReplyLifecycle`, keep the existing overall structure but ensure it respects final inferred evidence readiness after replies. If the current tests fail only on known-cause negation, fix known-cause detection in `known-cause-catalog.ts` for the relevant negation phrase rather than overriding `knownCause` in the builder.

If platform-impact first context fails because `analyzeEvidenceReadiness` already returns `waiting-on-platform-fix` only from outcome escalation, do not add UI-driven state. Instead add a small helper in `recommendation-builder.ts`:

```ts
function hasPlatformFixContext(value: string): boolean {
  return /\b(?:all|multiple|many)\b.{0,40}\b(?:stores|accounts|profiles|customers)\b/i.test(value) &&
    /\b(?:delayed|delay|missing|not showing|not processing)\b/i.test(value) &&
    /\b(?:api accepted|accepted by the api|platform|incident|processing)\b/i.test(value);
}
```

Then, after `isCustomerConfirmation(latestReply)` and before `requiresMoreCustomerEvidence`, add:

```ts
  if (hasPlatformFixContext(replyText)) {
    return {
      evidenceReadiness: withLifecycleSupportState(
        evidenceReadiness,
        "waiting-on-platform-fix",
      ),
      replyStage: "all-evidence",
    };
  }
```

Do not use scenario button names or reply IDs in this logic.

- [ ] **Step 5: Run focused recommendation tests**

Run:

```powershell
npm test -- --run test/approval-desk-recommendation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- src/approval-desk/recommendation-builder.ts src/approval-desk/known-cause-catalog.ts test/approval-desk-recommendation.test.ts
git commit -m "test: prove lifecycle state comes from context"
```

Only include `known-cause-catalog.ts` if Step 4 required changing it.

---

### Task 3: Compact Conversation Context UI

**Files:**
- Modify: `src/approval-desk/ui.ts`
- Test: `test/approval-desk-ui.test.ts`

**Interfaces:**
- Consumes: current selected ticket and browser-only reply state.
- Produces:
  - `state.customerRepliesByTicketId: Record<string, Array<{ id: string; createdAt: string; body: string }>>`
  - `renderConversationContext(): void`
  - POST body field `customerReplies`.

- [ ] **Step 1: Add failing static/control tests**

In `test/approval-desk-ui.test.ts`, extend the existing static HTML test with:

```ts
    expect(approvalDeskHtml).toContain("Conversation Context");
    expect(approvalDeskHtml).toContain("conversationContextPanel");
    expect(approvalDeskHtml).toContain("Add partial evidence");
    expect(approvalDeskHtml).toContain("Clear replies");
```

- [ ] **Step 2: Add UI behavior test for compact context and POST payload**

Add:

```ts
  it("keeps conversation context compact and sends replies with recommendation creation", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();

    expect(app.el("conversationContextPanel").innerHTML).toContain(
      "No customer replies added.",
    );
    expect(app.el("conversationContextPanel").innerHTML).toContain("<details");

    app.clickConversationScenario("partial-evidence");

    const contextHtml = app.el("conversationContextPanel").innerHTML;
    expect(contextHtml).toContain("1 reply attached");
    expect(contextHtml).toContain("Latest:");
    expect(contextHtml).toContain("Add complete evidence");
    expect(contextHtml).not.toContain("Detected lifecycle state");

    await app.createRecommendation();

    const recommendationRequest = app.requests.find((request) =>
      request.path.endsWith("/recommendations"),
    );
    expect(JSON.parse(String(recommendationRequest?.init?.body))).toMatchObject({
      customerReplies: [
        expect.objectContaining({
          id: expect.stringMatching(/^demo-reply-/),
          body: expect.stringContaining("endpoint URL"),
        }),
      ],
    });
  });
```

Extend the fake app return object with:

```ts
    clickConversationScenario: (value: string) => {
      elements.conversationContextPanel.children
        .find((button) => button.value === value)!
        .dispatch("click");
    },
```

Add `conversationContextPanel` to `createElements()`.

- [ ] **Step 3: Run focused UI test and verify failure**

Run:

```powershell
npm test -- --run test/approval-desk-ui.test.ts
```

Expected: FAIL because the panel and controls do not exist.

- [ ] **Step 4: Add compact HTML panel**

In `src/approval-desk/ui.ts`, add this after the Developer/audit output `details` and before Recommendation setup:

```html
          <section class="card conversation-context" aria-label="Conversation Context">
            <h3>Conversation Context</h3>
            <div id="conversationContextPanel">
              <p class="hint">Select a ticket to add customer reply context.</p>
            </div>
          </section>
```

Add `conversationContextPanel` to `els`.

- [ ] **Step 5: Add compact CSS**

Add CSS near the setup/card styles:

```css
      .conversation-context details {
        margin-top: 0.55rem;
      }

      .conversation-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        margin: 0.65rem 0;
      }

      .conversation-controls button {
        padding: 0.45rem 0.65rem;
      }

      .reply-preview {
        color: var(--muted);
        font-size: 0.88rem;
        line-height: 1.4;
      }
```

- [ ] **Step 6: Add browser state and render helpers**

Extend `state`:

```js
        customerRepliesByTicketId: {}
```

Add helpers near `renderTicket()`:

```js
      function currentCustomerReplies() {
        if (state.selectedTicket === null) {
          return [];
        }
        return state.customerRepliesByTicketId[state.selectedTicket.id] ?? [];
      }

      function renderConversationContext() {
        if (state.selectedTicket === null) {
          els.conversationContextPanel.innerHTML = '<p class="hint">Select a ticket to add customer reply context.</p>';
          return;
        }
        const replies = currentCustomerReplies();
        const latest = replies[replies.length - 1];
        const summary = replies.length === 0
          ? 'No customer replies added.'
          : replies.length + ' reply' + (replies.length === 1 ? '' : 'ies') + ' attached. Latest: ' + previewText(latest.body);
        els.conversationContextPanel.innerHTML =
          '<p class="hint">' + escapeHtml(summary) + '</p>' +
          '<details><summary>Add or review synthetic replies</summary>' +
            '<p class="hint">These buttons add customer-message context only. The backend still infers lifecycle state from the text.</p>' +
            '<div class="conversation-controls">' +
              scenarioButton('vague-reply', 'Add vague reply') +
              scenarioButton('partial-evidence', 'Add partial evidence') +
              scenarioButton('complete-evidence', 'Add complete evidence') +
              scenarioButton('known-cause-evidence', 'Add known-cause evidence') +
              scenarioButton('platform-fix-context', 'Add platform-fix context') +
              scenarioButton('resolved-confirmation', 'Add resolved confirmation') +
              scenarioButton('clear-replies', 'Clear replies') +
            '</div>' +
            renderConversationReplies(replies) +
          '</details>';
      }

      function scenarioButton(value, label) {
        return '<button type="button" class="secondary conversation-scenario" value="' + escapeHtml(value) + '">' + escapeHtml(label) + '</button>';
      }

      function renderConversationReplies(replies) {
        if (replies.length === 0) {
          return '<p class="reply-preview">No synthetic replies are attached to this ticket.</p>';
        }
        return replies.map(function (reply) {
          return '<div class="card description"><strong>' + escapeHtml(reply.id) + '</strong>' + escapeHtml(reply.body) + '</div>';
        }).join('');
      }

      function previewText(value) {
        return value.length > 110 ? value.slice(0, 107) + '...' : value;
      }
```

Call `renderConversationContext()` from `selectTicket()` after `renderTicket()`, and from the selected-ticket empty path if applicable.

- [ ] **Step 7: Add scenario append behavior**

Add:

```js
      function appendConversationScenario(value) {
        if (state.selectedTicket === null) {
          return;
        }
        if (value === 'clear-replies') {
          state.customerRepliesByTicketId[state.selectedTicket.id] = [];
          renderConversationContext();
          return;
        }
        const body = conversationScenarioBody(value);
        const replies = currentCustomerReplies();
        state.customerRepliesByTicketId[state.selectedTicket.id] = replies.concat({
          id: 'demo-reply-' + String(replies.length + 1),
          createdAt: new Date(Date.UTC(2026, 5, 10, 9, replies.length * 7)).toISOString(),
          body
        });
        renderConversationContext();
      }

      function conversationScenarioBody(value) {
        if (value === 'partial-evidence') {
          return 'The endpoint URL is https://hooks.example.test/webhooks/orders and the delivery ID is deliv_7788.';
        }
        if (value === 'complete-evidence') {
          return 'Endpoint URL is https://hooks.example.test/webhooks/orders. Delivery ID is deliv_7788. Raw body handling has not changed since yesterday.';
        }
        if (value === 'known-cause-evidence') {
          return 'We rotated the signing secret yesterday. Endpoint URL is https://hooks.example.test/webhooks/orders, delivery ID is deliv_7788, and raw body handling has not changed.';
        }
        if (value === 'platform-fix-context') {
          return 'This is affecting all EU stores and recent Checkout Started events are delayed even though the API accepted them.';
        }
        if (value === 'resolved-confirmation') {
          return 'This works now. The issue is resolved on our end.';
        }
        return 'It is still happening, but I am not sure where to find the technical details.';
      }
```

Add delegated event listener:

```js
      els.conversationContextPanel.addEventListener('click', function (event) {
        if (event.target?.className?.includes('conversation-scenario')) {
          appendConversationScenario(event.target.value);
        }
      });
```

- [ ] **Step 8: Send replies with recommendation creation**

In `createRecommendation()`, include replies:

```js
              customerReplies: currentCustomerReplies(),
```

The POST body becomes:

```js
            body: JSON.stringify({
              actor: els.actor.value.trim() || 'approval-desk',
              responseStyle: els.draftStyle.value,
              customerReplies: currentCustomerReplies()
            })
```

- [ ] **Step 9: Run focused UI tests**

Run:

```powershell
npm test -- --run test/approval-desk-ui.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add -- src/approval-desk/ui.ts test/approval-desk-ui.test.ts
git commit -m "feat: add compact conversation context controls"
```

---

### Task 4: Lifecycle Summary In Recommendation Panel

**Files:**
- Modify: `src/approval-desk/ui.ts`
- Test: `test/approval-desk-ui.test.ts`

**Interfaces:**
- Consumes: recommendation fields `supportState`, `knownCause`, `providedEvidence`, `missingEvidence`, `recommendedNextAction`.
- Produces: `renderLifecycleSummaryCard(recommendation): string`.

- [ ] **Step 1: Add failing UI test for lifecycle summary**

Add:

```ts
  it("shows compact lifecycle summary in the recommendation draft view", async () => {
    const app = await startApprovalDeskApp({
      recommendation: {
        ...fixtureRecommendation,
        supportState: "information-received",
        knownCause: null,
        providedEvidence: [
          { id: "endpoint-url", label: "Endpoint URL", customerQuestion: "Endpoint URL", source: "knowledge" },
        ],
        missingEvidence: [
          { id: "raw-body-change-status", label: "Raw body change status", customerQuestion: "Raw body handling changed?", source: "knowledge" },
        ],
        recommendedNextAction: "Thank the customer and collect only the remaining evidence.",
      },
    });
    await app.selectFirstTicket();
    await app.createRecommendation();

    const html = app.el("recommendationPanel").innerHTML;
    expect(html).toContain("Lifecycle summary");
    expect(html).toContain("State: information-received");
    expect(html).toContain("Provided evidence: 1");
    expect(html).toContain("Missing evidence: 1");
    expect(html).toContain("Thank the customer and collect only the remaining evidence.");
    expect(html.indexOf("Lifecycle summary")).toBeLessThan(
      html.indexOf("Draft Customer Response"),
    );
  });
```

- [ ] **Step 2: Run focused UI test and verify failure**

Run:

```powershell
npm test -- --run test/approval-desk-ui.test.ts
```

Expected: FAIL because summary is not rendered.

- [ ] **Step 3: Implement renderer**

In `src/approval-desk/ui.ts`, add:

```js
      function renderLifecycleSummaryCard(recommendation) {
        const provided = Array.isArray(recommendation.providedEvidence) ? recommendation.providedEvidence : [];
        const missing = Array.isArray(recommendation.missingEvidence) ? recommendation.missingEvidence : [];
        return '<div class="hero-card lifecycle-summary"><strong>Lifecycle summary</strong>' +
          '<div class="chips">' +
            chip('State: ' + (recommendation.supportState ?? 'not assessed')) +
            chip('Known cause: ' + (recommendation.knownCause ?? 'none')) +
            chip('Provided evidence: ' + provided.length) +
            chip('Missing evidence: ' + missing.length) +
          '</div>' +
          '<p class="hint">' + escapeHtml(recommendation.recommendedNextAction ?? 'Review the recommendation before approval.') + '</p>' +
          '<details><summary>Lifecycle evidence</summary>' +
            '<p class="meta"><strong>Provided</strong> ' + escapeHtml(formatEvidenceLabels(provided)) + '</p>' +
            '<p class="meta"><strong>Missing</strong> ' + escapeHtml(formatEvidenceLabels(missing)) + '</p>' +
          '</details>' +
        '</div>';
      }
```

Place `renderLifecycleSummaryCard(recommendation)` after `renderClassifierEvidenceCard(recommendation)` and before `Draft Customer Response`.

- [ ] **Step 4: Run focused UI tests**

Run:

```powershell
npm test -- --run test/approval-desk-ui.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src/approval-desk/ui.ts test/approval-desk-ui.test.ts
git commit -m "feat: show lifecycle summary in recommendations"
```

---

### Task 5: Final Verification

**Files:**
- Modify only if verification exposes a real issue:
  - `src/approval-desk/http.ts`
  - `src/approval-desk/recommendation-builder.ts`
  - `src/approval-desk/known-cause-catalog.ts`
  - `src/approval-desk/ui.ts`
  - relevant tests

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: passing focused and full suites.

- [ ] **Step 1: Run focused suites**

```powershell
npm test -- --run test/approval-desk-recommendation.test.ts test/approval-desk-http.test.ts test/approval-desk-ui.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full suite**

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 3: Inspect status**

```powershell
git status --short
```

Expected: only intentional tracked changes are committed. Existing untracked `.approval-desk.*.log` files may remain untracked and must not be staged.

- [ ] **Step 4: Commit verification fixes if needed**

Only if Step 1 or Step 2 required code/test edits:

```powershell
git add -- src/approval-desk/http.ts src/approval-desk/recommendation-builder.ts src/approval-desk/known-cause-catalog.ts src/approval-desk/ui.ts test/approval-desk-recommendation.test.ts test/approval-desk-http.test.ts test/approval-desk-ui.test.ts
git commit -m "fix: polish context-inferred lifecycle demo"
```

---

## Self-Review

**Spec coverage:** Task 1 exposes replies to backend recommendation creation. Task 2 proves lifecycle state is inferred from content rather than step order. Task 3 adds compact Conversation Context controls without setting `supportState`. Task 4 shows lifecycle inference in the recommendation panel. Task 5 verifies existing classifier evidence, approval controls, GPT Assist, and audit behavior are not broken.

**Deferred-item scan:** No incomplete markers or deferred implementation notes remain. Each task includes exact files, code snippets, commands, and expected outcomes.

**Type consistency:** `customerReplies` is consistently represented in the UI/HTTP boundary as `{ id, createdAt, body }` and mapped in HTTP to the builder shape `{ id, ticketId, createdAt, body }`. Renderer names are consistent: `renderConversationContext`, `currentCustomerReplies`, `appendConversationScenario`, and `renderLifecycleSummaryCard`.
