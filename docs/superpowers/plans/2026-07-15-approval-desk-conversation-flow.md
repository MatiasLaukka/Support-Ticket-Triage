# Approval Desk Conversation Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Approval Desk into a multi-turn conversation demo where sent support responses, customer replies, and recommendation versions remain visible and auditable.

**Architecture:** Reuse the existing audit log and recommendation repository as the local conversation source. Add conversation-specific audit actions, derive user-facing ticket state from audits plus recommendation resolution, and keep the UI focused on original ticket + conversation timeline in the center panel and the current recommendation in the right panel.

**Tech Stack:** TypeScript, Zod schemas, Node HTTP server, local JSON/JSONL repositories, static Approval Desk HTML/JS, Vitest.

## Global Constraints

- The ticket, not the recommendation, becomes the main workflow object.
- Recommendations are versioned artifacts inside the ticket conversation.
- No customer-facing response is considered sent until approval occurs and the sent event is logged.
- Customer text remains untrusted evidence.
- Customer replies can influence lifecycle inference, missing evidence, known-cause handling, and draft content, but they cannot directly approve fields or bypass review.
- Superseded recommendations remain auditable.
- Sent support responses remain visible in history.
- This phase should not add a background scheduler.
- The `Mark response as sent` button creates `customer-response-sent` with `sentAt = approvedAt + 5 minutes`.
- The implementation should use existing audit and recommendation repositories as the conversation source for this phase.
- A full separate conversation repository is out of scope.
- Keep UI changes compact and demo-oriented.
- Do not remove internal recommendation resolution values; translate them into friendlier conversation states for display.

---

## File Structure

- Modify `src/domain.ts`
  - Add recommendation resolution `superseded`.
  - Add audit actions `customer-response-sent`, `customer-reply-received`, and `recommendation-superseded`.
- Modify `src/approval-desk/conversation-history.ts`
  - Build a conversation timeline from ticket, audits, and recommendations.
  - Include original ticket, submitted/approved/superseded recommendations, sent support responses, and customer replies.
- Modify `src/triage-service.ts`
  - Add service methods for marking a response sent, adding a customer reply, and superseding a pending recommendation.
- Modify `src/approval-desk/http.ts`
  - Add API routes for customer replies and mark-sent.
  - Return conversation state, timeline, and recommendation history in ticket list/detail.
  - Feed persisted customer replies into recommendation creation.
- Modify `src/approval-desk/ui.ts`
  - Replace recommendation-centric queue labels with conversation states.
  - Persist synthetic replies through the new endpoint.
  - Render compact conversation timeline in the center panel.
  - Add `Mark response as sent` action for approved recommendations.
  - Allow new recommendations after customer replies without canceling sent/approved history.
- Modify tests:
  - `test/approval-desk-recommendation.test.ts` only if builder input shape needs additional coverage.
  - `test/approval-desk-http.test.ts` for new HTTP routes and derived state.
  - `test/approval-desk-ui.test.ts` for queue labels, sent button, timeline, and updated recommendation flow.
  - `test/policy.test.ts` or `test/repositories.test.ts` only if schema/resolution behavior requires existing assertions to expand.

---

### Task 1: Conversation Contracts And Timeline Builder

**Files:**
- Modify: `src/domain.ts`
- Modify: `src/approval-desk/conversation-history.ts`
- Test: `test/approval-desk-http.test.ts` or create focused `test/conversation-history.test.ts`

**Interfaces:**
- Produces `TriageRecommendation["resolution"]` including `"superseded"`.
- Produces audit actions:
  - `"customer-response-sent"`
  - `"customer-reply-received"`
  - `"recommendation-superseded"`
- Produces:

```ts
export type ConversationTimelineItem =
  | {
      kind: "original-ticket";
      timestamp: string;
      actor: string;
      title: string;
      body: string;
    }
  | {
      kind: "support-response-sent";
      timestamp: string;
      actor: string;
      recommendationId: string;
      body: string;
    }
  | {
      kind: "customer-reply";
      timestamp: string;
      actor: string;
      body: string;
    }
  | {
      kind: "recommendation-event";
      timestamp: string;
      actor: string;
      action: AuditEvent["action"];
      summary: string;
      recommendationId?: string;
    };

export function buildConversationTimeline(input: {
  ticket: Ticket;
  audits: readonly AuditEvent[];
  recommendations: readonly TriageRecommendation[];
}): ConversationTimelineItem[];
```

