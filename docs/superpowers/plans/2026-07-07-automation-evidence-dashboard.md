# Automation Evidence Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Automation Evidence dashboard and one-command demo runner that make the local Approval Desk measurable, repeatable, and easy to present.

**Architecture:** Build a pure evidence report module first, then expose it through `GET /api/evidence`, render it in the existing plain browser UI, and add a local demo runner script that safely resets runtime state before launching the compiled Approval Desk. All report data comes from existing repositories, queue metrics, recommendations, and audit events; no new persistence layer is added.

**Tech Stack:** TypeScript ESM, Node.js built-in `http`, `child_process`, and filesystem APIs, existing JSON/Markdown repositories, existing Approval Desk UI string, Vitest.

---

## File Structure

- Create `src/approval-desk/evidence-report.ts`: pure report builder and exported report types.
- Modify `src/approval-desk/http.ts`: add `GET /api/evidence` route that composes metrics, audits, tickets, and recommendations.
- Modify `src/approval-desk/ui.ts`: add Automation Evidence dashboard markup and browser rendering/refresh logic.
- Create `scripts/demo-approval-desk.ts`: safe local demo reset and server launcher.
- Modify `package.json`: add `demo:approval-desk` script.
- Modify `README.md` and `docs/demo-script.md`: document the one-command demo and evidence dashboard checkpoints.
- Create `test/approval-desk-evidence-report.test.ts`: unit tests for report totals, guardrails, and recent activity.
- Modify `test/approval-desk-http.test.ts`: endpoint tests for `/api/evidence`.
- Modify `test/approval-desk-ui.test.ts`: fake-DOM tests for dashboard rendering and refresh calls.
- Create `test/demo-approval-desk.test.ts`: demo runner safety and output tests.

## Task 1: Evidence Report Builder

**Files:**
- Create: `src/approval-desk/evidence-report.ts`
- Test: `test/approval-desk-evidence-report.test.ts`

- [ ] **Step 1: Write failing evidence report tests**

