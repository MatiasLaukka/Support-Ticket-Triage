# Approval Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local browser Approval Desk that displays support-ticket recommendations, requires explicit human approval or rejection, and proves the existing governed service enforces and audits the decision.

**Architecture:** Add a dependency factory shared by the MCP stdio entrypoint and the Approval Desk. Add a deterministic recommendation builder for demo tickets, then expose a local HTTP API and plain browser UI that call the existing repositories and `TriageService`. All state-changing paths must use `TriageService.submit`, `TriageService.approve`, or `TriageService.reject`.

**Tech Stack:** Node.js built-in `http`, TypeScript ESM, existing JSON/Markdown repositories, existing `TriageService`, Zod/domain schemas, Vitest, built-in browser `fetch`.

---

## File Structure

- Create `src/runtime.ts`: shared environment parsing and dependency construction for both stdio MCP and Approval Desk entrypoints.
- Modify `src/index.ts`: use `createRuntimeDependencies` from `src/runtime.ts` and keep stdio-only startup logic.
- Create `src/approval-desk/recommendation-builder.ts`: deterministic demo recommendation input builder based on tickets plus `data/seed/expected-outcomes.json`.
- Create `src/approval-desk/http.ts`: Node HTTP app, JSON routing, domain-safe errors, API endpoint handlers, and static UI serving.
- Create `src/approval-desk/ui.ts`: HTML, CSS, and browser JavaScript as a TypeScript string export.
- Create `src/approval-desk.ts`: local HTTP entrypoint with host/port parsing and startup logging.
- Create `test/runtime.test.ts`: shared runtime config tests.
- Create `test/approval-desk-recommendation.test.ts`: recommendation builder tests.
- Create `test/approval-desk-http.test.ts`: endpoint and safety tests.
- Modify `package.json`: add `approval-desk` script.
- Modify `README.md` and `docs/demo-script.md`: document how to run and present the browser workflow.

## Task 1: Shared Runtime Dependencies

**Files:**
- Create: `src/runtime.ts`
- Modify: `src/index.ts`
- Test: `test/runtime.test.ts`

- [ ] **Step 1: Write failing runtime tests**

Create `test/runtime.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRuntimeDependencies,
  environmentPath,
  minutesSaved,
} from "../src/runtime.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("runtime configuration", () => {
  it("rejects blank configured paths with safe messages", () => {
    expect(() =>
      environmentPath("TRIAGE_DATA_ROOT", "data/runtime", {
        TRIAGE_DATA_ROOT: "   ",
      }),
    ).toThrow("TRIAGE_DATA_ROOT must not be blank.");
  });

  it("parses nonnegative minutes saved", () => {
    expect(minutesSaved({ TRIAGE_MINUTES_SAVED: "12" })).toBe(12);
    expect(() => minutesSaved({ TRIAGE_MINUTES_SAVED: "-1" })).toThrow(
      "TRIAGE_MINUTES_SAVED must be a finite nonnegative number.",
    );
  });

  it("creates initialized repositories and service dependencies", async () => {
    const root = await mkdtemp(join(tmpdir(), "triage-runtime-test-"));
    temporaryRoots.push(root);

    const deps = await createRuntimeDependencies({
      cwd: process.cwd(),
      env: {
        TRIAGE_DATA_ROOT: root,
        TRIAGE_SEED_FILE: resolve("data/seed/tickets.json"),
        TRIAGE_KNOWLEDGE_ROOT: resolve("data/knowledge"),
        TRIAGE_MINUTES_SAVED: "8",
      },
      now: () => new Date("2026-06-10T09:00:00.000Z"),
    });

    await expect(deps.tickets.get("TKT-1005")).resolves.toMatchObject({
      id: "TKT-1005",
      revision: 0,
    });
    expect(deps.minutesPerAcceptedRecommendation).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run test/runtime.test.ts
```

Expected: fails because `src/runtime.ts` does not exist.

- [ ] **Step 3: Create shared runtime implementation**

Create `src/runtime.ts`:

```ts
import { resolve } from "node:path";
import { AuditRepository } from "./audit-repository.js";
import { KnowledgeRepository } from "./knowledge-repository.js";
import { RecommendationRepository } from "./recommendation-repository.js";
import { TicketRepository } from "./ticket-repository.js";
import { TriageService } from "./triage-service.js";

const DEFAULT_MINUTES_SAVED = 8;
const STARTUP_PATH_MESSAGES = {
  TRIAGE_DATA_ROOT: "TRIAGE_DATA_ROOT must not be blank.",
  TRIAGE_SEED_FILE: "TRIAGE_SEED_FILE must not be blank.",
  TRIAGE_KNOWLEDGE_ROOT: "TRIAGE_KNOWLEDGE_ROOT must not be blank.",
} as const;

export class StartupConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StartupConfigError";
  }
}

export interface RuntimeEnvironment {
  TRIAGE_DATA_ROOT?: string;
  TRIAGE_SEED_FILE?: string;
  TRIAGE_KNOWLEDGE_ROOT?: string;
  TRIAGE_MINUTES_SAVED?: string;
}

export interface RuntimeOptions {
  cwd: string;
  env: RuntimeEnvironment;
  now?: () => Date;
}

export function environmentPath(
  name: keyof typeof STARTUP_PATH_MESSAGES,
  fallback: string,
  env: RuntimeEnvironment,
  cwd = process.cwd(),
): string {
  const configured = env[name];
  if (configured !== undefined && configured.trim() === "") {
    throw new StartupConfigError(STARTUP_PATH_MESSAGES[name]);
  }
  return resolve(cwd, configured ?? fallback);
}

export function minutesSaved(env: RuntimeEnvironment): number {
  const configured = env.TRIAGE_MINUTES_SAVED;
  if (configured === undefined) {
    return DEFAULT_MINUTES_SAVED;
  }
  if (configured.trim() === "") {
    throw new StartupConfigError(
      "TRIAGE_MINUTES_SAVED must be a finite nonnegative number.",
    );
  }
  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new StartupConfigError(
      "TRIAGE_MINUTES_SAVED must be a finite nonnegative number.",
    );
  }
  return parsed;
}

export async function createRuntimeDependencies(options: RuntimeOptions) {
  const dataRoot = environmentPath(
    "TRIAGE_DATA_ROOT",
    "data/runtime",
    options.env,
    options.cwd,
  );
  const seedFile = environmentPath(
    "TRIAGE_SEED_FILE",
    "data/seed/tickets.json",
    options.env,
    options.cwd,
  );
  const knowledgeRoot = environmentPath(
    "TRIAGE_KNOWLEDGE_ROOT",
    "data/knowledge",
    options.env,
    options.cwd,
  );
  const now = options.now ?? (() => new Date());
  const tickets = new TicketRepository(dataRoot, seedFile);
  await tickets.initialize();
  const knowledge = new KnowledgeRepository(knowledgeRoot);
  const recommendations = new RecommendationRepository(
    resolve(dataRoot, "recommendations"),
  );
  const audits = new AuditRepository(resolve(dataRoot, "audit", "events.jsonl"));
  const service = new TriageService({ tickets, recommendations, audit: audits, now });

  return {
    dataRoot,
    seedFile,
    knowledgeRoot,
    tickets,
    knowledge,
    recommendations,
    audits,
    service,
    now,
    minutesPerAcceptedRecommendation: minutesSaved(options.env),
  };
}
```

- [ ] **Step 4: Refactor stdio entrypoint to use runtime factory**

Replace repository construction in `src/index.ts` with:

```ts
import process from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DomainError } from "./errors.js";
import {
  createRuntimeDependencies,
  StartupConfigError,
} from "./runtime.js";
import { createTriageServer } from "./server.js";

function safeErrorDetail(error: unknown): string {
  if (error instanceof StartupConfigError || error instanceof DomainError) {
    return error.message;
  }
  return "Unexpected startup error.";
}

async function main(): Promise<void> {
  const deps = await createRuntimeDependencies({
    cwd: process.cwd(),
    env: process.env,
  });
  const server = createTriageServer(deps);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error("Support ticket triage server failed to start.");
  console.error(safeErrorDetail(error));
  process.exitCode = 1;
});
```

- [ ] **Step 5: Run focused and entrypoint tests**

Run:

```powershell
npm test -- --run test/runtime.test.ts test/entrypoint.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add -- src/runtime.ts src/index.ts test/runtime.test.ts
git commit -m "refactor: share triage runtime dependencies"
```

## Task 2: Deterministic Recommendation Builder

**Files:**
- Create: `src/approval-desk/recommendation-builder.ts`
- Test: `test/approval-desk-recommendation.test.ts`

- [ ] **Step 1: Write failing builder tests**

Create `test/approval-desk-recommendation.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildApprovalDeskRecommendationInput,
  loadExpectedOutcomes,
} from "../src/approval-desk/recommendation-builder.js";
import { TicketSchema } from "../src/domain.js";

async function ticket(id: string) {
  const tickets = JSON.parse(
    await readFile(resolve("data/seed/tickets.json"), "utf8"),
  ) as unknown[];
  return TicketSchema.parse(tickets.find((candidate) => (candidate as { id?: string }).id === id));
}

describe("approval desk recommendation builder", () => {
  it("loads expected outcomes by ticket ID", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    expect(outcomes.get("TKT-1005")).toMatchObject({
      category: "authentication",
      team: "identity",
      knowledgeArticleIds: ["account-access", "triage-policy"],
    });
  });

  it("builds a pending recommendation input from fixture expectations", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const input = buildApprovalDeskRecommendationInput({
      ticket: await ticket("TKT-1005"),
      outcome: outcomes.get("TKT-1005")!,
      actor: "approval-desk",
    });

    expect(input).toMatchObject({
      ticketId: "TKT-1005",
      sourceRevision: 0,
      category: "authentication",
      priority: "P2",
      team: "identity",
      knowledgeArticleIds: ["account-access", "triage-policy"],
      actor: "approval-desk",
    });
    expect(input.tags).toContain("prompt-injection");
    expect(input.rationale).toContain("TKT-1005");
    expect(input.draftCustomerResponse).toContain("investigating");
  });

  it("fails clearly when no expected outcome exists", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    expect(() =>
      buildApprovalDeskRecommendationInput({
        ticket: {
          ...(await ticket("TKT-1005")),
          id: "TKT-9999",
        },
        outcome: outcomes.get("TKT-9999"),
        actor: "approval-desk",
      }),
    ).toThrow("No expected outcome exists for TKT-9999.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run test/approval-desk-recommendation.test.ts
```