- Existing `buildConversationHistory(audits)` remains available for compatibility.

- [ ] **Step 1: Write failing timeline/schema tests**

Add `test/conversation-history.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  AuditEventSchema,
  RecommendationSchema,
  type AuditEvent,
  type Ticket,
  type TriageRecommendation,
} from "../src/domain.js";
import { buildConversationTimeline } from "../src/approval-desk/conversation-history.js";

const ticket = {
  id: "TKT-1001",
  revision: 0,
  customer: { name: "Northstar Apparel", tier: "enterprise", region: "eu-west" },
  requester: {
    name: "Maya Chen",
    role: "Ecommerce Manager",
    department: "Marketing",
    technicalLevel: "technical",
  },
  subject: "Checkout events missing",
  description: "Checkout Started events are delayed.",
  status: "triage",
  category: "incident",
  priority: "P1",
  team: "incident-response",
  tags: ["events"],
  sla: {
    responseDueAt: "2026-06-10T10:00:00.000Z",
    breached: false,
  },
  createdAt: "2026-06-10T09:00:00.000Z",
  updatedAt: "2026-06-10T09:00:00.000Z",
} satisfies Ticket;

const recommendation = {
  id: "11111111-1111-4111-8111-111111111111",
  ticketId: "TKT-1001",
  sourceRevision: 0,
  category: "incident",
  priority: "P1",
  team: "incident-response",
  duplicateCandidates: [],
  outageRisk: "likely",
  securityRisk: "none",
  slaRisk: "likely",
  missingInformation: [],
  knowledgeArticleIds: ["event-tracking-debugging"],
  draftCustomerResponse: "Hi Northstar Apparel,\n\nWe are investigating the delay.",
  rationale: "Incident routing.",
  confidence: 0.95,
  recommendedNextAction: "Monitor platform delay.",
  escalationRequired: true,
  escalationReasons: ["outage"],
  resolution: "approved",
  createdAt: "2026-06-10T09:05:00.000Z",
} satisfies TriageRecommendation;

describe("conversation timeline", () => {
  it("supports sent, reply, and superseded audit actions", () => {
    expect(
      AuditEventSchema.parse({
        id: "22222222-2222-4222-8222-222222222222",
        timestamp: "2026-06-10T09:10:00.000Z",
        actor: "approval-desk",
        action: "customer-response-sent",
        ticketId: "TKT-1001",
        recommendationId: recommendation.id,
        before: {},
        after: {
          sentAt: "2026-06-10T09:10:00.000Z",
          customerResponse: recommendation.draftCustomerResponse,
        },
        rationale: "Approved response sent to customer.",
        knowledgeArticleIds: ["event-tracking-debugging"],
        result: "success",
      }),
    ).toMatchObject({ action: "customer-response-sent" });

    expect(
      RecommendationSchema.parse({
        ...recommendation,
        resolution: "superseded",
      }),
    ).toMatchObject({ resolution: "superseded" });
  });

  it("keeps original ticket, sent response, and customer reply visible", () => {
    const audits: AuditEvent[] = [
      {
        id: "22222222-2222-4222-8222-222222222222",
        timestamp: "2026-06-10T09:10:00.000Z",
        actor: "approval-desk",
        action: "customer-response-sent",
        ticketId: "TKT-1001",
        recommendationId: recommendation.id,
        before: {},
        after: {
          sentAt: "2026-06-10T09:10:00.000Z",
          customerResponse: recommendation.draftCustomerResponse,
        },
        rationale: "Approved response sent to customer.",
        knowledgeArticleIds: ["event-tracking-debugging"],
        result: "success",
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        timestamp: "2026-06-10T09:15:00.000Z",
        actor: "Maya Chen",
        action: "customer-reply-received",
        ticketId: "TKT-1001",
        before: {},
        after: {
          body: "The API accepted the events but they are still missing.",
          source: "demo-scenario",
        },
        rationale: "Customer reply added to ticket conversation.",
        knowledgeArticleIds: [],
        result: "success",
      },
    ];

    const timeline = buildConversationTimeline({
      ticket,
      audits,
      recommendations: [recommendation],
    });

    expect(timeline.map((item) => item.kind)).toEqual([
      "original-ticket",
      "support-response-sent",
      "customer-reply",
    ]);
    expect(timeline[0]).toMatchObject({
      kind: "original-ticket",
      body: "Checkout Started events are delayed.",
    });
    expect(timeline[1]).toMatchObject({
      kind: "support-response-sent",
      body: recommendation.draftCustomerResponse,
    });
    expect(timeline[2]).toMatchObject({
      kind: "customer-reply",
      actor: "Maya Chen",
      body: "The API accepted the events but they are still missing.",
    });
  });
});
```