Create `test/approval-desk-evidence-report.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AuditEvent, Ticket, TriageRecommendation } from "../src/domain.js";
import type { QueueMetrics } from "../src/metrics.js";
import { buildAutomationEvidenceReport } from "../src/approval-desk/evidence-report.js";

const generatedAt = "2026-06-10T09:00:00.000Z";

describe("buildAutomationEvidenceReport", () => {
  it("summarizes metrics, audits, guardrails, and recent activity", () => {
    const report = buildAutomationEvidenceReport({
      metrics: makeMetrics({
        openTickets: 7,
        pendingRecommendations: 1,
        approvedRecommendations: 2,
        rejectedRecommendations: 1,
        estimatedMinutesSaved: 16,
      }),
      tickets: [makeTicket("TKT-1001"), makeTicket("TKT-1002")],
      recommendations: [
        makeRecommendation("rec-approved", "approved"),
        makeRecommendation("rec-rejected", "rejected"),
        makeRecommendation("rec-pending", "pending"),
      ],
      audits: [
        makeAudit({
          id: "11111111-1111-4111-8111-111111111111",
          action: "recommendation-approved",
          result: "success",
          timestamp: "2026-06-10T09:05:00.000Z",
        }),
        makeAudit({
          id: "22222222-2222-4222-8222-222222222222",
          action: "approval-rejected",
          result: "failure",
          timestamp: "2026-06-10T09:04:00.000Z",
          rejectionReason: "Approval revision is stale.",
        }),
      ],
      generatedAt,
    });

    expect(report.summary).toEqual({
      openTickets: 7,
      pendingRecommendations: 1,
      approvedRecommendations: 2,
      rejectedRecommendations: 1,
      estimatedMinutesSaved: 16,
      auditEvents: 2,
      safetyBlocks: 1,
      activeGuardrails: 6,
    });
    expect(report.guardrails.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "submission-is-not-mutation", status: "active" },
      { id: "explicit-approval", status: "active" },
      { id: "edited-customer-response", status: "active" },
      { id: "rejection-feedback", status: "active" },
      { id: "untrusted-ticket-text", status: "active" },
      { id: "stale-and-replay-protection", status: "active" },
    ]);
    expect(report.recentActivity).toEqual([
      {
        timestamp: "2026-06-10T09:05:00.000Z",
        action: "recommendation-approved",
        ticketId: "TKT-1001",
        recommendationId: "rec-approved",
        result: "success",
      },
      {
        timestamp: "2026-06-10T09:04:00.000Z",
        action: "approval-rejected",
        ticketId: "TKT-1001",
        recommendationId: "rec-approved",
        result: "failure",
      },
    ]);
  });

  it("counts only provable blocked safety outcomes", () => {
    const report = buildAutomationEvidenceReport({
      metrics: makeMetrics(),
      tickets: [],
      recommendations: [],
      audits: [
        makeAudit({ action: "recommendation-rejected", result: "success" }),
        makeAudit({ action: "approval-rejected", result: "failure" }),
        makeAudit({ action: "recommendation-approved", result: "success" }),
      ],
      generatedAt,
    });

    expect(report.summary.safetyBlocks).toBe(1);
  });
});

function makeMetrics(overrides: Partial<QueueMetrics> = {}): QueueMetrics {
  return {
    generatedAt,
    openTickets: 0,
    untriagedTickets: 0,
    slaBreachedTickets: 0,
    slaAtRiskTickets: 0,
    ticketsByCategory: {},
    ticketsByPriority: {},
    ticketsByTeam: {},
    submittedRecommendations: 0,
    pendingRecommendations: 0,
    approvedRecommendations: 0,
    rejectedRecommendations: 0,
    acceptanceRate: null,
    rejectionRate: null,
    averageConfidence: null,
    escalationCounts: { total: 0 },
    minutesPerAcceptedRecommendation: 8,
    estimatedMinutesSaved: 0,
    ...overrides,
  };
}

function makeTicket(id: string): Ticket {
  return {
    id,
    createdAt: "2026-06-10T08:00:00.000Z",
    updatedAt: "2026-06-10T08:30:00.000Z",
    customer: { name: "Northstar", plan: "enterprise", region: "eu", vip: false },
    subject: "Login issue",
    description: "Cannot log in.",
    status: "triage",
    category: "authentication",
    priority: "P2",
    team: "identity",
    assignee: undefined,
    tags: [],
    sla: { responseDueAt: "2026-06-10T10:00:00.000Z", breached: false },
    relatedTicketIds: [],
    revision: 0,
  };
}

function makeRecommendation(
  id: string,
  resolution: TriageRecommendation["resolution"],
): TriageRecommendation {
  return {
    id,
    ticketId: "TKT-1001",
    sourceRevision: 0,
    category: "authentication",
    priority: "P2",
    team: "identity",
    assignee: undefined,
    ticketStatus: "in-progress",
    tags: ["login"],
    duplicateCandidates: [],
    outageRisk: "none",
    securityRisk: "none",
    slaRisk: "none",
    missingInformation: [],
    knowledgeArticleIds: ["account-access"],
    draftCustomerResponse: "We are investigating.",
    rationale: "Account access routing.",
    confidence: 0.9,
    recommendedNextAction: "Review evidence.",
    escalationRequired: false,
    escalationReasons: [],
    resolution,
    createdAt: "2026-06-10T09:00:00.000Z",
  };
}

function makeAudit(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    timestamp: "2026-06-10T09:00:00.000Z",
    actor: "approval-desk",
    action: "recommendation-approved",
    ticketId: "TKT-1001",
    recommendationId: "rec-approved",
    before: {},
    after: {},
    rationale: "Reviewed.",
    knowledgeArticleIds: ["account-access"],
    result: "success",
    ...overrides,
  } as AuditEvent;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run test/approval-desk-evidence-report.test.ts
```

