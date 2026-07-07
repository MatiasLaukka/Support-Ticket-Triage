import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApprovalDeskHttpServer } from "../src/approval-desk/http.js";
import { createRuntimeDependencies } from "../src/runtime.js";

const now = new Date("2026-06-10T09:00:00.000Z");
const expectedOutcomesPath = resolve("data/seed/expected-outcomes.json");
const temporaryRoots: string[] = [];
const servers: Array<ReturnType<typeof createApprovalDeskHttpServer>> = [];

afterEach(async () => {
  await Promise.allSettled(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolveClose, rejectClose) => {
          server.close((error: Error | undefined) =>
            error === undefined ? resolveClose() : rejectClose(error),
          );
        }),
    ),
  );
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("createApprovalDeskHttpServer", () => {
  it("serves the temporary Approval Desk UI", async () => {
    const { baseUrl } = await startFixture();

    const response = await fetch(`${baseUrl}/`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(body).toContain("Approval Desk");
  });

  it("lists and reads tickets with audits", async () => {
    const { json } = await startFixture();

    const list = await json("/api/tickets?status=triage&limit=2");
    const detail = await json("/api/tickets/TKT-1005");

    expect(list.status).toBe(200);
    expect(list.body.total).toBe(13);
    expect(list.body.items).toHaveLength(2);
    expect(detail.status).toBe(200);
    expect(detail.body.ticket).toMatchObject({
      id: "TKT-1005",
      revision: 0,
    });
    expect(detail.body.audits).toMatchObject({
      total: 0,
      offset: 0,
      limit: 10,
      events: [],
    });
  });

  it("maps missing tickets to 404", async () => {
    const { json } = await startFixture();

    const missing = await json("/api/tickets/TKT-9999");

    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({
      error: {
        code: "TICKET_NOT_FOUND",
        message: "Ticket was not found.",
      },
    });
  });

  it("maps missing recommendations to 404", async () => {
    const { json } = await startFixture();

    const missing = await json(
      "/api/recommendations/11111111-1111-4111-8111-111111111111",
    );

    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({
      error: {
        code: "RECOMMENDATION_NOT_FOUND",
        message: "Recommendation was not found.",
      },
    });
  });

  it("creates a pending authentication recommendation without mutating the ticket", async () => {
    const { deps, json } = await startFixture();

    const created = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({}),
    });

    expect(created.status).toBe(201);
    expect(created.body.recommendation).toMatchObject({
      ticketId: "TKT-1005",
      sourceRevision: 0,
      category: "authentication",
      team: "identity",
      resolution: "pending",
      createdAt: now.toISOString(),
    });
    expect((await deps.tickets.get("TKT-1005")).revision).toBe(0);
  });

  it("reports automation evidence after recommendation submission", async () => {
    const { json } = await startFixture();
    const created = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });

    const evidence = await json("/api/evidence");

    expect(evidence.status).toBe(200);
    expect(evidence.body.generatedAt).toBe(now.toISOString());
    expect(evidence.body.summary).toEqual({
      openTickets: 29,
      pendingRecommendations: 1,
      approvedRecommendations: 0,
      rejectedRecommendations: 0,
      estimatedMinutesSaved: 0,
      auditEvents: 1,
      safetyBlocks: 0,
      activeGuardrails: 6,
    });
    expect(evidence.body.guardrails).toContainEqual(
      expect.objectContaining({
        id: "submission-is-not-mutation",
        status: "active",
      }),
    );
    expect(evidence.body.recentActivity).toContainEqual(
      expect.objectContaining({
        action: "recommendation-submitted",
        recommendationId: created.body.recommendation.id,
        result: "success",
      }),
    );
  });

  it("rejects oversized JSON request bodies before normal route handling", async () => {
    const { deps, json } = await startFixture();

    const oversized = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "x".repeat(65_536) }),
    });

    expect(oversized.status).toBe(400);
    expect(oversized.body).toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Request body must be 65536 bytes or less.",
      },
    });
    expect(await deps.recommendations.list()).toEqual([]);
    expect(
      await deps.audits.listPage({ ticketId: "TKT-1005", offset: 0, limit: 10 }),
    ).toMatchObject({ total: 0, events: [] });
  });

  it("maps stale approval to 409 and exposes the safety block in evidence", async () => {
    const { deps, json } = await startFixture();
    const created = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await deps.tickets.update("TKT-1005", 0, (ticket) => ({
      ...ticket,
      assignee: "concurrent-reviewer@example.test",
    }));

    const stale = await json(
      `/api/recommendations/${created.body.recommendation.id}/approve`,
      {
        method: "POST",
        body: JSON.stringify({
          ticketId: "TKT-1005",
          expectedRevision: 0,
          approvedFields: ["category"],
          actor: "matias-reviewer",
          confirm: true,
        }),
      },
    );
    const detail = await json("/api/tickets/TKT-1005");
    const evidence = await json("/api/evidence");

    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("STALE_APPROVAL");
    expect(detail.body.audits.events).toEqual([
      expect.objectContaining({
        action: "recommendation-submitted",
        result: "success",
      }),
      expect.objectContaining({
        action: "approval-rejected",
        recommendationId: created.body.recommendation.id,
        result: "rejected",
      }),
    ]);
    expect(evidence.status).toBe(200);
    expect(evidence.body.summary.safetyBlocks).toBe(1);
    expect(evidence.body.recentActivity).toContainEqual(
      expect.objectContaining({
        action: "approval-rejected",
        recommendationId: created.body.recommendation.id,
        result: "rejected",
      }),
    );
  });

  it("approves selected fields and records the reviewer audit", async () => {
    const { json } = await startFixture();
    const created = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });

    const approved = await json(
      `/api/recommendations/${created.body.recommendation.id}/approve`,
      {
        method: "POST",
        body: JSON.stringify({
          ticketId: "TKT-1005",
          expectedRevision: 0,
          approvedFields: ["category", "priority", "team"],
          actor: "matias-reviewer",
          confirm: true,
        }),
      },
    );

    expect(approved.status).toBe(200);
    expect(approved.body.ticket).toMatchObject({
      id: "TKT-1005",
      revision: 1,
      category: "authentication",
      priority: "P2",
      team: "identity",
    });
    expect(approved.body.auditEvent).toMatchObject({
      action: "recommendation-approved",
      actor: "matias-reviewer",
    });
  });

  it("rejects customer response approval without edited customer text", async () => {
    const { deps, json } = await startFixture();
    const created = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });

    const rejected = await json(
      `/api/recommendations/${created.body.recommendation.id}/approve`,
      {
        method: "POST",
        body: JSON.stringify({
          ticketId: "TKT-1005",
          expectedRevision: 0,
          approvedFields: ["customerResponse"],
          actor: "matias-reviewer",
          confirm: true,
        }),
      },
    );

    expect(rejected.status).toBe(400);
    expect(rejected.body).toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "editedCustomerResponse is required when customerResponse is approved.",
      },
    });
    expect((await deps.recommendations.get(created.body.recommendation.id))).toMatchObject({
      resolution: "pending",
    });
    expect((await deps.tickets.get("TKT-1005")).revision).toBe(0);
  });

  it("rejects with feedback and leaves the ticket unchanged", async () => {
    const { deps, json } = await startFixture();
    const created = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });

    const rejected = await json(
      `/api/recommendations/${created.body.recommendation.id}/reject`,
      {
        method: "POST",
        body: JSON.stringify({
          ticketId: "TKT-1005",
          actor: "matias-reviewer",
          feedback: "Needs a human-written customer response first.",
        }),
      },
    );

    expect(rejected.status).toBe(200);
    expect(rejected.body.auditEvent).toMatchObject({
      action: "recommendation-rejected",
      actor: "matias-reviewer",
      result: "success",
      rationale: "Needs a human-written customer response first.",
    });
    expect((await deps.recommendations.get(created.body.recommendation.id))).toMatchObject({
      resolution: "rejected",
    });
    expect((await deps.tickets.get("TKT-1005")).revision).toBe(0);
  });
});

async function startFixture(): Promise<{
  deps: Awaited<ReturnType<typeof createRuntimeDependencies>>;
  baseUrl: string;
  json: (
    path: string,
    init?: RequestInit,
  ) => Promise<{ status: number; body: any; response: Response }>;
}> {
  const dataRoot = await mkdtemp(join(tmpdir(), "approval-desk-http-"));
  temporaryRoots.push(dataRoot);
  const deps = await createRuntimeDependencies({
    env: {
      TRIAGE_DATA_ROOT: dataRoot,
      TRIAGE_SEED_FILE: resolve("data/seed/tickets.json"),
      TRIAGE_KNOWLEDGE_ROOT: resolve("data/knowledge"),
    },
    now: () => now,
  });
  const server = createApprovalDeskHttpServer(deps, { expectedOutcomesPath });
  servers.push(server);
  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    deps,
    baseUrl,
    json: async (path, init) => {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { "content-type": "application/json", ...init?.headers },
        ...init,
      });
      return {
        status: response.status,
        body: await response.json(),
        response,
      };
    },
  };
}