- [ ] **Step 2: Run the new focused test and verify it fails**

Run:

```powershell
npm test -- test/conversation-history.test.ts
```

Expected: FAIL because new audit actions, `superseded`, and `buildConversationTimeline` do not exist.

- [ ] **Step 3: Extend domain schemas**

In `src/domain.ts`, update:

```ts
resolution: z.enum(["pending", "approved", "rejected", "canceled", "superseded"]),
```

Update `AuditActionSchema`:

```ts
export const AuditActionSchema = z.enum([
  "recommendation-submitted",
  "recommendation-approved",
  "recommendation-rejected",
  "recommendation-canceled",
  "recommendation-superseded",
  "customer-response-sent",
  "customer-reply-received",
  "ticket-updated",
  "approval-rejected",
]);
```

- [ ] **Step 4: Implement timeline builder**

In `src/approval-desk/conversation-history.ts`, keep `buildConversationHistory` and add `buildConversationTimeline`.

Implementation requirements:

- original ticket item timestamp = `ticket.createdAt`
- `customer-response-sent` body comes from `event.after.customerResponse` when it is a string
- `customer-reply-received` body comes from `event.after.body` when it is a string
- unknown/malformed audit payloads should still render as `recommendation-event` instead of throwing
- sort by timestamp ascending, with original ticket first when timestamps tie

- [ ] **Step 5: Run focused test**

Run:

```powershell
npm test -- test/conversation-history.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- src/domain.ts src/approval-desk/conversation-history.ts test/conversation-history.test.ts
git commit -m "feat: add conversation timeline contracts"
```

---

### Task 2: Service Mutations For Sent Replies And Superseded Drafts

**Files:**
- Modify: `src/triage-service.ts`
- Test: `test/triage-service.test.ts` if present, otherwise `test/server-actions.test.ts` or `test/approval-desk-http.test.ts` through service-backed fixtures

**Interfaces:**
- Produces:

```ts
export interface MarkResponseSentInput {
  recommendationId: string;
  ticketId: TicketId;
  actor: string;
  sentAt: string;
}

export interface AddCustomerReplyInput {
  ticketId: TicketId;
  actor: string;
  body: string;
  receivedAt: string;
  source?: string;
}

export interface SupersedeRecommendationInput {
  recommendationId: string;
  ticketId: TicketId;
  actor: string;
  supersededAt: string;
  reason: string;
}
```

- Produces service methods:

```ts
markResponseSent(input: MarkResponseSentInput): Promise<AuditEvent>;
addCustomerReply(input: AddCustomerReplyInput): Promise<AuditEvent>;
supersedeRecommendation(input: SupersedeRecommendationInput): Promise<AuditEvent>;
```

- [ ] **Step 1: Write failing service-level tests through HTTP fixture or service fixture**

If `test/triage-service.test.ts` exists, add direct service tests. If not, add these expectations later in `test/approval-desk-http.test.ts` while still implementing service first.

Required behaviors to prove:

- approved recommendation can be marked sent
- pending recommendation can be superseded
- customer reply appends an audit event
- sent/reply events do not update ticket fields directly

Use exact expected audit shapes:

```ts
expect(sentEvent).toMatchObject({
  action: "customer-response-sent",
  recommendationId,
  ticketId: "TKT-1001",
  after: {
    sentAt: "2026-06-10T09:10:00.000Z",
    customerResponse: expect.stringContaining("Hi"),
  },
});
```

```ts
expect(replyEvent).toMatchObject({
  action: "customer-reply-received",
  actor: "Maya Chen",
  after: {
    body: expect.stringContaining("API accepted"),
    source: "demo-scenario",
  },
});
```

```ts
expect(supersededEvent).toMatchObject({
  action: "recommendation-superseded",
  before: { resolution: "pending" },
  after: { resolution: "superseded" },
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run the focused file selected in Step 1.

Expected: FAIL because service methods do not exist.

- [ ] **Step 3: Add schemas and interfaces**

In `src/triage-service.ts`, add Zod schemas beside existing input schemas:

```ts
const MarkResponseSentInputSchema = z
  .object({
    recommendationId: z.uuid(),
    ticketId: TicketIdSchema,
    actor: NonBlankStringSchema,
    sentAt: IsoTimestampSchema,
  })
  .strict();