Expected: fails because `src/approval-desk/evidence-report.ts` does not exist.

- [ ] **Step 3: Implement evidence report builder**

Create `src/approval-desk/evidence-report.ts`:

```ts
import type {
  AuditEvent,
  Ticket,
  TriageRecommendation,
} from "../domain.js";
import type { QueueMetrics } from "../metrics.js";

export interface AutomationEvidenceReport {
  generatedAt: string;
  summary: {
    openTickets: number;
    pendingRecommendations: number;
    approvedRecommendations: number;
    rejectedRecommendations: number;
    estimatedMinutesSaved: number;
    auditEvents: number;
    safetyBlocks: number;
    activeGuardrails: number;
  };
  guardrails: EvidenceGuardrail[];
  recentActivity: EvidenceActivity[];
  metrics: QueueMetrics;
}

export interface EvidenceGuardrail {
  id: string;
  label: string;
  status: "active";
  evidence: string;
}

export interface EvidenceActivity {
  timestamp: string;
  action: AuditEvent["action"];
  ticketId?: string;
  recommendationId?: string;
  result: AuditEvent["result"];
}

export interface AutomationEvidenceInput {
  metrics: QueueMetrics;
  tickets: readonly Ticket[];
  recommendations: readonly TriageRecommendation[];
  audits: readonly AuditEvent[];
  generatedAt: string;
}

const GUARDRAILS: readonly EvidenceGuardrail[] = [
  {
    id: "submission-is-not-mutation",
    label: "Submission is not mutation",
    status: "active",
    evidence: "Recommendations are stored pending until an approval finalizer succeeds.",
  },
  {
    id: "explicit-approval",
    label: "Explicit named-field approval",
    status: "active",
    evidence: "Approval requires actor, selected fields, source revision, and confirm true.",
  },
  {
    id: "edited-customer-response",
    label: "Edited customer response required",
    status: "active",
    evidence: "customerResponse approval requires nonblank reviewer-edited text.",
  },
  {
    id: "rejection-feedback",
    label: "Rejection requires feedback",
    status: "active",
    evidence: "Rejecting a recommendation requires actor and nonblank feedback.",
  },
  {
    id: "untrusted-ticket-text",
    label: "Ticket text is evidence only",
    status: "active",
    evidence: "Prompt-injection or claimed approval inside a ticket cannot authorize mutation.",
  },
  {
    id: "stale-and-replay-protection",
    label: "Stale and replay protection",
    status: "active",
    evidence: "The service rejects stale revisions and already-resolved recommendations.",
  },
];

export function buildAutomationEvidenceReport(
  input: AutomationEvidenceInput,
): AutomationEvidenceReport {
  const safetyBlocks = input.audits.filter(isSafetyBlock).length;
  return {
    generatedAt: input.generatedAt,
    summary: {
      openTickets: input.metrics.openTickets,
      pendingRecommendations: input.metrics.pendingRecommendations,
      approvedRecommendations: input.metrics.approvedRecommendations,
      rejectedRecommendations: input.metrics.rejectedRecommendations,
      estimatedMinutesSaved: input.metrics.estimatedMinutesSaved,
      auditEvents: input.audits.length,
      safetyBlocks,
      activeGuardrails: GUARDRAILS.length,
    },
    guardrails: [...GUARDRAILS],
    recentActivity: input.audits
      .slice()
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .slice(0, 8)
      .map((event) => ({
        timestamp: event.timestamp,
        action: event.action,
        ticketId: event.ticketId,
        recommendationId: event.recommendationId,
        result: event.result,
      })),
    metrics: input.metrics,
  };
}

function isSafetyBlock(event: AuditEvent): boolean {
  return event.result === "failure" || event.action === "approval-rejected";
}
```

- [ ] **Step 4: Run evidence report tests**

Run:

```powershell
npm test -- --run test/approval-desk-evidence-report.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add -- src/approval-desk/evidence-report.ts test/approval-desk-evidence-report.test.ts
git commit -m "feat: add automation evidence report"
```

## Task 2: Evidence HTTP API

**Files:**
- Modify: `src/approval-desk/http.ts`
- Test: `test/approval-desk-http.test.ts`

- [ ] **Step 1: Write failing `/api/evidence` HTTP tests**

Append to `describe("createApprovalDeskHttpServer", ...)` in `test/approval-desk-http.test.ts`:

```ts
  it("returns automation evidence for the local dashboard", async () => {
    const { json } = await startFixture();
    const created = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });

    const evidence = await json("/api/evidence");

    expect(evidence.status).toBe(200);
    expect(evidence.body).toMatchObject({
      summary: {
        openTickets: 29,
        pendingRecommendations: 1,
        approvedRecommendations: 0,
        rejectedRecommendations: 0,
        estimatedMinutesSaved: 0,
        auditEvents: 1,
        safetyBlocks: 0,
        activeGuardrails: 6,
      },
      guardrails: [
        expect.objectContaining({
          id: "submission-is-not-mutation",
          status: "active",
        }),
      ],
      recentActivity: [
        expect.objectContaining({
          action: "recommendation-submitted",
          ticketId: "TKT-1005",
          recommendationId: created.body.recommendation.id,
          result: "success",
        }),
      ],
      metrics: expect.objectContaining({
        pendingRecommendations: 1,
      }),
    });
  });

  it("counts failed approval audits as safety blocks in evidence", async () => {
    const { deps, json } = await startFixture();
    const created = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await deps.tickets.update("TKT-1005", 0, (ticket) => ({
      ...ticket,
      assignee: "concurrent-reviewer@example.test",
    }));
    await json(`/api/recommendations/${created.body.recommendation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1005",
        expectedRevision: 0,
        approvedFields: ["category"],
        actor: "approval-desk",
        confirm: true,
      }),
    });

    const evidence = await json("/api/evidence");

    expect(evidence.status).toBe(200);
    expect(evidence.body.summary.safetyBlocks).toBe(1);
    expect(evidence.body.recentActivity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "approval-rejected",
          result: "failure",
        }),
      ]),
    );
  });
```

- [ ] **Step 2: Run HTTP tests to verify they fail**

Run:

```powershell
npm test -- --run test/approval-desk-http.test.ts
```

Expected: fails because `/api/evidence` returns 404.

- [ ] **Step 3: Implement `/api/evidence` route**

In `src/approval-desk/http.ts`, add import:

```ts
import { buildAutomationEvidenceReport } from "./evidence-report.js";
```

In `matchRoute`, add before `return undefined`:

```ts
  if (method === "GET" && pathname === "/api/evidence") {
    return { status: 200, handle: getEvidence };
  }
```

Add handler near `getMetrics`:

```ts
async function getEvidence({ deps }: RouteContext): Promise<unknown> {
  const [tickets, recommendations, audits] = await Promise.all([
    deps.tickets.snapshot(),
    deps.recommendations.list(),
    deps.audits.listPage({ offset: 0, limit: 50 }),
  ]);
  const metrics = calculateQueueMetrics({
    tickets,
    recommendations,
    now: deps.now(),
    minutesPerAcceptedRecommendation: deps.minutesPerAcceptedRecommendation,
  });
  return buildAutomationEvidenceReport({
    metrics,
    tickets,
    recommendations,
    audits: audits.events,
    generatedAt: deps.now().toISOString(),
  });
}
```

- [ ] **Step 4: Run focused HTTP and report tests**

Run:

```powershell
npm test -- --run test/approval-desk-evidence-report.test.ts test/approval-desk-http.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add -- src/approval-desk/http.ts test/approval-desk-http.test.ts
git commit -m "feat: expose automation evidence API"
```

## Task 3: Automation Evidence Dashboard UI

**Files:**
- Modify: `src/approval-desk/ui.ts`
- Test: `test/approval-desk-ui.test.ts`

- [ ] **Step 1: Write failing dashboard UI tests**

Update `test/approval-desk-ui.test.ts`:

1. Add content assertions to the first test:

```ts
    expect(approvalDeskHtml).toContain("Automation Evidence");
    expect(approvalDeskHtml).toContain("Estimated minutes saved");
    expect(approvalDeskHtml).toContain("/api/evidence");