Expected: fails because `src/approval-desk/recommendation-builder.ts` does not exist.

- [ ] **Step 3: Implement recommendation builder**

Create `src/approval-desk/recommendation-builder.ts`:

```ts
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  CategorySchema,
  PrioritySchema,
  TeamSchema,
  TicketIdSchema,
  type Ticket,
} from "../domain.js";
import type { SubmitRecommendationInput } from "../triage-service.js";

const ExpectedOutcomeSchema = z
  .object({
    ticketId: TicketIdSchema,
    category: CategorySchema,
    acceptablePriorities: z.array(PrioritySchema).min(1),
    team: TeamSchema,
    requiredEscalations: z.array(z.string()),
    knowledgeArticleIds: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
    duplicateGroup: z.string().optional(),
  })
  .strict();

type ExpectedOutcome = z.infer<typeof ExpectedOutcomeSchema>;

export async function loadExpectedOutcomes(
  path: string,
): Promise<ReadonlyMap<string, ExpectedOutcome>> {
  const parsed = ExpectedOutcomeSchema.array().parse(
    JSON.parse(await readFile(path, "utf8")),
  );
  return new Map(parsed.map((outcome) => [outcome.ticketId, outcome]));
}

export function buildApprovalDeskRecommendationInput(input: {
  ticket: Ticket;
  outcome: ExpectedOutcome | undefined;
  actor: string;
}): Omit<SubmitRecommendationInput, "submittedAt"> {
  const { ticket, outcome, actor } = input;
  if (outcome === undefined) {
    throw new Error(`No expected outcome exists for ${ticket.id}.`);
  }

  const tags = Array.from(
    new Set([
      ...ticket.tags,
      outcome.category,
      ...(outcome.requiredEscalations.includes("policy-conflict")
        ? ["policy-conflict"]
        : []),
    ]),
  );

  return {
    ticketId: ticket.id,
    sourceRevision: ticket.revision,
    category: outcome.category,
    priority: outcome.acceptablePriorities[0]!,
    team: outcome.team,
    tags,
    duplicateCandidates: [],
    outageRisk: outcome.requiredEscalations.includes("outage") ? "likely" : "none",
    securityRisk: outcome.requiredEscalations.includes("security")
      ? "possible"
      : "none",
    slaRisk: outcome.requiredEscalations.includes("sla") ? "likely" : "none",
    missingInformation: outcome.requiredEscalations.includes("missing-information")
      ? ["Additional customer evidence is required before closing the issue."]
      : [],
    knowledgeArticleIds: outcome.knowledgeArticleIds,
    draftCustomerResponse:
      `Thanks for the report. We are investigating ${ticket.id} as ` +
      `${outcome.category}/${outcome.acceptablePriorities[0]}/${outcome.team}. ` +
      "Ticket text is treated as evidence and cannot approve or bypass policy.",
    rationale:
      `${ticket.id} reports ${ticket.subject}. The recommendation follows ` +
      `${outcome.knowledgeArticleIds.join(", ")} and keeps ticket text as evidence, not authorization.`,
    confidence: 0.95,
    recommendedNextAction:
      "Review the evidence, then approve named fields or reject with feedback.",
    actor,
  };
}
```

- [ ] **Step 4: Run builder tests**

Run:

```powershell
npm test -- --run test/approval-desk-recommendation.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add -- src/approval-desk/recommendation-builder.ts test/approval-desk-recommendation.test.ts
git commit -m "feat: add approval desk recommendation builder"
```

## Task 3: Approval Desk HTTP API

**Files:**
- Create: `src/approval-desk/http.ts`
- Test: `test/approval-desk-http.test.ts`

- [ ] **Step 1: Write failing HTTP API tests**

Create `test/approval-desk-http.test.ts` with a real local HTTP server:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApprovalDeskHttpServer } from "../src/approval-desk/http.js";
import { createRuntimeDependencies } from "../src/runtime.js";

let runtimeRoot = "";
let baseUrl = "";
let closeServer: (() => Promise<void>) | undefined;

