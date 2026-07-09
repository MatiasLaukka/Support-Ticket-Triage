# Automation Evidence Dashboard Design

## Goal

Add a Phase 2 proof layer on top of the local Approval Desk. The feature should
make the project easy to evaluate quickly: one command starts a clean local demo,
and the browser shows measurable automation evidence, guardrails, and audit
readback.

The target story is:

> This local B2B SaaS support automation prepares evidence-backed ticket
> recommendations, requires human approval for named fields, blocks unsafe or
> stale actions, records audits, and reports operational impact.

The feature remains local-only and synthetic. It must not add real Zendesk,
Jira, email, identity, paging, or customer-data integrations.

## User Experience

The Approval Desk gains an **Automation Evidence** dashboard section. It should
be visible without needing to inspect raw JSON and should update after
recommendation creation, approval, rejection, and queue refreshes.

Recommended dashboard cards:

- open tickets;
- pending recommendations;
- approved recommendations;
- rejected recommendations;
- estimated minutes saved;
- audit events;
- safety blocks;
- active guardrails.

The dashboard should also show a concise guardrails list, for example:

- recommendations do not mutate tickets;
- approval requires actor, selected fields, current/source revision, and
  `confirm: true`;
- `customerResponse` approval requires nonblank edited text;
- rejection requires actor and feedback;
- ticket text is evidence, not authorization;
- stale or replayed finalizers are rejected by the service.

Add a one-command demo script:

```powershell
npm run demo:approval-desk
```

The command should reset local runtime data safely, start the local Approval
Desk, and print the URL plus a short walkthrough. It should not open the
browser automatically in this version; printing the URL is more reliable and
easier to test on Windows.

## Architecture

### Evidence Report Builder

Create a pure report builder, for example:

```text
src/approval-desk/evidence-report.ts
```

It should accept:

- queue metrics from `calculateQueueMetrics`;
- tickets from `TicketRepository`;
- recommendations from `RecommendationRepository`;
- audit events from `AuditRepository`.

It should return stable JSON for the browser dashboard. The builder should not
read files directly and should not mutate repository state.

### Evidence API

Add:

```text
GET /api/evidence
```

The HTTP handler should combine existing repository snapshots and queue metrics,
then return the evidence report. It should use the same safe JSON error
handling as the other Approval Desk routes.

### Dashboard UI

Extend `src/approval-desk/ui.ts` with a dedicated dashboard area. The UI should
call `/api/evidence` on load and after state-changing actions. The existing
raw JSON result panel should remain available for audit/debug visibility, but
the dashboard should make the most important evidence readable at a glance.

The UI must continue to use only local relative API routes and must escape any
dynamic text rendered through HTML.

### Demo Runner

Create a script, for example:

```text
scripts/demo-approval-desk.ts
```

The script should:

1. verify it is running from the expected repository root;
2. safely reset `data/runtime` while preserving `.gitkeep`;
3. start the compiled Approval Desk entrypoint;
4. print the local URL and suggested walkthrough;
5. keep the child process attached so `Ctrl+C` stops the demo.

Add package scripts:

```json
"demo:approval-desk": "node dist/scripts/demo-approval-desk.js"
```

The existing build step remains explicit. The README can recommend:

```powershell
npm ci
npm run build
npm run demo:approval-desk
```

## Evidence Report Shape

The exact TypeScript names can follow local conventions, but the report should
include:

```ts
interface AutomationEvidenceReport {
  generatedAt: string;
  summary: {
    openTickets: number;
    pendingRecommendations: number;
    approvedRecommendations: number;
    rejectedRecommendations: number;
    estimatedMinutesSaved: number;
    auditEvents: number;
    safetyBlocks: number;
  };
  guardrails: Array<{
    id: string;
    label: string;
    status: "active";
    evidence: string;
  }>;
  recentActivity: Array<{
    timestamp: string;
    action: string;
    ticketId?: string;
    recommendationId?: string;
    result: string;
  }>;
  metrics: QueueMetrics;
}
```

`safetyBlocks` should be derived from audit events that represent blocked or
failed safety outcomes, such as stale approval failures or rejected approval
attempts. If the current audit model cannot distinguish every blocked path, the
report should count only what the repositories can prove and label it honestly.

## Data Flow

1. The user runs `npm run demo:approval-desk`.
2. The script resets local runtime data and starts the Approval Desk.
3. The browser loads `/`, `/api/tickets`, `/api/metrics`, and `/api/evidence`.
4. The user selects a ticket and creates a recommendation.
5. The HTTP API submits the recommendation through `TriageService`.
6. The UI refreshes the evidence report.
7. The user approves or rejects.
8. The HTTP API finalizes through `TriageService`.
9. The UI refreshes ticket detail, metrics, evidence, and raw action JSON.

## Error Handling

- The demo runner must refuse to reset data if the repository identity or
  runtime path checks fail.
- The demo runner should print safe, actionable startup errors and avoid raw
  stack traces for expected configuration problems.
- `/api/evidence` should reuse the existing local Approval Desk error envelope.
- The dashboard should show a readable error state if `/api/evidence` fails,
  while keeping the rest of the Approval Desk usable.

## Testing

Add focused tests for:

- evidence report builder totals and guardrails;
- `/api/evidence` response shape and safety-block counts;
- dashboard UI contains evidence dashboard cards, calls `/api/evidence`, and
  avoids external URLs;
- dashboard refresh after create, approve, and reject in the existing fake-DOM
  UI harness;
- demo runner safe reset checks and startup output, using a temporary runtime
  root or dry-run-friendly helper functions where practical.

Existing Approval Desk HTTP, UI, entrypoint, and service tests should continue
to pass. The known Windows fixture byte-for-byte line-ending issue remains
outside this Phase 2 scope unless fixed separately.

## Documentation

Update the README and demo script with:

- `npm run demo:approval-desk`;
- a short description of the Automation Evidence dashboard;
- the expected dashboard checkpoints after recommendation creation, approval,
  and rejection;
- local-only synthetic-data boundaries.

Do not frame the project as a decorative showcase. Present it as a local
automation engineering demonstration with explicit safety boundaries.