```

2. In `startApprovalDeskApp`, add an evidence fixture and route:

```ts
  const evidence = {
    generatedAt: "2026-06-10T09:00:00.000Z",
    summary: {
      openTickets: 29,
      pendingRecommendations: 1,
      approvedRecommendations: 0,
      rejectedRecommendations: 0,
      estimatedMinutesSaved: 0,
      auditEvents: 1,
      safetyBlocks: 0,
      activeGuardrails: 6,
    },
    guardrails: [
      {
        id: "submission-is-not-mutation",
        label: "Submission is not mutation",
        status: "active",
        evidence: "Recommendations are stored pending.",
      },
    ],
    recentActivity: [],
    metrics,
  };
```

```ts
    if (path === "/api/evidence") {
      return jsonResponse(evidence);
    }
```

3. Add test:

```ts
  it("renders and refreshes automation evidence", async () => {
    const app = await startApprovalDeskApp();

    expect(app.el("evidencePanel").innerHTML).toContain("Open tickets");
    expect(app.el("evidencePanel").innerHTML).toContain("29");
    expect(app.el("evidencePanel").innerHTML).toContain("Safety blocks");
    expect(app.el("guardrailsPanel").innerHTML).toContain("Submission is not mutation");
    expect(app.requests.filter(({ path }) => path === "/api/evidence")).toHaveLength(1);

    await app.selectFirstTicket();
    await app.createRecommendation();

    expect(app.requests.filter(({ path }) => path === "/api/evidence").length).toBeGreaterThanOrEqual(2);
  });
```

4. Add fake DOM elements in `createElements()`:

```ts
      "evidencePanel",
      "guardrailsPanel",
      "activityPanel",
```

- [ ] **Step 2: Run UI tests to verify they fail**

Run:

```powershell
npm test -- --run test/approval-desk-ui.test.ts
```

Expected: fails because evidence dashboard markup and `/api/evidence` calls do not exist.

- [ ] **Step 3: Add dashboard markup**

In `src/approval-desk/ui.ts`, add a dashboard section between the header and `<main class="layout">`:

```html
      <section class="panel evidence" aria-label="Automation evidence">
        <div class="split">
          <div>
            <h2>Automation Evidence</h2>
            <p class="hint">Business impact and guardrails from the local synthetic workflow.</p>
          </div>
          <button id="refreshEvidence" type="button" class="secondary">Refresh evidence</button>
        </div>
        <div id="evidencePanel" class="evidence-grid"></div>
        <h3>Guardrails Active</h3>
        <div id="guardrailsPanel" class="guardrails"></div>
        <h3>Recent Activity</h3>
        <div id="activityPanel" class="activity-list"></div>
      </section>
```

Add CSS:

```css
      .evidence {
        margin-bottom: 1rem;
      }

      .evidence-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .metric-card {
        background: #fbfcff;
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 0.85rem;
      }

      .metric-card span {
        color: var(--muted);
        display: block;
        font-size: 0.84rem;
      }

      .metric-card strong {
        display: block;
        font-size: 1.55rem;
        margin-top: 0.25rem;
      }

      .guardrails,
      .activity-list {
        display: grid;
        gap: 0.5rem;
      }
```

- [ ] **Step 4: Add browser evidence rendering**

In `els`, add:

```js
        activityPanel: document.getElementById('activityPanel'),
        evidencePanel: document.getElementById('evidencePanel'),
        guardrailsPanel: document.getElementById('guardrailsPanel'),
        refreshEvidence: document.getElementById('refreshEvidence'),