const AddCustomerReplyInputSchema = z
  .object({
    ticketId: TicketIdSchema,
    actor: NonBlankStringSchema,
    body: NonBlankStringSchema.max(4_000),
    receivedAt: IsoTimestampSchema,
    source: NonBlankStringSchema.optional(),
  })
  .strict();

const SupersedeRecommendationInputSchema = z
  .object({
    recommendationId: z.uuid(),
    ticketId: TicketIdSchema,
    actor: NonBlankStringSchema,
    supersededAt: IsoTimestampSchema,
    reason: NonBlankStringSchema,
  })
  .strict();
```

Add exported interfaces matching the schemas.

- [ ] **Step 4: Implement `markResponseSent`**

Behavior:

- parse input
- load recommendation
- require `recommendation.resolution === "approved"`
- require ticket ID match
- append `customer-response-sent` audit event
- do not transition recommendation resolution
- use `after.customerResponse = recommendation.draftCustomerResponse`

Audit rationale:

```ts
"Approved customer response was sent."
```

- [ ] **Step 5: Implement `addCustomerReply`**

Behavior:

- parse input
- verify ticket exists with `tickets.get`
- append `customer-reply-received`
- `after.body = input.body`
- include `after.source` only when input source is present
- `knowledgeArticleIds: []`
- result `success`

Audit rationale:

```ts
"Customer reply added to ticket conversation."
```

- [ ] **Step 6: Implement `supersedeRecommendation`**

Behavior:

- parse input
- load recommendation
- require `recommendation.resolution === "pending"`
- require ticket ID match
- transition resolution pending -> superseded
- append `recommendation-superseded`
- if audit append fails, transition superseded -> pending as compensation

Audit rationale = input reason.

- [ ] **Step 7: Run focused test**

Run the focused test from Step 1.

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add -- src/triage-service.ts test/approval-desk-http.test.ts test/server-actions.test.ts test/triage-service.test.ts
git commit -m "feat: add conversation workflow service actions"
```

Only stage test files that exist and changed.

---

### Task 3: HTTP Conversation State And Recommendation Versioning

**Files:**
- Modify: `src/approval-desk/http.ts`
- Test: `test/approval-desk-http.test.ts`

**Interfaces:**
- Produces routes:
  - `POST /api/tickets/:ticketId/customer-replies`
  - `POST /api/recommendations/:recommendationId/mark-sent`
- Produces conversation state type in HTTP module:

```ts
type ConversationWorkflowState =
  | "active"
  | "draft-ready"
  | "waiting"
  | "customer-replied"
  | "resolved";
```

- Ticket list/detail `recommendationSummary.workflowState` uses these values.
- Ticket detail returns:

```ts
conversationTimeline: ConversationTimelineItem[];
recommendationHistory: TriageRecommendation[];
```

- [ ] **Step 1: Write failing HTTP tests**

Add tests in `test/approval-desk-http.test.ts`:

1. Mark sent:

```ts
it("marks an approved recommendation response as sent five minutes after approval", async () => {
  const { json } = await startFixture();
  const created = await json("/api/tickets/TKT-1001/recommendations", {
    method: "POST",
    body: JSON.stringify({ actor: "approval-desk" }),
  });
  const recommendationId = created.body.recommendation.id;

  await json(`/api/recommendations/${recommendationId}/approve`, {
    method: "POST",
    body: JSON.stringify({
      ticketId: "TKT-1001",
      expectedRevision: created.body.recommendation.sourceRevision,
      approvedFields: ["customerResponse"],
      editedCustomerResponse: created.body.recommendation.draftCustomerResponse,
      actor: "Matias Laukka",
      confirm: true,
    }),
  });

  const sent = await json(`/api/recommendations/${recommendationId}/mark-sent`, {
    method: "POST",
    body: JSON.stringify({
      ticketId: "TKT-1001",
      actor: "Matias Laukka",
    }),
  });

  expect(sent.status).toBe(200);
  expect(sent.body.auditEvent).toMatchObject({
    action: "customer-response-sent",
    after: {
      sentAt: "2026-06-10T09:05:00.000Z",
      customerResponse: expect.stringContaining("Hi"),
    },
  });

  const detail = await json("/api/tickets/TKT-1001");
  expect(detail.body.recommendationSummary.workflowState).toBe("waiting");
  expect(detail.body.conversationTimeline).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "support-response-sent" }),
    ]),
  );
});
```