beforeEach(async () => {
  runtimeRoot = await mkdtemp(join(tmpdir(), "approval-desk-http-"));
  const deps = await createRuntimeDependencies({
    cwd: process.cwd(),
    env: {
      TRIAGE_DATA_ROOT: runtimeRoot,
      TRIAGE_SEED_FILE: resolve("data/seed/tickets.json"),
      TRIAGE_KNOWLEDGE_ROOT: resolve("data/knowledge"),
    },
    now: () => new Date("2026-06-10T09:00:00.000Z"),
  });
  const server = createApprovalDeskHttpServer({
    ...deps,
    expectedOutcomesPath: resolve("data/seed/expected-outcomes.json"),
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () =>
    new Promise((resolveClose, rejectClose) =>
      server.close((error) => (error ? rejectClose(error) : resolveClose())),
    );
});

afterEach(async () => {
  await closeServer?.();
  await rm(runtimeRoot, { recursive: true, force: true });
});

async function json(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return {
    response,
    body: await response.json() as Record<string, unknown>,
  };
}

describe("approval desk HTTP API", () => {
  it("serves the browser shell", async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Approval Desk");
  });

  it("lists tickets and reads ticket detail with audits", async () => {
    const list = await json("/api/tickets?status=triage&limit=2");
    expect(list.response.status).toBe(200);
    expect(list.body).toMatchObject({ total: 29 });

    const detail = await json("/api/tickets/TKT-1005");
    expect(detail.response.status).toBe(200);
    expect(detail.body).toMatchObject({
      ticket: { id: "TKT-1005", revision: 0 },
      audits: { total: 0 },
    });
  });

  it("creates a pending recommendation without changing the ticket", async () => {
    const create = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk-test" }),
    });
    expect(create.response.status).toBe(201);
    expect(create.body).toMatchObject({
      recommendation: {
        ticketId: "TKT-1005",
        resolution: "pending",
        category: "authentication",
      },
    });

    const detail = await json("/api/tickets/TKT-1005");
    expect(detail.body).toMatchObject({ ticket: { revision: 0 } });
  });

  it("rejects stale approval without success audit", async () => {
    const create = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk-test" }),
    });
    const recommendation = create.body.recommendation as { id: string };

    const stale = await json(`/api/recommendations/${recommendation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1005",
        expectedRevision: 999,
        approvedFields: ["priority"],
        actor: "approval-desk-test",
        confirm: true,
      }),
    });
    expect(stale.response.status).toBe(409);
    expect(stale.body).toMatchObject({
      error: { code: "STALE_APPROVAL", message: "Approval revision is stale." },
    });

    const detail = await json("/api/tickets/TKT-1005");
    expect(detail.body).toMatchObject({ ticket: { revision: 0 } });
    expect((detail.body.audits as { events: unknown[] }).events).toHaveLength(1);
  });

  it("approves selected fields and records an audit event", async () => {
    const create = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk-test" }),
    });
    const recommendation = create.body.recommendation as { id: string };

    const approval = await json(`/api/recommendations/${recommendation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1005",
        expectedRevision: 0,
        approvedFields: ["category", "customerResponse"],
        editedCustomerResponse: "Approved local demo response.",
        actor: "matias-reviewer",
        confirm: true,
      }),
    });
    expect(approval.response.status).toBe(200);
    expect(approval.body).toMatchObject({
      ticket: { id: "TKT-1005", revision: 1 },
      auditEvent: {
        action: "recommendation-approved",
        actor: "matias-reviewer",
      },
    });
  });

  it("rejects with feedback without changing ticket fields", async () => {
    const create = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk-test" }),
    });
    const recommendation = create.body.recommendation as { id: string };

    const rejection = await json(`/api/recommendations/${recommendation.id}/reject`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1005",
        actor: "matias-reviewer",
        feedback: "Need stronger policy-conflict explanation.",
      }),
    });
    expect(rejection.response.status).toBe(200);
    expect(rejection.body).toMatchObject({
      auditEvent: {
        action: "recommendation-rejected",
        actor: "matias-reviewer",
        result: "rejected",
      },
    });

    const detail = await json("/api/tickets/TKT-1005");
    expect(detail.body).toMatchObject({ ticket: { revision: 0 } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run test/approval-desk-http.test.ts
```

Expected: fails because `src/approval-desk/http.ts` does not exist.

- [ ] **Step 3: Implement HTTP app**

Create `src/approval-desk/http.ts` with:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { z } from "zod";
import {
  CategorySchema,
  PrioritySchema,
  TeamSchema,
  TicketStatusSchema,
} from "../domain.js";
import { DomainError } from "../errors.js";
import { calculateQueueMetrics } from "../metrics.js";
import type { createRuntimeDependencies } from "../runtime.js";
import {
  buildApprovalDeskRecommendationInput,
  loadExpectedOutcomes,
} from "./recommendation-builder.js";
import { approvalDeskHtml } from "./ui.js";

type RuntimeDeps = Awaited<ReturnType<typeof createRuntimeDependencies>>;

const TicketListQuerySchema = z.object({
  status: TicketStatusSchema.optional(),
  category: CategorySchema.optional(),
  priority: PrioritySchema.optional(),
  team: TeamSchema.optional(),
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const ActorSchema = z.object({ actor: z.string().trim().min(1).default("approval-desk") });
const ApprovalBodySchema = z.object({
  ticketId: z.string(),
  expectedRevision: z.number().int().nonnegative(),
  approvedFields: z.array(z.enum([
    "category",
    "priority",
    "team",
    "assignee",
    "status",
    "tags",
    "customerResponse",
  ])).min(1),
  editedCustomerResponse: z.string().trim().min(1).optional(),
  actor: z.string().trim().min(1),
  confirm: z.literal(true),
});
const RejectionBodySchema = z.object({
  ticketId: z.string(),
  actor: z.string().trim().min(1),
  feedback: z.string().trim().min(1),
});

export interface ApprovalDeskHttpOptions extends RuntimeDeps {
  expectedOutcomesPath?: string;
}

export function createApprovalDeskHttpServer(options: ApprovalDeskHttpOptions) {
  const expectedOutcomesPath =
    options.expectedOutcomesPath ?? resolve("data/seed/expected-outcomes.json");

  return createServer(async (request, response) => {
    try {
      await route(request, response, options, expectedOutcomesPath);
    } catch (error) {
      writeError(response, error);
    }
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  deps: ApprovalDeskHttpOptions,
  expectedOutcomesPath: string,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/") {
    writeText(response, 200, approvalDeskHtml, "text/html; charset=utf-8");
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/tickets") {
    const query = TicketListQuerySchema.parse(Object.fromEntries(url.searchParams));
    writeJson(response, 200, await deps.tickets.list(query));
    return;
  }
  const ticketMatch = /^\/api\/tickets\/(TKT-\d{4})$/.exec(url.pathname);
  if (request.method === "GET" && ticketMatch) {
    const ticketId = ticketMatch[1]!;
    writeJson(response, 200, {
      ticket: await deps.tickets.get(ticketId),
      audits: await deps.audits.listPage({ ticketId, offset: 0, limit: 10 }),
    });
    return;
  }
  const recommendationCreateMatch =
    /^\/api\/tickets\/(TKT-\d{4})\/recommendations$/.exec(url.pathname);
  if (request.method === "POST" && recommendationCreateMatch) {
    const ticketId = recommendationCreateMatch[1]!;
    const body = ActorSchema.parse(await readJson(request));
    const ticket = await deps.tickets.get(ticketId);
    const outcomes = await loadExpectedOutcomes(expectedOutcomesPath);
    const recommendation = await deps.service.submit({
      ...buildApprovalDeskRecommendationInput({
        ticket,
        outcome: outcomes.get(ticketId),
        actor: body.actor,
      }),
      submittedAt: deps.now().toISOString(),
    });
    writeJson(response, 201, { recommendation });
    return;
  }
  const recommendationMatch = /^\/api\/recommendations\/([0-9a-f-]+)$/.exec(
    url.pathname,
  );
  if (request.method === "GET" && recommendationMatch) {
    writeJson(response, 200, {
      recommendation: await deps.recommendations.get(recommendationMatch[1]!),
    });
    return;
  }
  const approveMatch = /^\/api\/recommendations\/([0-9a-f-]+)\/approve$/.exec(
    url.pathname,
  );
  if (request.method === "POST" && approveMatch) {
    const body = ApprovalBodySchema.parse(await readJson(request));
    writeJson(response, 200, await deps.service.approve({
      ...body,
      recommendationId: approveMatch[1]!,
      approvedAt: deps.now().toISOString(),
    }));
    return;
  }
  const rejectMatch = /^\/api\/recommendations\/([0-9a-f-]+)\/reject$/.exec(
    url.pathname,
  );
  if (request.method === "POST" && rejectMatch) {
    const body = RejectionBodySchema.parse(await readJson(request));
    writeJson(response, 200, {
      auditEvent: await deps.service.reject({
        ...body,
        recommendationId: rejectMatch[1]!,
        rejectedAt: deps.now().toISOString(),
      }),
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/metrics") {
    const [tickets, recommendations] = await Promise.all([
      deps.tickets.snapshot(),
      deps.recommendations.list(),
    ]);
    writeJson(response, 200, calculateQueueMetrics({
      tickets,
      recommendations,
      now: deps.now(),
      minutesPerAcceptedRecommendation: deps.minutesPerAcceptedRecommendation,
    }));
    return;
  }
  writeJson(response, 404, { error: { code: "NOT_FOUND", message: "Route not found." } });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeText(
  response: ServerResponse,
  status: number,
  body: string,
  contentType: string,
): void {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function writeError(response: ServerResponse, error: unknown): void {
  if (error instanceof DomainError) {
    const status = error.code.startsWith("STALE") ? 409 : 400;
    writeJson(response, status, {
      error: { code: error.code, message: error.message },
    });
    return;
  }
  if (error instanceof z.ZodError) {
    writeJson(response, 400, {
      error: { code: "INVALID_REQUEST", message: error.issues[0]?.message ?? "Invalid request." },
    });
    return;
  }
  writeJson(response, 500, {
    error: { code: "APPROVAL_DESK_ERROR", message: "Unexpected local approval desk error." },
  });
}
```

- [ ] **Step 4: Add temporary UI export used by HTTP test**

Create `src/approval-desk/ui.ts`:

```ts
export const approvalDeskHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Approval Desk</title>
  </head>
  <body>
    <h1>Approval Desk</h1>
    <p>Human review required before ticket mutation.</p>
  </body>
</html>`;
```

- [ ] **Step 5: Run HTTP tests**

Run:

```powershell
npm test -- --run test/approval-desk-http.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add -- src/approval-desk/http.ts src/approval-desk/ui.ts test/approval-desk-http.test.ts
git commit -m "feat: add approval desk HTTP API"
```

## Task 4: Browser Approval Desk UI

**Files:**
- Modify: `src/approval-desk/ui.ts`
- Test: `test/approval-desk-ui.test.ts`

- [ ] **Step 1: Write failing UI content tests**

Create `test/approval-desk-ui.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { approvalDeskHtml } from "../src/approval-desk/ui.js";

describe("approval desk UI shell", () => {
  it("contains the human approval controls and safety language", () => {
    expect(approvalDeskHtml).toContain("Approval Desk");
    expect(approvalDeskHtml).toContain("No ticket changes happen until approval succeeds");
    expect(approvalDeskHtml).toContain("Approve selected fields");
    expect(approvalDeskHtml).toContain("Reject recommendation");
    expect(approvalDeskHtml).toContain("customerResponse");
    expect(approvalDeskHtml).toContain("prompt-injection");
  });

  it("uses only local API routes", () => {
    expect(approvalDeskHtml).toContain("/api/tickets");
    expect(approvalDeskHtml).toContain("/api/metrics");
    expect(approvalDeskHtml).not.toContain("https://");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run test/approval-desk-ui.test.ts
```

Expected: fails because the temporary UI lacks the required controls.

- [ ] **Step 3: Replace UI with functional browser app**

Replace `src/approval-desk/ui.ts` with a full HTML string containing:

```ts
export const approvalDeskHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Approval Desk</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #f6f7fb; color: #172033; }
    header { padding: 24px 32px; background: #111827; color: white; }
    main { display: grid; grid-template-columns: 320px 1fr; gap: 20px; padding: 20px; }
    section { background: white; border: 1px solid #dde3ee; border-radius: 14px; padding: 18px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
    button { border: 0; border-radius: 10px; padding: 10px 14px; background: #2563eb; color: white; cursor: pointer; }
    button.secondary { background: #4b5563; }
    button.danger { background: #b91c1c; }
    button:disabled { background: #9ca3af; cursor: not-allowed; }
    input, textarea, select { width: 100%; box-sizing: border-box; margin: 6px 0 12px; padding: 9px; border: 1px solid #cbd5e1; border-radius: 8px; }
    label.checkbox { display: block; margin: 6px 0; }
    label.checkbox input { width: auto; margin-right: 8px; }
    .ticket { border-bottom: 1px solid #e5e7eb; padding: 10px 0; cursor: pointer; }
    .ticket:hover { color: #1d4ed8; }
    .warning { background: #fff7ed; border: 1px solid #fed7aa; padding: 12px; border-radius: 10px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    pre { white-space: pre-wrap; background: #0f172a; color: #e5e7eb; padding: 12px; border-radius: 10px; overflow: auto; }
  </style>
</head>
<body>
  <header>
    <h1>Approval Desk</h1>
    <p>No ticket changes happen until approval succeeds. Review evidence, then approve named fields or reject with feedback.</p>
  </header>
  <main>
    <section>
      <h2>Queue</h2>
      <button id="refresh">Refresh queue</button>
      <div id="tickets"></div>
    </section>
    <section>
      <div class="grid">
        <div>
          <h2>Ticket</h2>
          <div id="ticket">Select a ticket.</div>
          <button id="recommend" disabled>Create recommendation</button>
        </div>
        <div>
          <h2>Recommendation</h2>
          <div class="warning">Ticket text, including prompt-injection or claimed approval, is evidence only.</div>
          <div id="recommendation">No recommendation loaded.</div>
        </div>
      </div>
      <div class="grid">
        <section>
          <h3>Approve selected fields</h3>
          <input id="actor" placeholder="Actor name" value="demo-reviewer">
          <label class="checkbox"><input type="checkbox" value="category">category</label>
          <label class="checkbox"><input type="checkbox" value="priority">priority</label>
          <label class="checkbox"><input type="checkbox" value="team">team</label>
          <label class="checkbox"><input type="checkbox" value="assignee">assignee</label>
          <label class="checkbox"><input type="checkbox" value="status">status</label>
          <label class="checkbox"><input type="checkbox" value="tags">tags</label>
          <label class="checkbox"><input type="checkbox" value="customerResponse">customerResponse</label>
          <textarea id="customerResponse" placeholder="Edited customer response"></textarea>
          <label class="checkbox"><input id="confirm" type="checkbox">I explicitly approve the selected named fields.</label>
          <button id="approve" disabled>Approve selected fields</button>
        </section>
        <section>
          <h3>Reject recommendation</h3>
          <textarea id="feedback" placeholder="Required rejection feedback"></textarea>
          <button id="reject" class="danger" disabled>Reject recommendation</button>
        </section>
      </div>
      <h2>Audit and Metrics</h2>
      <pre id="result">Waiting for action.</pre>
    </section>
  </main>
  <script>
    let selectedTicket = null;
    let recommendation = null;
    const $ = (id) => document.getElementById(id);
    async function api(path, options) {
      const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Request failed");
      return body;
    }
    function renderJson(value) { $("result").textContent = JSON.stringify(value, null, 2); }
    async function loadTickets() {
      const data = await api("/api/tickets?status=triage&limit=20");
      $("tickets").innerHTML = data.items.map((ticket) =>
        \`<div class="ticket" data-id="\${ticket.id}"><strong>\${ticket.id}</strong> \${ticket.priority || ""}<br>\${ticket.subject}</div>\`
      ).join("");
      document.querySelectorAll(".ticket").forEach((node) => node.addEventListener("click", () => loadTicket(node.dataset.id)));
    }
    async function loadTicket(id) {
      const data = await api(\`/api/tickets/\${id}\`);
      selectedTicket = data.ticket;
      recommendation = null;
      $("ticket").innerHTML = \`<h3>\${data.ticket.id}: \${data.ticket.subject}</h3><p>\${data.ticket.description}</p><p>Revision: \${data.ticket.revision}</p><p>Tags: \${data.ticket.tags.join(", ")}</p>\`;
      $("recommendation").textContent = "No recommendation loaded.";
      $("recommend").disabled = false;
      renderJson({ audits: data.audits.events });
      syncButtons();
    }
    async function createRecommendation() {
      const data = await api(\`/api/tickets/\${selectedTicket.id}/recommendations\`, {
        method: "POST",
        body: JSON.stringify({ actor: $("actor").value || "approval-desk" }),
      });
      recommendation = data.recommendation;
      $("recommendation").innerHTML = \`<p><strong>\${recommendation.category}/\${recommendation.priority}/\${recommendation.team}</strong></p><p>Confidence: \${recommendation.confidence}</p><p>Citations: \${recommendation.knowledgeArticleIds.join(", ")}</p><p>Escalations: \${recommendation.escalationReasons.join(", ") || "none"}</p><p>Rationale: \${recommendation.rationale}</p><p>Draft response: \${recommendation.draftCustomerResponse}</p><p>Resolution: \${recommendation.resolution}</p>\`;
      $("customerResponse").value = recommendation.draftCustomerResponse;
      renderJson(data);
      syncButtons();
    }
    function selectedFields() {
      return Array.from(document.querySelectorAll("input[type=checkbox][value]:checked")).map((input) => input.value);
    }
    function syncButtons() {
      const hasRecommendation = Boolean(recommendation && selectedTicket);
      $("approve").disabled = !(hasRecommendation && $("actor").value.trim() && $("confirm").checked && selectedFields().length > 0);
      $("reject").disabled = !(hasRecommendation && $("actor").value.trim() && $("feedback").value.trim());
    }
    async function approve() {
      const fields = selectedFields();
      const body = { ticketId: selectedTicket.id, expectedRevision: selectedTicket.revision, approvedFields: fields, actor: $("actor").value, confirm: true };
      if (fields.includes("customerResponse")) body.editedCustomerResponse = $("customerResponse").value;
      const data = await api(\`/api/recommendations/\${recommendation.id}/approve\`, { method: "POST", body: JSON.stringify(body) });
      renderJson(data);
      await loadTicket(selectedTicket.id);
    }
    async function reject() {
      const data = await api(\`/api/recommendations/\${recommendation.id}/reject\`, {
        method: "POST",
        body: JSON.stringify({ ticketId: selectedTicket.id, actor: $("actor").value, feedback: $("feedback").value }),
      });
      renderJson(data);
      await loadTicket(selectedTicket.id);
    }
    $("refresh").addEventListener("click", loadTickets);
    $("recommend").addEventListener("click", createRecommendation);
    $("approve").addEventListener("click", approve);
    $("reject").addEventListener("click", reject);
    document.addEventListener("input", syncButtons);
    loadTickets().catch((error) => renderJson({ error: error.message }));
  </script>
</body>
</html>`;
```

- [ ] **Step 4: Run UI and HTTP tests**

Run:

```powershell
npm test -- --run test/approval-desk-ui.test.ts test/approval-desk-http.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add -- src/approval-desk/ui.ts test/approval-desk-ui.test.ts
git commit -m "feat: add approval desk browser UI"
```

## Task 5: Approval Desk Entrypoint And Script

**Files:**
- Create: `src/approval-desk.ts`
- Modify: `package.json`
- Test: `test/approval-desk-entrypoint.test.ts`

- [ ] **Step 1: Write failing entrypoint tests**

Create `test/approval-desk-entrypoint.test.ts`:

```ts
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("approval desk entrypoint", () => {
  it("starts local HTTP server and serves the UI", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "approval-desk-entry-"));
    roots.push(dataRoot);
    const child = spawn(process.execPath, [resolve("dist/src/approval-desk.js")], {
      env: {
        ...process.env,
        TRIAGE_DATA_ROOT: dataRoot,
        TRIAGE_SEED_FILE: resolve("data/seed/tickets.json"),
        TRIAGE_KNOWLEDGE_ROOT: resolve("data/knowledge"),
        APPROVAL_DESK_HOST: "127.0.0.1",
        APPROVAL_DESK_PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    const url = await new Promise<string>((resolveUrl, rejectUrl) => {
      const timer = setTimeout(() => rejectUrl(new Error("server did not start")), 5000);
      child.stdout.on("data", () => {
        const match = /Approval Desk listening at (http:\/\/127\\.0\\.0\\.1:\\d+)/.exec(stdout);
        if (match) {
          clearTimeout(timer);
          resolveUrl(match[1]!);
        }
      });
      child.once("error", rejectUrl);
    });

    try {
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Approval Desk");
    } finally {
      child.kill();
      await new Promise((resolveClose) => child.once("close", resolveClose));
    }
  }, 10_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm run build
npm test -- --run test/approval-desk-entrypoint.test.ts
```

Expected: fails because `dist/src/approval-desk.js` is not produced.

- [ ] **Step 3: Implement entrypoint**

Create `src/approval-desk.ts`:

```ts
import process from "node:process";
import { DomainError } from "./errors.js";
import { createApprovalDeskHttpServer } from "./approval-desk/http.js";
import {
  createRuntimeDependencies,
  StartupConfigError,
} from "./runtime.js";

function safeErrorDetail(error: unknown): string {
  if (error instanceof StartupConfigError || error instanceof DomainError) {
    return error.message;
  }
  return "Unexpected approval desk startup error.";
}

function port(): number {
  const configured = process.env.APPROVAL_DESK_PORT ?? "5177";
  const parsed = Number(configured);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new StartupConfigError(
      "APPROVAL_DESK_PORT must be an integer from 0 to 65535.",
    );
  }
  return parsed;
}

async function main(): Promise<void> {
  const host = process.env.APPROVAL_DESK_HOST ?? "127.0.0.1";
  const deps = await createRuntimeDependencies({
    cwd: process.cwd(),
    env: process.env,
  });
  const server = createApprovalDeskHttpServer(deps);
  await new Promise<void>((resolveListen) => server.listen(port(), host, resolveListen));
  const address = server.address();
  const actualPort =
    typeof address === "object" && address !== null ? address.port : port();
  console.log(`Approval Desk listening at http://${host}:${actualPort}`);
}

main().catch((error: unknown) => {
  console.error("Approval Desk failed to start.");
  console.error(safeErrorDetail(error));
  process.exitCode = 1;
});
```

- [ ] **Step 4: Add package script**

Modify `package.json` scripts:

```json
"approval-desk": "node dist/src/approval-desk.js"
```

Keep existing scripts unchanged.

- [ ] **Step 5: Run entrypoint test**

Run:

```powershell
npm run build
npm test -- --run test/approval-desk-entrypoint.test.ts
```

Expected: test passes.

- [ ] **Step 6: Commit**

Run:

```powershell
git add -- src/approval-desk.ts package.json test/approval-desk-entrypoint.test.ts
git commit -m "feat: add approval desk entrypoint"
```

## Task 6: Documentation And Final Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/demo-script.md`

- [ ] **Step 1: Update README usage**

Add a subsection after `Use From Codex Desktop`:

````md
## Use The Local Approval Desk

The Approval Desk is a local browser UI for the human decision layer. It uses
the same synthetic fixtures, local repositories, and `TriageService` rules as
the MCP server.

```powershell
npm ci
npm run build
npm run approval-desk
```

Open the printed `http://127.0.0.1:5177` URL. Select `TKT-1005`, create a
recommendation, review the prompt-injection warning, select named fields, enter
an actor, check the explicit confirmation box, and approve. The UI then reads
back the updated ticket revision and audit event.

The app is local-only. It does not send customer responses, connect to external
support systems, or authenticate multiple users.
````

- [ ] **Step 2: Update demo script**

Add a section to `docs/demo-script.md` after the prompt-injection triage
section:

````md
## 2a. Browser Approval Desk

Run:

```powershell
npm run approval-desk
```

Expected checkpoints:

- the browser opens a local Approval Desk UI;
- selecting `TKT-1005` shows the prompt-injection ticket text;
- creating a recommendation stores a pending recommendation and does not change
  the ticket revision;
- stale approval attempts are rejected by the service if the revision is wrong;
- approving selected fields records actor, selected fields, recommendation ID,
  and a `recommendation-approved` audit event;
- rejection requires feedback and leaves ticket fields unchanged.
````

- [ ] **Step 3: Run docs search**

Run:

```powershell
rg -n "T[O]DO|T[B]D|CV|portfolio|production deployment" README.md docs/demo-script.md docs/superpowers/specs/2026-06-26-approval-desk-design.md
```

Expected: no matches.

- [ ] **Step 4: Run final verification**

Run:

```powershell
npm ci --prefer-offline --no-audit
npm run build
npm test
npm run evaluate
git diff --check
git status --short
```

Expected:

- `npm test` passes all existing and new tests;
- evaluation reports 30 tickets and `approvalSafetyViolations: 0`;
- `git diff --check` exits 0;
- `git status --short` shows only intended modified documentation before the final commit.

- [ ] **Step 5: Commit**

Run:

```powershell
git add -- README.md docs/demo-script.md
git commit -m "docs: add approval desk walkthrough"
```

## Task 7: Final Branch Review

**Files:**
- No code changes unless verification reveals a defect.

- [ ] **Step 1: Review implemented scope against spec**

Check:

- local HTTP server command exists as `npm run approval-desk`;
- UI shows ticket summary, recommendation, proposed fields, citations,
  confidence, rationale, escalation reasons, draft response, audit, and
  metrics;
- approve path requires actor, selected fields, current revision, and
  `confirm: true`;
- reject path requires actor and feedback;
- all state changes flow through `TriageService`;
- docs state local-only synthetic-data boundaries.

- [ ] **Step 2: Run complete verification again**

Run:

```powershell
npm test
npm run evaluate
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Prepare publish summary**

Run:

```powershell
git log --oneline origin/main..HEAD
git status --short
```

Expected: only the Approval Desk commits are ahead of `origin/main`; working
tree is clean.