```

Add functions:

```js
      async function loadEvidence() {
        const evidence = await requestJson('/api/evidence');
        renderEvidence(evidence);
      }

      function renderEvidence(evidence) {
        const summary = evidence.summary ?? {};
        els.evidencePanel.innerHTML =
          evidenceCard('Open tickets', summary.openTickets) +
          evidenceCard('Pending recommendations', summary.pendingRecommendations) +
          evidenceCard('Approved recommendations', summary.approvedRecommendations) +
          evidenceCard('Rejected recommendations', summary.rejectedRecommendations) +
          evidenceCard('Estimated minutes saved', summary.estimatedMinutesSaved) +
          evidenceCard('Audit events', summary.auditEvents) +
          evidenceCard('Safety blocks', summary.safetyBlocks) +
          evidenceCard('Active guardrails', summary.activeGuardrails);
        els.guardrailsPanel.innerHTML = Array.isArray(evidence.guardrails)
          ? evidence.guardrails.map(function (guardrail) {
              return '<div class="card"><strong>' + escapeHtml(guardrail.label) + '</strong>' + escapeHtml(guardrail.evidence) + '</div>';
            }).join('')
          : '<p class="hint">No guardrail evidence available.</p>';
        els.activityPanel.innerHTML = Array.isArray(evidence.recentActivity) && evidence.recentActivity.length > 0
          ? evidence.recentActivity.map(function (activity) {
              return '<div class="card"><strong>' + escapeHtml(activity.action) + '</strong>' +
                escapeHtml(activity.timestamp + ' · ' + activity.result) + '</div>';
            }).join('')
          : '<p class="hint">No recent activity yet.</p>';
      }

      function evidenceCard(label, value) {
        return '<div class="metric-card"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value ?? 0) + '</strong></div>';
      }
```

After create, approve, reject, and refresh queue actions, call `await loadEvidence()` or schedule it in the existing `.catch` pattern. On initial load, call it along with queue/metrics:

```js
      void loadQueue()
        .then(loadMetrics)
        .then(loadEvidence)
        .catch(function (error) { setResult({ error: error.message }); });
```

Add event listener:

```js
      els.refreshEvidence.addEventListener('click', function () {
        void loadEvidence().catch(function (error) { setResult({ error: error.message }); });
      });
```

- [ ] **Step 5: Run UI and HTTP tests**

Run:

```powershell
npm test -- --run test/approval-desk-ui.test.ts test/approval-desk-http.test.ts
```

Expected: tests pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add -- src/approval-desk/ui.ts test/approval-desk-ui.test.ts
git commit -m "feat: add automation evidence dashboard"
```

## Task 4: One-Command Demo Runner

**Files:**
- Create: `scripts/demo-approval-desk.ts`
- Modify: `package.json`
- Test: `test/demo-approval-desk.test.ts`

- [ ] **Step 1: Write failing demo runner tests**

Create `test/demo-approval-desk.test.ts`:

```ts
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import {
  buildDemoWalkthrough,
  resetRuntimeDirectory,
  verifyDemoRepository,
} from "../scripts/demo-approval-desk.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("demo approval desk runner helpers", () => {
  it("verifies the expected repository package", async () => {
    await expect(verifyDemoRepository(process.cwd())).resolves.toBeUndefined();
  });

  it("rejects a directory without the project package", async () => {
    const root = await mkdtemp(join(tmpdir(), "approval-demo-invalid-"));
    roots.push(root);
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "other" }), "utf8");

    await expect(verifyDemoRepository(root)).rejects.toThrow(
      "Refusing demo start: expected package support-ticket-triage-mcp.",
    );
  });

  it("resets runtime data while preserving .gitkeep", async () => {
    const root = await mkdtemp(join(tmpdir(), "approval-demo-reset-"));
    roots.push(root);
    const runtime = join(root, "data", "runtime");
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "support-ticket-triage-mcp" }), "utf8");
    await writeFile(join(runtime, ".gitkeep"), "", "utf8").catch(async () => {
      await import("node:fs/promises").then(({ mkdir }) => mkdir(runtime, { recursive: true }));
      await writeFile(join(runtime, ".gitkeep"), "", "utf8");
    });
    await writeFile(join(runtime, "tickets.json"), "[]", "utf8");

    await resetRuntimeDirectory(root);

    await expect(stat(join(runtime, ".gitkeep"))).resolves.toBeDefined();
    await expect(stat(join(runtime, "tickets.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("prints a concise walkthrough with the local URL", () => {
    expect(buildDemoWalkthrough("http://127.0.0.1:5177")).toContain(
      "Approval Desk demo ready:",
    );
    expect(buildDemoWalkthrough("http://127.0.0.1:5177")).toContain(
      "Select TKT-1005",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run test/demo-approval-desk.test.ts
```

Expected: fails because `scripts/demo-approval-desk.ts` does not exist.

- [ ] **Step 3: Implement demo runner helpers and CLI**

Create `scripts/demo-approval-desk.ts`:

```ts
import { spawn } from "node:child_process";
import process from "node:process";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const PACKAGE_NAME = "support-ticket-triage-mcp";
const DEFAULT_URL = "http://127.0.0.1:5177";

export async function verifyDemoRepository(root: string): Promise<void> {
  const raw = await readFile(join(root, "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { name?: unknown };
  if (parsed.name !== PACKAGE_NAME) {
    throw new Error(`Refusing demo start: expected package ${PACKAGE_NAME}.`);
  }
}

export async function resetRuntimeDirectory(root: string): Promise<void> {
  await verifyDemoRepository(root);
  const runtimeRoot = resolve(root, "data", "runtime");
  const runtimeStat = await stat(runtimeRoot);
  if (!runtimeStat.isDirectory()) {
    throw new Error("Refusing demo reset: data/runtime is not a directory.");
  }
  await mkdir(runtimeRoot, { recursive: true });
  const entries = await readdir(runtimeRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".gitkeep") {
      continue;
    }
    const target = join(runtimeRoot, entry.name);
    await rm(target, { recursive: true, force: true });
  }
}

export function buildDemoWalkthrough(url: string): string {
  return [
    "Approval Desk demo ready:",
    url,
    "",
    "Suggested walkthrough:",
    "1. Select TKT-1005.",
    "2. Create a recommendation.",
    "3. Review the evidence dashboard and prompt-injection warning.",
    "4. Approve named fields with an actor and explicit confirmation.",
    "5. Confirm dashboard metrics, safety blocks, and audit trail.",
    "",
    "Press Ctrl+C to stop the local demo server.",
  ].join("\n");
}

async function main(): Promise<void> {
  const root = process.cwd();
  await verifyDemoRepository(root);
  await resetRuntimeDirectory(root);
  const child = spawn(process.execPath, ["dist/src/approval-desk.js"], {
    cwd: root,
    env: {
      ...process.env,
      APPROVAL_DESK_HOST: process.env.APPROVAL_DESK_HOST ?? "127.0.0.1",
      APPROVAL_DESK_PORT: process.env.APPROVAL_DESK_PORT ?? "5177",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    process.stdout.write(chunk);
    const match = /Approval Desk listening at (http:\/\/(?:\[[^\]]+\]|[^:\s]+):\d+)\./.exec(chunk);
    if (match !== null) {
      process.stdout.write(`\n${buildDemoWalkthrough(match[1] ?? DEFAULT_URL)}\n`);
    }
  });
  child.stderr.on("data", (chunk: string) => process.stderr.write(chunk));
  process.on("SIGINT", () => {
    child.kill();
  });
  const code = await new Promise<number | null>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", resolveExit);
  });
  process.exitCode = code ?? 0;
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  main().catch((error: unknown) => {
    console.error("Approval Desk demo failed to start.");
    console.error(error instanceof Error ? error.message : "Unexpected demo startup error.");
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Add package script**

Modify `package.json` scripts:

```json
"demo:approval-desk": "node dist/scripts/demo-approval-desk.js"
```

Keep existing scripts unchanged.

- [ ] **Step 5: Run demo runner tests and build**

Run:

```powershell
npm test -- --run test/demo-approval-desk.test.ts test/approval-desk-entrypoint.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add -- scripts/demo-approval-desk.ts package.json test/demo-approval-desk.test.ts
git commit -m "feat: add approval desk demo runner"
```

## Task 5: Documentation And Final Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/demo-script.md`