2. Customer reply after sent:

```ts
it("moves a waiting ticket to customer-replied after a customer reply", async () => {
  // Build on the mark-sent setup helper from the previous test.
  const { json, recommendationId } = await startSentResponseFixture("TKT-1001");

  const reply = await json("/api/tickets/TKT-1001/customer-replies", {
    method: "POST",
    body: JSON.stringify({
      actor: "Maya Chen",
      body: "The API accepted the events but they are still missing.",
      source: "demo-scenario",
    }),
  });

  expect(reply.status).toBe(201);
  expect(reply.body.auditEvent).toMatchObject({
    action: "customer-reply-received",
  });

  const detail = await json("/api/tickets/TKT-1001");
  expect(detail.body.recommendationSummary.workflowState).toBe(
    "customer-replied",
  );
  expect(detail.body.conversationTimeline).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "customer-reply",
        body: expect.stringContaining("API accepted"),
      }),
    ]),
  );
  expect(recommendationId).toBeDefined();
});
```

3. Superseding pending:

```ts
it("supersedes a pending recommendation when new customer context creates an updated recommendation", async () => {
  const { json } = await startFixture();
  const first = await json("/api/tickets/TKT-1008/recommendations", {
    method: "POST",
    body: JSON.stringify({ actor: "approval-desk" }),
  });

  await json("/api/tickets/TKT-1008/customer-replies", {
    method: "POST",
    body: JSON.stringify({
      actor: "Juniper Retail",
      body: "Endpoint URL is https://hooks.example.test/webhooks/orders and delivery ID is deliv_7788.",
      source: "demo-scenario",
    }),
  });

  const second = await json("/api/tickets/TKT-1008/recommendations", {
    method: "POST",
    body: JSON.stringify({ actor: "approval-desk" }),
  });

  expect(second.status).toBe(201);
  expect(second.body.recommendation.id).not.toBe(first.body.recommendation.id);

  const firstRead = await json(`/api/recommendations/${first.body.recommendation.id}`);
  expect(firstRead.body.recommendation.resolution).toBe("superseded");

  const detail = await json("/api/tickets/TKT-1008");
  expect(detail.body.recommendationHistory.map((item) => item.id)).toEqual(
    expect.arrayContaining([
      first.body.recommendation.id,
      second.body.recommendation.id,
    ]),
  );
});
```

- [ ] **Step 2: Run focused HTTP tests and verify failure**

Run:

```powershell
npm test -- test/approval-desk-http.test.ts
```

Expected: FAIL because routes and workflow state do not exist.

- [ ] **Step 3: Add body schemas and routes**

In `src/approval-desk/http.ts`, add:

```ts
const CustomerReplyEventBodySchema = z
  .object({
    actor: z.string().trim().min(1),
    body: z.string().trim().min(1).max(4_000),
    source: z.string().trim().min(1).optional(),
  })
  .strict();

const MarkSentBodySchema = z
  .object({
    ticketId: TicketIdSchema,
    actor: z.string().trim().min(1),
  })
  .strict();
```

Add route matches:

```ts
const customerReplyMatch = /^\/api\/tickets\/([^/]+)\/customer-replies$/.exec(pathname);
const markSentMatch = /^\/api\/recommendations\/([^/]+)\/mark-sent$/.exec(pathname);
```

Map them to `addCustomerReply` and `markResponseSent`.

- [ ] **Step 4: Compute `sentAt = approvedAt + 5 minutes`**

In `markResponseSent`, load ticket audits:

```ts
const audits = await deps.audits.listPage({ ticketId: body.ticketId, offset: 0, limit: 100 });
const approval = audits.events
  .filter((event) =>
    event.action === "recommendation-approved" &&
    event.recommendationId === recommendationId
  )
  .sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0];
```

If missing, throw invalid request:

```ts
throw invalidRequest("Recommendation must be approved before it can be marked sent.");
```

Compute:

```ts
const sentAt = new Date(
  new Date(approval.timestamp).getTime() + 5 * 60 * 1000,
).toISOString();
```

Call `deps.service.markResponseSent`.

- [ ] **Step 5: Build persisted customer replies for recommendations**

Add helper:

```ts
function customerRepliesFromAudits(
  ticketId: string,
  audits: readonly AuditEvent[],
): Array<{ id: string; ticketId: string; createdAt: string; body: string }> {
  return audits
    .filter((event) => event.action === "customer-reply-received")
    .flatMap((event) =>
      typeof event.after.body === "string"
        ? [{
            id: event.id,
            ticketId,
            createdAt: event.timestamp,
            body: event.after.body,
          }]
        : [],
    );
}
```

In `createRecommendation`, load audits and merge persisted replies before legacy body replies:

```ts
const audits = await deps.audits.listPage({ ticketId, offset: 0, limit: 100 });
const persistedReplies = customerRepliesFromAudits(ticketId, audits.events);
const customerReplies = [
  ...persistedReplies,
  ...body.customerReplies.map((reply) => ({ ...reply, ticketId })),
];
```

- [ ] **Step 6: Supersede pending recommendations before updated submit**

Add helper:

```ts
function hasCustomerReplyAfter(
  audits: readonly AuditEvent[],
  timestamp: string,
): boolean {
  return audits.some(
    (event) =>
      event.action === "customer-reply-received" &&
      event.timestamp > timestamp,
  );
}
```

Before submitting a new recommendation:

- find latest pending recommendation for ticket
- if pending exists and `hasCustomerReplyAfter(audits.events, pending.createdAt)`, call `deps.service.supersedeRecommendation`
- if pending exists and no new reply, keep existing behavior of replacing only after user confirmation through current rejection path

For this phase, HTTP create may supersede automatically only when there is customer reply context after the pending draft. It must not supersede merely because the user clicks create twice.

- [ ] **Step 7: Conversation state summary**

Replace `RecommendationWorkflowState` with `ConversationWorkflowState`.

Derivation order:

```ts
if (hasPendingRecommendation) return "draft-ready";
if (latestSent !== undefined && latestCustomerReplyAfterLatestSent !== undefined) return "customer-replied";
if (latestSent !== undefined) return "waiting";
if (latest?.supportState === "ready-for-close") return "resolved";
return "active";
```

Include in summary:

```ts
hasSentResponse: boolean;
hasCustomerReply: boolean;
latestSentAt?: string;
latestCustomerReplyAt?: string;
```

Update `listTickets` to load audits as well as recommendations so list summaries can derive conversation state.

- [ ] **Step 8: Return timeline/history in detail**

In `getTicketDetail`, return:

```ts
conversationTimeline: buildConversationTimeline({
  ticket,
  audits: audits.events,
  recommendations: recommendations.filter((item) => item.ticketId === ticketId),
}),
recommendationHistory: recommendations
  .filter((item) => item.ticketId === ticketId)
  .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
```

Keep existing `conversationHistory` during this phase for compatibility.

- [ ] **Step 9: Run HTTP tests**

Run:

```powershell
npm test -- test/approval-desk-http.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add -- src/approval-desk/http.ts test/approval-desk-http.test.ts
git commit -m "feat: expose conversation workflow endpoints"
```

---

### Task 4: Approval Desk UI Conversation Flow

**Files:**
- Modify: `src/approval-desk/ui.ts`
- Test: `test/approval-desk-ui.test.ts`

**Interfaces:**
- Consumes ticket detail fields:
  - `conversationTimeline`
  - `recommendationHistory`
  - `recommendationSummary.workflowState`
- Uses routes:
  - `POST /api/tickets/:ticketId/customer-replies`
  - `POST /api/recommendations/:recommendationId/mark-sent`

- [ ] **Step 1: Write failing UI tests**

Add tests in `test/approval-desk-ui.test.ts`:

1. Static labels:

```ts
expect(approvalDeskHtml).toContain("Draft ready");
expect(approvalDeskHtml).toContain("Waiting");
expect(approvalDeskHtml).toContain("Customer replied");
expect(approvalDeskHtml).toContain("Mark response as sent");
expect(approvalDeskHtml).toContain("conversationTimeline");
```

2. Scenario click persists customer reply:

```ts
it("adds synthetic customer replies through the local API", async () => {
  const app = await startApprovalDeskApp();
  await app.selectFirstTicket();

  app.clickConversationScenario("partial-evidence");
  await settle();

  const replyRequest = app.requests.find((request) =>
    request.path.endsWith("/customer-replies"),
  );
  expect(replyRequest).toBeDefined();
  expect(JSON.parse(String(replyRequest?.init?.body))).toMatchObject({
    actor: expect.any(String),
    body: expect.stringContaining("endpoint URL"),
    source: "demo-scenario",
  });
});
```