- [ ] **Step 1: Update README**

In `README.md`, update **Use The Local Approval Desk** to include:

````md
For a repeatable walkthrough, run:

```powershell
npm ci
npm run build
npm run demo:approval-desk
```

The demo command resets local runtime data, starts the Approval Desk, and prints
the local URL plus suggested steps. The Automation Evidence dashboard shows open
tickets, recommendation counts, estimated minutes saved, audit events, safety
blocks, and active guardrails.
````

- [ ] **Step 2: Update demo script**

In `docs/demo-script.md`, update **2a. Browser Approval Desk** to use:

```powershell
npm run demo:approval-desk
```

Add expected checkpoints:

```md
- the Automation Evidence dashboard shows open tickets, recommendation counts,
  active guardrails, audit events, and estimated minutes saved;
- after approval or rejection, the dashboard refreshes and the raw JSON result
  still shows the service action.
```

- [ ] **Step 3: Run docs search**

Run:

```powershell
rg -n "T[O]DO|T[B]D|CV|portfolio|production deployment" README.md docs/demo-script.md docs/superpowers/specs/2026-07-07-automation-evidence-dashboard-design.md
```

Expected: no matches.

- [ ] **Step 4: Run final focused verification**

Run:

```powershell
npm test -- --run test/approval-desk-evidence-report.test.ts test/approval-desk-http.test.ts test/approval-desk-ui.test.ts test/demo-approval-desk.test.ts test/approval-desk-entrypoint.test.ts test/domain.test.ts test/triage-service.test.ts test/server.test.ts test/runtime.test.ts
npm run build
npm run evaluate
git diff --check
git diff --check origin/codex/approval-desk-design..HEAD
git status --short
```

Expected:

- focused tests pass;
- build passes;
- evaluation reports 30 tickets and `approvalSafetyViolations: 0`;
- both whitespace checks pass;
- status shows only intended docs changes before commit.

The full `npm test` command can still expose the known Windows fixture
byte-for-byte line-ending failure. If it appears, report it explicitly and do
not treat it as a Phase 2 regression.

- [ ] **Step 5: Commit**

Run:

```powershell
git add -- README.md docs/demo-script.md
git commit -m "docs: add evidence dashboard demo walkthrough"
```

## Task 6: Final Branch Review

**Files:**
- No code changes unless review finds a defect.

- [ ] **Step 1: Request final review**

Ask a fresh reviewer to inspect `origin/codex/approval-desk-design..HEAD` for:

- `/api/evidence` correctness;
- dashboard escaping and refresh behavior;
- demo runner reset safety;
- docs accuracy;
- local-only synthetic-data boundary preservation.

- [ ] **Step 2: Fix review findings**

For each valid finding:

1. write or update a failing test;
2. run it to confirm the failure;
3. implement the fix;
4. rerun the focused suite;
5. commit with a `fix:` message.

- [ ] **Step 3: Prepare publish summary**

Run:

```powershell
git log --oneline origin/codex/approval-desk-design..HEAD
git status --short
```

Expected: Phase 2 commits only; working tree clean.