3. Mark sent button:

```ts
it("marks an approved recommendation response as sent from the recommendation panel", async () => {
  const app = await startApprovalDeskApp({
    ticketDetailRecommendation: {
      ...fixtureRecommendation,
      resolution: "approved",
    },
    ticketDetailSummary: {
      workflowState: "draft-ready",
      latestRecommendationId: fixtureRecommendation.id,
      latestResolution: "approved",
      hasPendingRecommendation: false,
      hasApprovedRecommendation: true,
    },
  });

  await app.selectFirstTicket();

  expect(app.el("recommendationPanel").innerHTML).toContain(
    "Mark response as sent",
  );

  await app.markResponseSent();

  expect(
    app.requests.some((request) => request.path.endsWith("/mark-sent")),
  ).toBe(true);
});
```

4. Timeline rendering:

```ts
it("renders original ticket and conversation timeline in the center panel", async () => {
  const app = await startApprovalDeskApp({
    conversationTimeline: [
      {
        kind: "original-ticket",
        timestamp: "2026-06-10T09:00:00.000Z",
        actor: "Maya Chen",
        title: "Original ticket",
        body: "Checkout Started events are delayed.",
      },
      {
        kind: "support-response-sent",
        timestamp: "2026-06-10T09:10:00.000Z",
        actor: "Matias Laukka",
        recommendationId: fixtureRecommendation.id,
        body: "We are investigating the delay.",
      },
      {
        kind: "customer-reply",
        timestamp: "2026-06-10T09:15:00.000Z",
        actor: "Maya Chen",
        body: "The API accepted the events but they are still missing.",
      },
    ],
  });

  await app.selectFirstTicket();

  const html = app.el("ticketPanel").innerHTML;
  expect(html).toContain("Conversation timeline");
  expect(html).toContain("Original ticket");
  expect(html).toContain("Support response sent");
  expect(html).toContain("Customer reply");
});
```

- [ ] **Step 2: Run focused UI tests and verify failure**

Run:

```powershell
npm test -- test/approval-desk-ui.test.ts
```

Expected: FAIL because labels/actions/timeline do not exist.

- [ ] **Step 3: Update queue filters**

Replace `queueFilters` values:

```js
['active', 'draft-ready', 'waiting', 'customer-replied', 'resolved', 'all']
```

Labels:

```js
{
  active: 'Active',
  'draft-ready': 'Draft ready',
  waiting: 'Waiting',
  'customer-replied': 'Customer replied',
  resolved: 'Resolved',
  all: 'All'
}
```

Default remains `active`.

- [ ] **Step 4: Render conversation timeline in ticket panel**

Add `state.conversationTimeline = []`.

When `selectTicket` receives detail:

```js
state.conversationTimeline = Array.isArray(data.conversationTimeline)
  ? data.conversationTimeline
  : [];
state.recommendationHistory = Array.isArray(data.recommendationHistory)
  ? data.recommendationHistory
  : [];
```

Add `renderConversationTimeline()`:

```js
function renderConversationTimeline() {
  if (state.conversationTimeline.length === 0) {
    return '<p class="hint">No conversation events yet.</p>';
  }
  return '<section class="card conversation-timeline"><h3>Conversation timeline</h3>' +
    state.conversationTimeline.map(renderTimelineItem).join('') +
    '</section>';
}
```

Each item should be compact:

- show kind label
- actor and timestamp in muted text
- body in a `<details>` when longer than 260 characters

- [ ] **Step 5: Persist scenario replies through API**

Change `appendConversationScenario`:

- keep immediate local UI feedback optional
- POST to `/api/tickets/:id/customer-replies`
- body:

```js
{
  actor: state.selectedTicket.requester?.name ?? state.selectedTicket.customer.name,
  body,
  source: 'demo-scenario'
}
```

After success:

- call `selectTicket(state.selectedTicket.id)` or refresh selected ticket detail
- refresh queue/evidence
- do not set `supportState` in browser state

- [ ] **Step 6: Mark response as sent button**

Add button in recommendation panel when:

```js
state.recommendation?.resolution === 'approved' &&
state.selectedTicket?.recommendationSummary?.hasSentResponse !== true
```

Button label:

```html
Mark response as sent
```

Click handler:

```js
async function markResponseSent() {
  if (state.recommendation === null || state.selectedTicket === null) {
    return;
  }
  const data = await requestJson('/api/recommendations/' + encodeURIComponent(state.recommendation.id) + '/mark-sent', {
    method: 'POST',
    body: JSON.stringify({
      ticketId: state.selectedTicket.id,
      actor: els.actor.value.trim() || 'approval-desk'
    })
  });
  setResult(data);
  await selectTicket(state.selectedTicket.id);
  await refreshQueue();
  await refreshEvidence();
}
```

- [ ] **Step 7: Allow updated recommendations after customer replies**

Update `updateControls`:

- `isApprovedWorkflow()` should no longer disable create forever.
- Disable create only when approved but not sent and no customer reply is present.
- Enable create for `workflowState === "customer-replied"` and for `workflowState === "active"`.

Button copy:

- if customer replied: `Create updated recommendation`
- otherwise: `Create recommendation`

- [ ] **Step 8: Render previous recommendations compactly**

Add a `Previous recommendations` `<details>` in the recommendation panel when `state.recommendationHistory.length > 1`.

Show:

- created timestamp
- resolution
- first 160 characters of `draftCustomerResponse`

Do not put full previous recommendation details in the right panel by default.

- [ ] **Step 9: Update fake app test harness**

In `test/approval-desk-ui.test.ts`:

- add `markResponseSent` button element if needed
- include `conversationTimeline` and `recommendationHistory` in fixture detail responses
- handle `/customer-replies`
- handle `/mark-sent`
- update queue filters list

- [ ] **Step 10: Run UI tests**

Run:

```powershell
npm test -- test/approval-desk-ui.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit**

```powershell
git add -- src/approval-desk/ui.ts test/approval-desk-ui.test.ts
git commit -m "feat: show conversation workflow in approval desk"
```

---

### Task 5: End-To-End Verification And Demo Polish

**Files:**
- Modify only if verification exposes a real issue:
  - `src/domain.ts`
  - `src/triage-service.ts`
  - `src/approval-desk/conversation-history.ts`
  - `src/approval-desk/http.ts`
  - `src/approval-desk/ui.ts`
  - relevant tests

**Interfaces:**
- Consumes Tasks 1-4.
- Produces passing focused and full test suites.

- [ ] **Step 1: Run focused suites**

Run:

```powershell
npm test -- test/conversation-history.test.ts test/approval-desk-http.test.ts test/approval-desk-ui.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full suite**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 3: Build and smoke-test local app**

Run:

```powershell
npm run build
```

Expected: PASS.

Optional local smoke sequence:

```powershell
npm run approval-desk
```

Manual browser flow:

1. Select a ticket.
2. Create recommendation.
3. Approve customer response.
4. Click `Mark response as sent`.
5. Add a customer reply.
6. Verify queue state becomes `Customer replied`.
7. Create updated recommendation.
8. Verify old sent response and customer reply remain visible in the center timeline.

- [ ] **Step 4: Inspect status**

Run:

```powershell
git status --short
```

Expected:

- only intentional tracked changes are committed
- `.approval-desk.*.log` may remain untracked
- `.superpowers/sdd/*` may remain untracked

- [ ] **Step 5: Commit verification fixes if needed**

Only if Steps 1-3 required edits:

```powershell
git add -- src/domain.ts src/triage-service.ts src/approval-desk/conversation-history.ts src/approval-desk/http.ts src/approval-desk/ui.ts test/conversation-history.test.ts test/approval-desk-http.test.ts test/approval-desk-ui.test.ts
git commit -m "fix: polish approval desk conversation flow"
```

---

## Self-Review

**Spec coverage:** Task 1 adds conversation contracts and timeline rendering data. Task 2 adds audit-backed service mutations. Task 3 exposes reply/sent endpoints, derived conversation state, persisted replies, and superseding. Task 4 updates the UI labels, timeline, sent button, and updated recommendation flow. Task 5 verifies the full demo path.

**Placeholder scan:** No placeholder markers remain. Each task names exact files, interfaces, test commands, and expected outcomes.

**Type consistency:** `ConversationWorkflowState` values are consistently `active`, `draft-ready`, `waiting`, `customer-replied`, and `resolved`. Audit actions are consistently `customer-response-sent`, `customer-reply-received`, and `recommendation-superseded`. The sent route is consistently `/api/recommendations/:recommendationId/mark-sent`.
