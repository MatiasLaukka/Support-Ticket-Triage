import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApprovalDeskHttpServer } from "../src/approval-desk/http.js";
import { AuditEventSchema } from "../src/domain.js";
import { createRuntimeDependencies } from "../src/runtime.js";

const now = new Date("2026-06-10T09:00:00.000Z");
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
    expect(detail.body.conversationHistory).toEqual([]);
  });

  it("includes recommendation summaries in ticket list responses", async () => {
    const { json } = await startFixture();
    const created = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });

    const list = await json("/api/tickets?status=triage&limit=20");

    const item = list.body.items.find((ticket: any) => ticket.id === "TKT-1005");
    expect(item.recommendationSummary).toMatchObject({
      latestRecommendationId: created.body.recommendation.id,
      latestResolution: "pending",
      hasPendingRecommendation: true,
      hasApprovedRecommendation: false,
      workflowState: "draft-ready",
    });
  });

  it("includes latest recommendation in ticket detail responses", async () => {
    const { json } = await startFixture();
    const created = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });

    const detail = await json("/api/tickets/TKT-1005");

    expect(detail.body.recommendationSummary).toMatchObject({
      latestRecommendationId: created.body.recommendation.id,
      latestResolution: "pending",
      workflowState: "draft-ready",
    });
    expect(detail.body.latestRecommendation).toMatchObject({
      id: created.body.recommendation.id,
      ticketId: "TKT-1005",
      resolution: "pending",
    });
    expect(detail.body.conversationHistory).toEqual([
      expect.objectContaining({
        action: "recommendation-submitted",
        actor: "approval-desk",
        summary: "Recommendation prepared for review.",
        recommendationId: created.body.recommendation.id,
      }),
    ]);
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

  it("creates a pending flow recommendation without mutating the ticket", async () => {
    const { deps, json } = await startFixture();

    const created = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({}),
    });

    expect(created.status).toBe(201);
    expect(created.body.recommendation).toMatchObject({
      ticketId: "TKT-1005",
      sourceRevision: 0,
      category: "integration",
      team: "integrations",
      resolution: "pending",
      createdAt: now.toISOString(),
    });
    expect((await deps.tickets.get("TKT-1005")).revision).toBe(0);
  });

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

  it("creates a TKT-1010 recommendation after complete blank-page evidence without missing knowledge", async () => {
    const { deps, json } = await startFixture();
    await deps.tickets.update("TKT-1010", 0, (ticket) => ({
      ...ticket,
      category: "performance",
      priority: "P3",
      team: "product",
      tags: [...ticket.tags, "performance"],
    }));

    const created = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({
        actor: "approval-desk",
        customerReplies: [
          {
            id: "reply-complete-blank-page-evidence",
            createdAt: "2026-06-10T09:35:00.000Z",
            body:
              "The campaign name is Summer Flash Sale. The failure timestamp was 2026-06-10 09:15 UTC. I use Chrome, and the page is still blank after signing out and back in. The affected scope appears to be 12 profiles in the latest export.",
          },
        ],
      }),
    });

    expect(created.status).toBe(201);
    expect(created.body.recommendation).toMatchObject({
      ticketId: "TKT-1010",
      category: "performance",
      supportState: "diagnosing",
    });
    expect(created.body.recommendation.knowledgeArticleIds).toContain(
      "performance-troubleshooting",
    );
  });

  it("records diagnosis only after a done response with complete evidence", async () => {
    const { deps, json } = await startFixture();
    await deps.tickets.update("TKT-1010", 0, (ticket) => ({
      ...ticket,
      category: "performance",
      priority: "P3",
      team: "product",
      tags: [...ticket.tags, "performance"],
    }));
    const created = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({
        actor: "approval-desk",
        customerReplies: [
          {
            id: "reply-complete-blank-page-evidence",
            createdAt: "2026-06-10T09:35:00.000Z",
            body:
              "The campaign name is Summer Flash Sale. The failure timestamp was 2026-06-10 09:15 UTC. I use Chrome, and the page is still blank after signing out and back in. The affected scope appears to be 12 profiles in the latest export.",
          },
        ],
      }),
    });
    const recommendation = created.body.recommendation;
    const approved = await json(`/api/recommendations/${recommendation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1010",
        expectedRevision: 1,
        approvedFields: ["category", "priority", "team", "customerResponse"],
        editedCustomerResponse: recommendation.draftCustomerResponse,
        actor: "matias-reviewer",
        confirm: true,
      }),
    });
    expect(approved.status).toBe(200);
    const sent = await json(`/api/recommendations/${recommendation.id}/mark-sent`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1010",
        actor: "matias-reviewer",
      }),
    });
    expect(sent.status).toBe(200);

    const diagnosis = await json("/api/tickets/TKT-1010/diagnosis", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });

    expect(diagnosis.status).toBe(201);
    expect(diagnosis.body.auditEvent).toMatchObject({
      action: "diagnosis-completed",
      actor: "product-support",
      ticketId: "TKT-1010",
      after: {
        diagnosis: {
          status: "completed",
          causeType: "performance",
          confidence: "likely",
          owner: "engineering",
        },
      },
    });
    expect(diagnosis.body.auditEvent.after.diagnosis.customerSafeSummary).toContain(
      "campaign editor",
    );
  });

  it("rejects diagnosis when required evidence is still missing", async () => {
    const { json } = await startFixture();
    const created = await json("/api/tickets/TKT-1001/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1001", created.body.recommendation);

    const diagnosis = await json("/api/tickets/TKT-1001/diagnosis", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });

    expect(diagnosis.status).toBe(400);
    expect(diagnosis.body.error.message).toContain(
      "all required evidence to be gathered",
    );
  });

  it("allows known-cause diagnosis without extra evidence gathering", async () => {
    const { json } = await startFixture();
    const created = await json("/api/tickets/TKT-1017/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    expect(created.body.recommendation).toMatchObject({
      supportState: "known-cause",
      knownCause: "sms-quiet-hours",
    });
    await approveAndSend(json, "TKT-1017", created.body.recommendation);

    const diagnosis = await json("/api/tickets/TKT-1017/diagnosis", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });

    expect(diagnosis.status).toBe(201);
    expect(diagnosis.body.auditEvent.action).toBe("diagnosis-completed");

    const update = await json("/api/tickets/TKT-1017/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    const draft = update.body.recommendation.draftCustomerResponse;
    expect(draft).toContain("quiet-hour protection");
    expect(draft).toContain("restricted sending hours");
    expect(draft).toContain("reschedule");
    expect(draft).not.toContain("platform-side processing delay");
    expect(draft).not.toContain("the customer");
  });

  it("does not treat a probable known cause as diagnosis-ready while evidence is missing", async () => {
    const { json } = await startFixture();
    const created = await json("/api/tickets/TKT-1008/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    expect(created.body.recommendation).toMatchObject({
      supportState: "needs-information",
      knownCause: "webhook-secret-rotation",
    });
    expect(created.body.recommendation.missingEvidence.length).toBeGreaterThan(0);
    await approveAndSend(json, "TKT-1008", created.body.recommendation);

    const diagnosis = await json("/api/tickets/TKT-1008/diagnosis", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });

    expect(diagnosis.status).toBe(400);
    expect(diagnosis.body.error.message).toContain(
      "all required evidence to be gathered",
    );
  });

  it("uses recorded diagnosis context in the next customer response draft", async () => {
    const { deps, json } = await startFixture();
    await deps.tickets.update("TKT-1010", 0, (ticket) => ({
      ...ticket,
      category: "performance",
      priority: "P3",
      team: "product",
      tags: [...ticket.tags, "performance"],
    }));
    await json("/api/tickets/TKT-1010/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Mia Johnson",
        source: "manual",
        body:
          "The campaign name is Summer Flash Sale. The failure timestamp was 2026-06-10 09:15 UTC. I use Chrome, and the page is still blank after signing out and back in. The affected scope appears to be 12 profiles in the latest export.",
      }),
    });
    const first = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    const firstRecommendation = first.body.recommendation;
    await json(`/api/recommendations/${firstRecommendation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1010",
        expectedRevision: await ticketRevision(json, "TKT-1010"),
        approvedFields: ["customerResponse"],
        editedCustomerResponse: firstRecommendation.draftCustomerResponse,
        actor: "matias-reviewer",
        confirm: true,
      }),
    });
    await json(`/api/recommendations/${firstRecommendation.id}/mark-sent`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1010",
        actor: "matias-reviewer",
      }),
    });
    await json("/api/tickets/TKT-1010/diagnosis", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });

    const afterDiagnosis = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });

    expect(afterDiagnosis.status).toBe(201);
    expect(afterDiagnosis.body.recommendation.draftCustomerResponse).toContain(
      "campaign editor loading",
    );
    expect(afterDiagnosis.body.recommendation.draftCustomerResponse).toContain(
      "private or incognito window",
    );
    expect(afterDiagnosis.body.recommendation.draftCustomerResponse).toContain(
      "different browser",
    );
    expect(afterDiagnosis.body.recommendation.draftCustomerResponse).toContain(
      "browser console error",
    );
    expect(afterDiagnosis.body.recommendation.draftCustomerResponse).toContain(
      "frontend loading issue",
    );
    expect(afterDiagnosis.body.recommendation.draftCustomerResponse).not.toContain(
      "most likely cause",
    );
    expect(afterDiagnosis.body.recommendation.draftCustomerResponse).not.toContain(
      "We based this on",
    );
    expect(afterDiagnosis.body.recommendation.draftCustomerResponse).not.toContain(
      "applying the mitigation",
    );
    expect(afterDiagnosis.body.recommendation.draftCustomerResponse).not.toContain(
      "Please share a screenshot",
    );
    expect(afterDiagnosis.body.recommendation.draftCustomerResponse).not.toContain(
      "delayed events",
    );
    expect(afterDiagnosis.body.recommendation.draftCustomerResponse).not.toContain(
      "profile timelines",
    );
    expect(afterDiagnosis.body.recommendation.draftCustomerResponse).not.toContain(
      "Please share",
    );
  });

  it("uses the latest evaluated recommendation for diagnosis after automatic replies", async () => {
    let currentNow = new Date("2026-06-10T09:00:00.000Z");
    const { deps, json } = await startFixture({}, { now: () => currentNow });
    await deps.tickets.update("TKT-1010", 0, (ticket) => ({
      ...ticket,
      category: "performance",
      priority: "P3",
      team: "product",
      tags: [...ticket.tags, "performance"],
    }));

    const initial = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1010", initial.body.recommendation);
    currentNow = new Date("2026-06-10T09:05:00.000Z");
    await json("/api/tickets/TKT-1010/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Mia Johnson",
        source: "manual",
        body:
          "The campaign name is Summer Flash Sale. The failure timestamp was 2026-06-10 09:15 UTC. I use Chrome, and the page is still blank after signing out and back in. The affected scope appears to be 12 profiles in the latest export.",
      }),
    });
    currentNow = new Date("2026-06-10T09:06:00.000Z");
    const completeEvidence = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1010", completeEvidence.body.recommendation);
    currentNow = new Date("2026-06-10T09:07:00.000Z");
    const latestCustomerReply = await json("/api/tickets/TKT-1010");
    if (
      latestCustomerReply.body.recommendationSummary.workflowState ===
      "customer-replied"
    ) {
      const refreshed = await json("/api/tickets/TKT-1010/recommendations", {
        method: "POST",
        body: JSON.stringify({ actor: "approval-desk" }),
      });
      await approveAndSend(json, "TKT-1010", refreshed.body.recommendation);
      currentNow = new Date("2026-06-10T09:08:00.000Z");
    }

    const diagnosis = await json("/api/tickets/TKT-1010/diagnosis", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });

    expect(diagnosis.status).toBe(201);
    expect(diagnosis.body.auditEvent.after.diagnosis).toMatchObject({
      confidence: "likely",
      causeType: "performance",
    });
  });

  it("keeps internal diagnosis next actions out of customer update drafts", async () => {
    let currentNow = new Date("2026-06-10T09:00:00.000Z");
    const { json } = await startFixture({}, { now: () => currentNow });

    const first = await json("/api/tickets/TKT-1001/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    const firstRecommendation = first.body.recommendation;
    await approveAndSend(json, "TKT-1001", firstRecommendation);

    currentNow = new Date("2026-06-10T09:05:00.000Z");
    await json("/api/tickets/TKT-1001/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Maya Chen",
        body: "The affected store URL is https://store.example.test. One affected profile email is customer@example.test.",
        source: "manual",
      }),
    });
    currentNow = new Date("2026-06-10T09:06:00.000Z");
    const partial = await json("/api/tickets/TKT-1001/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1001", partial.body.recommendation);

    currentNow = new Date("2026-06-10T09:10:00.000Z");
    await json("/api/tickets/TKT-1001/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Maya Chen",
        body: "The event ID is evt_12345. The request ID is req_12345. The API response status is 400 validation_error.",
        source: "manual",
      }),
    });
    currentNow = new Date("2026-06-10T09:11:00.000Z");
    const complete = await json("/api/tickets/TKT-1001/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1001", complete.body.recommendation);

    currentNow = new Date("2026-06-10T09:15:00.000Z");
    await json("/api/tickets/TKT-1001/diagnosis", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });
    currentNow = new Date("2026-06-10T09:16:00.000Z");
    const update = await json("/api/tickets/TKT-1001/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });

    const draft = update.body.recommendation.draftCustomerResponse;
    expect(draft).toContain(
      "platform-side processing delay affecting checkout event processing and profile timeline updates",
    );
    expect(draft).toContain("working diagnosis");
    expect(draft).not.toContain("completed the investigation");
    expect(draft).not.toContain("We based this on");
    expect(draft).not.toContain("applying the mitigation");
    expect(draft).not.toContain("Complete platform mitigation");
    expect(draft).not.toContain("before asking the customer");
    expect(draft).not.toContain("customer's expected results");
    expect(draft).not.toContain("when there is something ready");
    expect(update.body.recommendation.draftCustomerResponseChecks).toContainEqual(
      expect.objectContaining({
        id: "customer-addressed-directly",
        status: "pass",
      }),
    );
  });

  it("keeps TKT-1008 on the webhook secret-rotation known cause after complete evidence", async () => {
    const { json } = await startFixture();
    const first = await json("/api/tickets/TKT-1008/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1008", first.body.recommendation);
    await json("/api/tickets/TKT-1008/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Juniper Retail",
        source: "manual",
        body:
          "The endpoint URL is https://hooks.example.test/webhooks/orders. The delivery ID is deliv_7788. We rotated the signing secret yesterday at 08:10 UTC. Raw body handling has not changed since yesterday.",
      }),
    });

    const second = await json("/api/tickets/TKT-1008/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });

    expect(second.status).toBe(201);
    expect(second.body.recommendation).toMatchObject({
      supportState: "known-cause",
      knownCause: "webhook-secret-rotation",
      missingEvidence: [],
    });
    expect(second.body.recommendation.draftCustomerResponse).toContain(
      "current signing secret",
    );
    expect(second.body.recommendation.draftCustomerResponse).not.toContain(
      "ecommerce platform",
    );
  });

  it("does not loop on TKT-1007 after the customer gives rotated signing-secret time", async () => {
    const { json } = await startFixture();
    const first = await json("/api/tickets/TKT-1007/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1007", first.body.recommendation);
    await json("/api/tickets/TKT-1007/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Orbit Commerce",
        source: "manual",
        body: [
          "I found the remaining details:",
          "- The failure timestamp was 2026-06-10 09:15 UTC",
          "- We rotated the signing secret yesterday at 08:10 UTC",
          "- The timestamp tolerance configured for verification is five minutes",
          "- The endpoint response code is HTTP 401",
          "- Raw body handling has not changed since yesterday",
        ].join("\n"),
      }),
    });

    const second = await json("/api/tickets/TKT-1007/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });

    expect(second.status).toBe(201);
    expect(second.body.recommendation.providedEvidence.map((item: any) => item.id)).toContain(
      "signing-secret-rotation-time",
    );
    expect(second.body.recommendation.missingEvidence.map((item: any) => item.id)).not.toContain(
      "signing-secret-rotation-time",
    );
    expect(second.body.recommendation.draftCustomerResponse).not.toContain(
      "signing secret rotation time, without sharing the secret value",
    );
  });

  it("uses a customer-safe platform delay fix summary", async () => {
    let currentNow = new Date("2026-06-10T09:00:00.000Z");
    const { json } = await startFixture({}, { now: () => currentNow });
    const diagnosisRecommendation = await createDiagnosedPlatformDelayTicket(
      json,
      (value) => {
        currentNow = new Date(value);
      },
    );

    await approveAndSend(json, "TKT-1001", diagnosisRecommendation);
    currentNow = new Date("2026-06-10T09:17:00.000Z");
    await json("/api/tickets/TKT-1001/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Maya Chen",
        body: "This affects multiple EU stores. The tracking calls were accepted successfully by the API, but the checkout events are still missing from the profile timelines.",
        source: "manual",
      }),
    });
    currentNow = new Date("2026-06-10T09:18:00.000Z");
    const confirmed = await json("/api/tickets/TKT-1001/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1001", confirmed.body.recommendation);
    currentNow = new Date("2026-06-10T09:19:00.000Z");
    const confirmedDiagnosis = await json("/api/tickets/TKT-1001/diagnosis", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });
    expect(confirmedDiagnosis.status, JSON.stringify(confirmedDiagnosis.body)).toBe(201);
    expect(confirmedDiagnosis.body.auditEvent.after.diagnosis).toMatchObject({
      confidence: "confirmed",
      causeType: "platform-delay",
    });
    currentNow = new Date("2026-06-10T09:20:00.000Z");
    const confirmedDiagnosisDraft = await json("/api/tickets/TKT-1001/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1001", confirmedDiagnosisDraft.body.recommendation);
    currentNow = new Date("2026-06-10T09:21:00.000Z");
    const fix = await json("/api/tickets/TKT-1001/fix", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });
    expect(fix.status).toBe(201);

    const afterFix = await json("/api/tickets/TKT-1001/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });

    const draft = afterFix.body.recommendation.draftCustomerResponse;
    expect(draft).toContain(
      "The event-processing delay mitigation has been applied",
    );
    expect(draft).toContain(
      "Please check the affected profile timelines again",
    );
    expect(draft).not.toContain("available for The evidence points");
    expect(draft).not.toContain("the customer's expected results");
  });

  it("answers customer questions from the confirmed diagnosis instead of reverting to pre-diagnosis wording", async () => {
    let currentNow = new Date("2026-06-10T09:00:00.000Z");
    const { json } = await startFixture({}, { now: () => currentNow });
    const diagnosisRecommendation = await createDiagnosedPlatformDelayTicket(
      json,
      (value) => {
        currentNow = new Date(value);
      },
    );

    await approveAndSend(json, "TKT-1001", diagnosisRecommendation);
    currentNow = new Date("2026-06-10T09:17:00.000Z");
    await json("/api/tickets/TKT-1001/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Maya Chen",
        body: "This affects multiple EU stores. The tracking calls were accepted successfully by the API, but the checkout events are still missing from the profile timelines.",
        source: "manual",
      }),
    });
    currentNow = new Date("2026-06-10T09:18:00.000Z");
    const confirmed = await json("/api/tickets/TKT-1001/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1001", confirmed.body.recommendation);
    currentNow = new Date("2026-06-10T09:19:00.000Z");
    const confirmedDiagnosis = await json("/api/tickets/TKT-1001/diagnosis", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });
    expect(confirmedDiagnosis.status, JSON.stringify(confirmedDiagnosis.body)).toBe(201);

    currentNow = new Date("2026-06-10T09:20:00.000Z");
    const diagnosisUpdate = await json("/api/tickets/TKT-1001/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    const diagnosisDraft =
      diagnosisUpdate.body.recommendation.draftCustomerResponse;
    expect(diagnosisDraft).toContain(
      "The examples show accepted events that were delayed before appearing in profile timelines.",
    );
    expect(diagnosisDraft).not.toContain("We based this on");
    await approveAndSend(
      json,
      "TKT-1001",
      diagnosisUpdate.body.recommendation,
    );

    currentNow = new Date("2026-06-10T09:21:00.000Z");
    await json("/api/tickets/TKT-1001/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Maya Chen",
        body: "Okay. What is the problem?",
        source: "manual",
      }),
    });
    currentNow = new Date("2026-06-10T09:22:00.000Z");
    const explanation = await json("/api/tickets/TKT-1001/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    const explanationDraft =
      explanation.body.recommendation.draftCustomerResponse;

    expect(explanationDraft).toContain(
      "the examples point to a delay after the events were accepted",
    );
    expect(explanationDraft).toContain(
      "enough confidence to treat this as a platform-side processing delay",
    );
    expect(explanationDraft).not.toContain("not yet a confirmed root cause");
    expect(explanationDraft).not.toContain("please share:");
  });

  it("rejects fix before diagnosis is recorded", async () => {
    const { deps, json } = await startFixture();
    await deps.tickets.update("TKT-1010", 0, (ticket) => ({
      ...ticket,
      category: "performance",
      priority: "P3",
      team: "product",
      tags: [...ticket.tags, "performance"],
    }));
    const created = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({
        actor: "approval-desk",
        customerReplies: [
          {
            id: "reply-complete-blank-page-evidence",
            createdAt: "2026-06-10T09:35:00.000Z",
            body:
              "The campaign name is Summer Flash Sale. The failure timestamp was 2026-06-10 09:15 UTC. I use Chrome, and the page is still blank after signing out and back in. The affected scope appears to be 12 profiles in the latest export.",
          },
        ],
      }),
    });
    const recommendation = created.body.recommendation;
    await json(`/api/recommendations/${recommendation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1010",
        expectedRevision: 1,
        approvedFields: ["customerResponse"],
        editedCustomerResponse: recommendation.draftCustomerResponse,
        actor: "matias-reviewer",
        confirm: true,
      }),
    });
    await json(`/api/recommendations/${recommendation.id}/mark-sent`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1010",
        actor: "matias-reviewer",
      }),
    });

    const fix = await json("/api/tickets/TKT-1010/fix", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });

    expect(fix.status).toBe(400);
    expect(fix.body.error.message).toBe(
      "A completed diagnosis is required before marking a fix available.",
    );
  });

  it("rejects fix while the latest diagnosis is still likely", async () => {
    const { deps, json } = await startFixture();
    await deps.tickets.update("TKT-1010", 0, (ticket) => ({
      ...ticket,
      category: "performance",
      priority: "P3",
      team: "product",
      tags: [...ticket.tags, "performance"],
    }));
    await json("/api/tickets/TKT-1010/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Mia Johnson",
        source: "manual",
        body:
          "The campaign name is Summer Flash Sale. The failure timestamp was 2026-06-10 09:15 UTC. I use Chrome, and the page is still blank after signing out and back in. The affected scope appears to be 12 profiles in the latest export.",
      }),
    });
    const first = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    const firstRecommendation = first.body.recommendation;
    await json(`/api/recommendations/${firstRecommendation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1010",
        expectedRevision: 1,
        approvedFields: ["customerResponse"],
        editedCustomerResponse: firstRecommendation.draftCustomerResponse,
        actor: "matias-reviewer",
        confirm: true,
      }),
    });
    await json(`/api/recommendations/${firstRecommendation.id}/mark-sent`, {
      method: "POST",
      body: JSON.stringify({ ticketId: "TKT-1010", actor: "matias-reviewer" }),
    });
    await json("/api/tickets/TKT-1010/diagnosis", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });
    const diagnosisDraft = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    const diagnosisRecommendation = diagnosisDraft.body.recommendation;
    await json(`/api/recommendations/${diagnosisRecommendation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1010",
        expectedRevision: await ticketRevision(json, "TKT-1010"),
        approvedFields: ["customerResponse"],
        editedCustomerResponse: diagnosisRecommendation.draftCustomerResponse,
        actor: "matias-reviewer",
        confirm: true,
      }),
    });
    const likelyDiagnosisSent = await json(`/api/recommendations/${diagnosisRecommendation.id}/mark-sent`, {
      method: "POST",
      body: JSON.stringify({ ticketId: "TKT-1010", actor: "matias-reviewer" }),
    });
    expect(likelyDiagnosisSent.body.automaticReply).toMatchObject({
      action: "customer-reply-received",
      actor: "Jamie Lee",
      after: {
        source: "demo-auto-reply",
      },
    });
    expect(likelyDiagnosisSent.body.automaticReply.after.body).toContain(
      "private",
    );
    expect(likelyDiagnosisSent.body.automaticReply.after.body).toContain(
      "Microsoft Edge",
    );
    expect(likelyDiagnosisSent.body.automaticReply.after.body).toContain(
      "another admin",
    );
    expect(likelyDiagnosisSent.body.automaticReply.after.body).toContain(
      "ChunkLoadError",
    );
    expect(likelyDiagnosisSent.body.automaticReply.after.body).not.toMatch(
      /available for this ticket/i,
    );

    const fix = await json("/api/tickets/TKT-1010/fix", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });

    expect(fix.status).toBe(400);
    expect(fix.body.error.message).toBe(
      "A confirmed diagnosis is required before marking a fix available.",
    );
  });

  it("confirms TKT-1010 frontend loading evidence before allowing a fix", async () => {
    let currentNow = new Date("2026-06-10T09:00:00.000Z");
    const { deps, json } = await startFixture({}, { now: () => currentNow });
    await deps.tickets.update("TKT-1010", 0, (ticket) => ({
      ...ticket,
      category: "performance",
      priority: "P3",
      team: "product",
      tags: [...ticket.tags, "performance"],
    }));
    await json("/api/tickets/TKT-1010/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Mia Johnson",
        source: "manual",
        body:
          "The campaign name is Summer Flash Sale. The failure timestamp was 2026-06-10 09:15 UTC. I use Chrome, and the page is still blank after signing out and back in. The affected scope appears to be 12 profiles in the latest export.",
      }),
    });
    const first = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    const firstRecommendation = first.body.recommendation;
    await approveAndSend(json, "TKT-1010", firstRecommendation);
    await json("/api/tickets/TKT-1010/diagnosis", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });
    const diagnosisDraft = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1010", diagnosisDraft.body.recommendation);
    currentNow = new Date("2026-06-10T09:05:00.000Z");
    const confirmedEvaluation = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    expect(confirmedEvaluation.body.recommendation.draftCustomerResponse).not.toContain(
      "Please try these quick browser-session checks first",
    );
    await approveAndSend(json, "TKT-1010", confirmedEvaluation.body.recommendation);

    const confirmedDiagnosis = await json("/api/tickets/TKT-1010/diagnosis", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });

    expect(confirmedDiagnosis.status, JSON.stringify(confirmedDiagnosis.body)).toBe(201);
    expect(confirmedDiagnosis.body.auditEvent.after.diagnosis).toMatchObject({
      confidence: "confirmed",
      owner: "engineering",
    });
    expect(
      confirmedDiagnosis.body.auditEvent.after.diagnosis.customerSafeSummary,
    ).toContain("frontend loading issue");
    const confirmedDiagnosisDraft = await json(
      "/api/tickets/TKT-1010/recommendations",
      {
        method: "POST",
        body: JSON.stringify({ actor: "approval-desk" }),
      },
    );
    expect(
      confirmedDiagnosisDraft.body.recommendation.draftCustomerResponse,
    ).toContain("frontend loading issue");
    expect(
      confirmedDiagnosisDraft.body.recommendation.draftCustomerResponse,
    ).not.toContain("Please try these quick browser-session checks first");
    await approveAndSend(
      json,
      "TKT-1010",
      confirmedDiagnosisDraft.body.recommendation,
    );
    const fix = await json("/api/tickets/TKT-1010/fix", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });
    expect(fix.status).toBe(201);

    const afterFix = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });

    expect(afterFix.status).toBe(201);
    expect(afterFix.body.recommendation.draftCustomerResponse).toContain(
      "mitigation has been applied",
    );
    expect(afterFix.body.recommendation.draftCustomerResponse).toContain(
      "Let us know whether the editor now loads normally",
    );
    expect(afterFix.body.recommendation.draftCustomerResponse).not.toContain(
      "Please share",
    );
  });

  it("rejects fix when a confirmed TKT-1010 diagnosis does not need a platform fix", async () => {
    let currentNow = new Date("2026-06-10T09:00:00.000Z");
    const { deps, json } = await startFixture({}, { now: () => currentNow });
    await deps.tickets.update("TKT-1010", 0, (ticket) => ({
      ...ticket,
      category: "performance",
      priority: "P3",
      team: "product",
      tags: [...ticket.tags, "performance"],
    }));
    await json("/api/tickets/TKT-1010/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Mia Johnson",
        source: "manual",
        body:
          "The campaign name is Summer Flash Sale. The failure timestamp was 2026-06-10 09:15 UTC. I use Chrome, and the page is still blank after signing out and back in. The affected scope appears to be 12 profiles in the latest export.",
      }),
    });
    const first = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1010", first.body.recommendation);
    await json("/api/tickets/TKT-1010/diagnosis", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });
    const diagnosisDraft = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await json(`/api/recommendations/${diagnosisDraft.body.recommendation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1010",
        expectedRevision: await ticketRevision(json, "TKT-1010"),
        approvedFields: ["customerResponse"],
        editedCustomerResponse: diagnosisDraft.body.recommendation.draftCustomerResponse,
        actor: "matias-reviewer",
        confirm: true,
      }),
    });
    await deps.service.markResponseSent({
      recommendationId: diagnosisDraft.body.recommendation.id,
      ticketId: "TKT-1010",
      actor: "matias-reviewer",
      sentAt: currentNow.toISOString(),
      customerResponse: diagnosisDraft.body.recommendation.draftCustomerResponse,
    });
    currentNow = new Date("2026-06-10T09:05:00.000Z");
    await json("/api/tickets/TKT-1010/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Mia Johnson",
        source: "manual",
        body:
          "The campaign editor works in a private/incognito window, so this seems tied to my browser session.",
      }),
    });
    const confirmedEvaluation = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1010", confirmedEvaluation.body.recommendation);
    const confirmedDiagnosis = await json("/api/tickets/TKT-1010/diagnosis", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });
    expect(confirmedDiagnosis.status).toBe(201);
    expect(confirmedDiagnosis.body.auditEvent.after.diagnosis).toMatchObject({
      confidence: "confirmed",
      owner: "customer",
    });
    const confirmedDiagnosisDraft = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    expect(
      confirmedDiagnosisDraft.body.recommendation.draftCustomerResponse,
    ).toContain("browser session");
    expect(
      confirmedDiagnosisDraft.body.recommendation.draftCustomerResponse,
    ).toContain("clear site data");
    expect(
      confirmedDiagnosisDraft.body.recommendation.draftCustomerResponse,
    ).not.toContain("frontend engineering");
    await approveAndSend(json, "TKT-1010", confirmedDiagnosisDraft.body.recommendation);

    const fix = await json("/api/tickets/TKT-1010/fix", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });

    expect(fix.status).toBe(400);
    expect(fix.body.error.message).toBe(
      "This confirmed diagnosis does not require a platform fix.",
    );
  });

  it("automatically adds a ticket-specific customer reply after a fix response is done", async () => {
    let currentNow = new Date("2026-06-10T09:00:00.000Z");
    const { deps, json } = await startFixture({}, { now: () => currentNow });
    await deps.tickets.update("TKT-1010", 0, (ticket) => ({
      ...ticket,
      category: "performance",
      priority: "P3",
      team: "product",
      tags: [...ticket.tags, "performance"],
    }));
    await json("/api/tickets/TKT-1010/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Mia Johnson",
        source: "manual",
        body:
          "The campaign name is Summer Flash Sale. The failure timestamp was 2026-06-10 09:15 UTC. I use Chrome, and the page is still blank after signing out and back in. The affected scope appears to be 12 profiles in the latest export.",
      }),
    });
    const first = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    const firstRecommendation = first.body.recommendation;
    await approveAndSend(json, "TKT-1010", firstRecommendation);
    await json("/api/tickets/TKT-1010/diagnosis", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });
    const diagnosisDraft = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    const diagnosisRecommendation = diagnosisDraft.body.recommendation;
    await approveAndSend(json, "TKT-1010", diagnosisRecommendation);
    currentNow = new Date("2026-06-10T09:05:00.000Z");
    const confirmedEvaluation = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1010", confirmedEvaluation.body.recommendation);
    const confirmedDiagnosis = await json("/api/tickets/TKT-1010/diagnosis", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });
    expect(confirmedDiagnosis.status).toBe(201);
    const confirmedDiagnosisDraft = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1010", confirmedDiagnosisDraft.body.recommendation);
    await json("/api/tickets/TKT-1010/fix", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });
    const fixDraft = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    const fixRecommendation = fixDraft.body.recommendation;
    await json(`/api/recommendations/${fixRecommendation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1010",
        expectedRevision: await ticketRevision(json, "TKT-1010"),
        approvedFields: ["customerResponse"],
        editedCustomerResponse: fixRecommendation.draftCustomerResponse,
        actor: "matias-reviewer",
        confirm: true,
      }),
    });

    const sent = await json(`/api/recommendations/${fixRecommendation.id}/mark-sent`, {
      method: "POST",
      body: JSON.stringify({ ticketId: "TKT-1010", actor: "matias-reviewer" }),
    });
    const detail = await json("/api/tickets/TKT-1010");

    expect(sent.status).toBe(200);
    expect(sent.body.automaticReply).toMatchObject({
      action: "customer-reply-received",
      after: {
        body: expect.stringContaining("It works now"),
        source: "demo-auto-reply",
      },
    });
    expect(detail.body.recommendationSummary.workflowState).toBe("customer-replied");
    expect(detail.body.conversationTimeline).toContainEqual(
      expect.objectContaining({
        kind: "customer-reply",
        body: expect.stringContaining("It works now"),
      }),
    );
  });

  it("automatically adds ticket-specific evidence replies after an information request is done", async () => {
    let currentNow = new Date("2026-06-10T09:00:00.000Z");
    const { json } = await startFixture({}, { now: () => currentNow });
    const created = await json("/api/tickets/TKT-1008/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    const recommendation = created.body.recommendation;
    await json(`/api/recommendations/${recommendation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1008",
        expectedRevision: await ticketRevision(json, "TKT-1008"),
        approvedFields: ["customerResponse"],
        editedCustomerResponse: recommendation.draftCustomerResponse,
        actor: "matias-reviewer",
        confirm: true,
      }),
    });
    currentNow = new Date("2026-06-10T09:05:00.000Z");

    const sent = await json(`/api/recommendations/${recommendation.id}/mark-sent`, {
      method: "POST",
      body: JSON.stringify({ ticketId: "TKT-1008", actor: "matias-reviewer" }),
    });
    const detail = await json("/api/tickets/TKT-1008");

    expect(sent.status).toBe(200);
    expect(sent.body.automaticReply).toMatchObject({
      action: "customer-reply-received",
      actor: "Lina Weber",
      after: {
        body: expect.stringContaining("webhook"),
        source: "demo-auto-reply",
      },
    });
    expect(sent.body.automaticReply.after.body).toContain("endpoint");
    expect(sent.body.automaticReply.after.body).toContain("delivery");
    expect(sent.body.automaticReply.after.body).not.toContain(
      "It works now",
    );
    expect(detail.body.recommendationSummary.workflowState).toBe(
      "customer-replied",
    );
    expect(detail.body.conversationTimeline).toContainEqual(
      expect.objectContaining({
        kind: "customer-reply",
        body: expect.stringContaining("webhook"),
      }),
    );
  });

  it("closes a ready-for-close ticket after the closing response is sent", async () => {
    let currentNow = new Date("2026-06-10T09:00:00.000Z");
    const { deps, json } = await startFixture({}, { now: () => currentNow });
    const diagnosisRecommendation = await createDiagnosedPlatformDelayTicket(
      json,
      (value) => {
        currentNow = new Date(value);
      },
    );
    await approveAndSend(json, "TKT-1001", diagnosisRecommendation);
    currentNow = new Date("2026-06-10T09:17:00.000Z");
    await json("/api/tickets/TKT-1001/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Maya Chen",
        body:
          "This affects multiple EU stores. The tracking calls were accepted successfully by the API, but the checkout events are still missing from the profile timelines.",
        source: "manual",
      }),
    });
    currentNow = new Date("2026-06-10T09:18:00.000Z");
    const confirmed = await json("/api/tickets/TKT-1001/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1001", confirmed.body.recommendation);
    currentNow = new Date("2026-06-10T09:19:00.000Z");
    await json("/api/tickets/TKT-1001/diagnosis", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });
    currentNow = new Date("2026-06-10T09:20:00.000Z");
    const diagnosisUpdate = await json("/api/tickets/TKT-1001/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1001", diagnosisUpdate.body.recommendation);
    currentNow = new Date("2026-06-10T09:21:00.000Z");
    await json("/api/tickets/TKT-1001/fix", {
      method: "POST",
      body: JSON.stringify({ actor: "product-support" }),
    });
    currentNow = new Date("2026-06-10T09:22:00.000Z");
    const fixDraft = await json("/api/tickets/TKT-1001/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1001", fixDraft.body.recommendation);
    currentNow = new Date("2026-06-10T09:23:00.000Z");
    await json("/api/tickets/TKT-1001/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Maya Chen",
        body: "That fixed it. Thanks for the help!",
        source: "manual",
      }),
    });
    currentNow = new Date("2026-06-10T09:24:00.000Z");
    const closingDraft = await json("/api/tickets/TKT-1001/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    expect(closingDraft.body.recommendation.supportState).toBe("ready-for-close");
    await approveAndSend(json, "TKT-1001", closingDraft.body.recommendation);
    currentNow = new Date("2026-06-10T09:25:00.000Z");

    const close = await json("/api/tickets/TKT-1001/close", {
      method: "POST",
      body: JSON.stringify({ actor: "matias-reviewer" }),
    });
    const detail = await json("/api/tickets/TKT-1001");

    expect(close.status).toBe(200);
    expect(close.body.ticket).toMatchObject({
      id: "TKT-1001",
      status: "resolved",
    });
    expect(close.body.auditEvent).toMatchObject({
      action: "ticket-updated",
      actor: "matias-reviewer",
      ticketId: "TKT-1001",
      recommendationId: closingDraft.body.recommendation.id,
      after: {
        status: "resolved",
        closedAt: "2026-06-10T09:25:00.000Z",
      },
    });
    expect(detail.body.recommendationSummary.workflowState).toBe("resolved");
    expect(detail.body.conversationTimeline).toContainEqual(
      expect.objectContaining({
        kind: "customer-reply",
        body: expect.stringContaining("That fixed it"),
      }),
    );
    expect(await deps.tickets.get("TKT-1001")).toMatchObject({
      status: "resolved",
    });
  });

  it("rejects closing before a ready-for-close response has been sent", async () => {
    const { json } = await startFixture();
    const created = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await approveAndSend(json, "TKT-1005", created.body.recommendation);

    const close = await json("/api/tickets/TKT-1005/close", {
      method: "POST",
      body: JSON.stringify({ actor: "matias-reviewer" }),
    });

    expect(close.status).toBe(400);
    expect(close.body.error.message).toContain("ready-to-close");
  });

  it("creates recommendations with a provider draft from cited knowledge", async () => {
    const seenArticleBodies: string[] = [];
    const seenResponseStyles: string[] = [];
    const { json } = await startFixture({
      draftProvider: {
        draft: async (input) => {
          seenArticleBodies.push(
            ...input.knowledgeArticles.map((article) => article.body),
          );
          seenResponseStyles.push(input.responseStyle);
          return {
            source: "openai",
            response:
              "We are checking the webhook delivery timestamp, endpoint response, and signing configuration before recommending the next update.",
            assist: {
              source: "openai",
              missingInfoSuggestions: [
                "Share the delivery ID.",
                "Share the endpoint URL.",
              ],
              investigationSteps: [
                "Compare the signed payload with delivery headers.",
              ],
              tone: "technical",
              recommendedTone: "technical",
              selectedTone: "technical",
              toneReason:
                "Requester is a developer working on webhook verification.",
              audience: "developer",
              checks: [],
            },
          };
        },
      },
    });

    const created = await json("/api/tickets/TKT-1008/recommendations", {
      method: "POST",
      body: JSON.stringify({
        actor: "approval-desk",
        responseStyle: "technical",
      }),
    });

    expect(created.status).toBe(201);
    expect(created.body.recommendation).toMatchObject({
      ticketId: "TKT-1008",
      draftCustomerResponseSource: "openai",
      draftCustomerResponseStyle: "technical",
      draftCustomerResponse:
        "We are checking the webhook delivery timestamp, endpoint response, and signing configuration before recommending the next update.\n\nKind regards,\nSupport Team\nNorthstar Marketing Support",
      gptAssist: {
        source: "openai",
        tone: "technical",
        recommendedTone: "technical",
        selectedTone: "technical",
        toneReason:
          "Requester is a developer working on webhook verification.",
        audience: "developer",
        missingInfoSuggestions: [
          "Share the delivery ID.",
          "Share the endpoint URL.",
        ],
      },
    });
    expect(created.body.recommendation.draftCustomerResponseChecks).toContainEqual(
      expect.objectContaining({
        id: "no-internal-article-ids",
        status: "pass",
      }),
    );
    expect(seenArticleBodies.join("\n")).toContain("webhook");
    expect(seenResponseStyles).toEqual(["technical"]);
  });

  it("marks an approved recommendation as sent at the reviewer click time", async () => {
    let currentNow = now;
    const { json } = await startFixture({}, { now: () => currentNow });
    const approvedResponse =
      "Hi Prompt Streetwear, we reviewed this response and it is ready to send.";
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
          approvedFields: ["customerResponse"],
          editedCustomerResponse: approvedResponse,
          actor: "matias-reviewer",
          confirm: true,
        }),
      },
    );
    currentNow = new Date("2026-06-10T10:00:00.000Z");

    const sent = await json(
      `/api/recommendations/${created.body.recommendation.id}/mark-sent`,
      {
        method: "POST",
        body: JSON.stringify({
          ticketId: "TKT-1005",
          actor: "approval-desk",
        }),
      },
    );
    const detail = await json("/api/tickets/TKT-1005");

    expect(approved.status).toBe(200);
    expect(sent.status).toBe(200);
    expect(sent.body.auditEvent).toMatchObject({
      action: "customer-response-sent",
      timestamp: "2026-06-10T10:00:00.000Z",
      after: {
        sentAt: "2026-06-10T10:00:00.000Z",
        customerResponse: approvedResponse,
      },
    });
    expect(detail.body.recommendationSummary).toMatchObject({
      latestRecommendationId: created.body.recommendation.id,
      latestResolution: "approved",
      workflowState: "customer-replied",
      hasSentResponse: true,
      hasCustomerReply: true,
      latestSentAt: "2026-06-10T10:00:00.000Z",
    });
    expect(sent.body.automaticReply).toMatchObject({
      action: "customer-reply-received",
      after: {
        source: "demo-auto-reply",
      },
    });
    expect(detail.body.conversationTimeline).toContainEqual(
      expect.objectContaining({
        kind: "support-response-sent",
        timestamp: "2026-06-10T10:00:00.000Z",
        recommendationId: created.body.recommendation.id,
        body: approvedResponse,
      }),
    );
    expect(detail.body.recommendationHistory).toMatchObject([
      {
        id: created.body.recommendation.id,
        resolution: "approved",
      },
    ]);
  });

  it("rejects mark-sent when the customer response was not approved", async () => {
    const { json } = await startFixture();
    const created = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await json(`/api/recommendations/${created.body.recommendation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1005",
        expectedRevision: 0,
        approvedFields: ["category"],
        actor: "matias-reviewer",
        confirm: true,
      }),
    });

    const sent = await json(
      `/api/recommendations/${created.body.recommendation.id}/mark-sent`,
      {
        method: "POST",
        body: JSON.stringify({
          ticketId: "TKT-1005",
          actor: "approval-desk",
        }),
      },
    );
    const detail = await json("/api/tickets/TKT-1005");

    expect(sent.status).toBe(400);
    expect(sent.body).toEqual({
      error: {
        code: "INVALID_REQUEST",
        message:
          "Customer response must be approved before it can be marked sent.",
      },
    });
    expect(detail.body.audits.events).not.toContainEqual(
      expect.objectContaining({ action: "customer-response-sent" }),
    );
  });

  it("rejects duplicate mark-sent requests for the same recommendation", async () => {
    const { json } = await startFixture();
    const approvedResponse =
      "Hi Prompt Streetwear, we reviewed this response and it is ready to send.";
    const created = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await json(`/api/recommendations/${created.body.recommendation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1005",
        expectedRevision: 0,
        approvedFields: ["customerResponse"],
        editedCustomerResponse: approvedResponse,
        actor: "matias-reviewer",
        confirm: true,
      }),
    });
    await json(`/api/recommendations/${created.body.recommendation.id}/mark-sent`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1005",
        actor: "approval-desk",
      }),
    });

    const duplicate = await json(
      `/api/recommendations/${created.body.recommendation.id}/mark-sent`,
      {
        method: "POST",
        body: JSON.stringify({
          ticketId: "TKT-1005",
          actor: "approval-desk",
        }),
      },
    );
    const detail = await json("/api/tickets/TKT-1005");

    expect(duplicate.status).toBe(400);
    expect(duplicate.body).toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Customer response has already been marked sent.",
      },
    });
    expect(
      detail.body.audits.events.filter(
        (event: any) => event.action === "customer-response-sent",
      ),
    ).toHaveLength(1);
  });

  it("records a customer reply after a sent response and marks the ticket customer-replied", async () => {
    let currentNow = now;
    const { json } = await startFixture({}, { now: () => currentNow });
    const approvedResponse =
      "Hi Prompt Streetwear, we reviewed this response and it is ready to send.";
    const created = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    await json(`/api/recommendations/${created.body.recommendation.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1005",
        expectedRevision: 0,
        approvedFields: ["customerResponse"],
        editedCustomerResponse: approvedResponse,
        actor: "matias-reviewer",
        confirm: true,
      }),
    });
    await json(`/api/recommendations/${created.body.recommendation.id}/mark-sent`, {
      method: "POST",
      body: JSON.stringify({
        ticketId: "TKT-1005",
        actor: "approval-desk",
      }),
    });
    currentNow = new Date("2026-06-10T09:06:00.000Z");

    const reply = await json("/api/tickets/TKT-1005/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Maya Chen",
        body: "Thanks, I tried the suggested checks and the flow is still not working.",
        source: "email",
      }),
    });
    const detail = await json("/api/tickets/TKT-1005");

    expect(reply.status).toBe(201);
    expect(reply.body.auditEvent).toMatchObject({
      action: "customer-reply-received",
      timestamp: "2026-06-10T09:06:00.000Z",
      actor: "Maya Chen",
      after: {
        body: "Thanks, I tried the suggested checks and the flow is still not working.",
        source: "email",
      },
    });
    expect(detail.body.recommendationSummary).toMatchObject({
      workflowState: "customer-replied",
      hasSentResponse: true,
      hasCustomerReply: true,
      latestSentAt: "2026-06-10T09:00:00.000Z",
      latestCustomerReplyAt: "2026-06-10T09:06:00.000Z",
    });
    expect(detail.body.conversationTimeline).toContainEqual(
      expect.objectContaining({
        kind: "customer-reply",
        timestamp: "2026-06-10T09:06:00.000Z",
        actor: "Maya Chen",
        body: "Thanks, I tried the suggested checks and the flow is still not working.",
      }),
    );
  });

  it("supersedes an earlier pending recommendation when creating after a customer reply", async () => {
    let currentNow = now;
    const { deps, json } = await startFixture({}, { now: () => currentNow });
    const first = await json("/api/tickets/TKT-1008/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    currentNow = new Date("2026-06-10T09:02:00.000Z");
    await json("/api/tickets/TKT-1008/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Dev Support",
        body:
          "Endpoint URL is https://hooks.juniper.example/webhooks/orders and delivery ID is deliv_7788.",
      }),
    });
    currentNow = new Date("2026-06-10T09:03:00.000Z");

    const second = await json("/api/tickets/TKT-1008/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    const detail = await json("/api/tickets/TKT-1008");

    expect(second.status).toBe(201);
    expect(await deps.recommendations.get(first.body.recommendation.id)).toMatchObject({
      resolution: "superseded",
    });
    expect(second.body.recommendation).toMatchObject({
      ticketId: "TKT-1008",
      resolution: "pending",
      supportState: "information-received",
    });
    expect(second.body.recommendation.providedEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "endpoint-url" }),
        expect.objectContaining({ id: "delivery-id" }),
      ]),
    );
    expect(detail.body.recommendationSummary).toMatchObject({
      latestRecommendationId: second.body.recommendation.id,
      workflowState: "draft-ready",
      hasPendingRecommendation: true,
    });
    expect(detail.body.recommendationHistory).toMatchObject([
      {
        id: second.body.recommendation.id,
        resolution: "pending",
      },
      {
        id: first.body.recommendation.id,
        resolution: "superseded",
      },
    ]);
  });

  it("uses multiple customer replies to complete known-cause evidence", async () => {
    let currentNow = now;
    const { deps, json } = await startFixture({}, { now: () => currentNow });
    const first = await json("/api/tickets/TKT-1008/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    currentNow = new Date("2026-06-10T09:02:00.000Z");
    await json("/api/tickets/TKT-1008/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Dev Support",
        body:
          "Endpoint URL is https://hooks.juniper.example/webhooks/orders and delivery ID is deliv_7788.",
      }),
    });
    currentNow = new Date("2026-06-10T09:03:00.000Z");
    await json("/api/tickets/TKT-1008/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Dev Support",
        body:
          "We rotated the signing secret yesterday at 08:10 UTC. Raw body handling has not changed since yesterday.",
      }),
    });
    currentNow = new Date("2026-06-10T09:04:00.000Z");

    const second = await json("/api/tickets/TKT-1008/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });

    expect(second.status).toBe(201);
    expect(await deps.recommendations.get(first.body.recommendation.id)).toMatchObject({
      resolution: "superseded",
    });
    expect(second.body.recommendation).toMatchObject({
      supportState: "known-cause",
      knownCause: "webhook-secret-rotation",
      missingEvidence: [],
    });
    expect(second.body.recommendation.providedEvidence.map((item: any) => item.id)).toEqual(
      expect.arrayContaining([
        "endpoint-url",
        "delivery-id",
        "signing-secret-rotation-time",
        "raw-body-change-status",
      ]),
    );
  });

  it("keeps the earlier pending recommendation when replacement creation fails", async () => {
    let currentNow = now;
    const { deps, json } = await startFixture({}, { now: () => currentNow });
    const first = await json("/api/tickets/TKT-1008/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    currentNow = new Date("2026-06-10T09:02:00.000Z");
    await json("/api/tickets/TKT-1008/customer-replies", {
      method: "POST",
      body: JSON.stringify({
        actor: "Dev Support",
        body:
          "Endpoint URL is https://hooks.juniper.example/webhooks/orders and delivery ID is deliv_7788.",
      }),
    });
    deps.service.submit = async () => {
      throw new Error("submit failed");
    };

    const response = await json("/api/tickets/TKT-1008/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });

    expect(response.status).toBe(500);
    expect(await deps.recommendations.get(first.body.recommendation.id)).toMatchObject({
      resolution: "pending",
    });
    expect(await deps.recommendations.list()).toHaveLength(1);
    expect(await deps.audits.list("TKT-1008")).not.toContainEqual(
      expect.objectContaining({ action: "recommendation-superseded" }),
    );
  });

  it("does not supersede a pending recommendation when create is clicked twice without a new reply", async () => {
    let currentNow = now;
    const { deps, json } = await startFixture({}, { now: () => currentNow });
    const first = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    currentNow = new Date("2026-06-10T09:01:00.000Z");

    const second = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    const detail = await json("/api/tickets/TKT-1005");

    expect(second.status).toBe(201);
    expect(await deps.recommendations.get(first.body.recommendation.id)).toMatchObject({
      resolution: "pending",
    });
    expect(detail.body.recommendationSummary).toMatchObject({
      latestRecommendationId: second.body.recommendation.id,
      workflowState: "draft-ready",
      hasPendingRecommendation: true,
    });
    expect(detail.body.recommendationHistory).toMatchObject([
      {
        id: second.body.recommendation.id,
        resolution: "pending",
      },
      {
        id: first.body.recommendation.id,
        resolution: "pending",
      },
    ]);
  });

  it("does not supersede a pending recommendation from body-only customer reply context", async () => {
    let currentNow = now;
    const { deps, json } = await startFixture({}, { now: () => currentNow });
    const first = await json("/api/tickets/TKT-1008/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });
    currentNow = new Date("2026-06-10T09:02:00.000Z");

    const second = await json("/api/tickets/TKT-1008/recommendations", {
      method: "POST",
      body: JSON.stringify({
        actor: "approval-desk",
        customerReplies: [
          {
            id: "body-only-reply",
            createdAt: "2026-06-10T09:01:00.000Z",
            body:
              "Endpoint URL is https://hooks.juniper.example/webhooks/orders and delivery ID is deliv_7788.",
          },
        ],
      }),
    });
    const detail = await json("/api/tickets/TKT-1008");

    expect(second.status).toBe(201);
    expect(await deps.recommendations.get(first.body.recommendation.id)).toMatchObject({
      resolution: "pending",
    });
    expect(second.body.recommendation.providedEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "endpoint-url" }),
        expect.objectContaining({ id: "delivery-id" }),
      ]),
    );
    expect(detail.body.recommendationHistory).toMatchObject([
      {
        id: second.body.recommendation.id,
        resolution: "pending",
      },
      {
        id: first.body.recommendation.id,
        resolution: "pending",
      },
    ]);
  });

  it("uses classifier routing and classifier-selected knowledge by default", async () => {
    const seenArticleIds: string[][] = [];
    const { json } = await startFixture({
      draftProvider: {
        draft: async (input) => {
          seenArticleIds.push(input.knowledgeArticles.map(({ id }) => id));
          throw new Error("Use the deterministic fallback after capturing articles.");
        },
      },
    });

    const created = await json("/api/tickets/TKT-1004/recommendations", {
      method: "POST",
      body: JSON.stringify({ actor: "approval-desk" }),
    });

    expect(created.status).toBe(201);
    expect(created.body.recommendation).toMatchObject({
      category: "security",
      priority: "P1",
      team: "security",
      knowledgeArticleIds: ["security-incident-response"],
      classificationSignals: expect.arrayContaining([
        expect.objectContaining({ target: "risk:security" }),
      ]),
    });
    expect(seenArticleIds).toEqual([["security-incident-response"]]);
  });

  it("passes GPT advisory classification signals from the reasoning provider into recommendation creation", async () => {
    const { json } = await startFixture({
      classificationReasoningProvider: {
        async reason() {
          return {
            reasoning: {
              issueType: "campaign-editor",
              candidateCategory: "performance",
              candidateTeam: "product",
              knowledgeArticleIds: ["campaign-send-failures"],
              confidence: 0.9,
              evidence: ["customer says the campaign editor page stays blank"],
              missingEvidenceThatWouldChangeClassification: [],
              explanation: "The reply describes a campaign editor loading failure.",
            },
            telemetry: { model: "gpt-5.6-luna", latencyMs: 1 },
          };
        },
      },
    });

    const created = await json("/api/tickets/TKT-1010/recommendations", {
      method: "POST",
      body: JSON.stringify({
        actor: "approval-desk",
        customerReplies: [
          {
            id: "demo-reply-1",
            createdAt: "2026-06-10T09:05:00.000Z",
            body: "The editor opens but the content area never finishes loading after I click Edit.",
          },
        ],
      }),
    });

    expect(created.status).toBe(201);
    expect(created.body.recommendation).toMatchObject({
      category: "performance",
      team: "product",
      knowledgeArticleIds: ["campaign-send-failures"],
    });
    expect(created.body.recommendation.classificationSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "gpt-advisory-campaign-editor-category",
          target: "category:performance",
        }),
      ]),
    );
  });

  it("accepts auto draft style and returns the resolved recommended style", async () => {
    const { json } = await startFixture();

    const created = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({
        actor: "approval-desk",
        responseStyle: "auto",
      }),
    });

    expect(created.status).toBe(201);
    expect(created.body.recommendation).toMatchObject({
      ticketId: "TKT-1005",
      draftCustomerResponseStyle: "empathetic",
      gptAssist: {
        recommendedTone: "empathetic",
        selectedTone: "empathetic",
        toneReason: expect.stringContaining("Marketing Coordinator"),
      },
    });
  });

  it("adds reviewer and company sign-off to created customer drafts", async () => {
    const { json } = await startFixture();

    const created = await json("/api/tickets/TKT-1005/recommendations", {
      method: "POST",
      body: JSON.stringify({
        actor: "Matias Laukka",
        responseStyle: "auto",
      }),
    });

    expect(created.status).toBe(201);
    expect(created.body.recommendation.draftCustomerResponse).toContain(
      "Kind regards,\nMatias Laukka\nNorthstar Marketing Support",
    );
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

  it("counts evidence audit events and safety blocks beyond the first audit page", async () => {
    const { deps, json } = await startFixture();
    for (let index = 0; index < 51; index += 1) {
      const suffix = index.toString(16).padStart(12, "0");
      await deps.audits.append(
        AuditEventSchema.parse({
          id: `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`,
          timestamp: now.toISOString(),
          actor: "approval-desk",
          action: "approval-rejected",
          ticketId: "TKT-1005",
          recommendationId: `bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`,
          before: {},
          after: {},
          rationale: "Approval revision is stale.",
          knowledgeArticleIds: [],
          result: "rejected",
          rejectionReason: "Approval revision is stale.",
        }),
      );
    }

    const evidence = await json("/api/evidence");

    expect(evidence.status).toBe(200);
    expect(evidence.body.summary.auditEvents).toBe(51);
    expect(evidence.body.summary.safetyBlocks).toBe(51);
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
      category: "integration",
      priority: "P2",
      team: "integrations",
    });
    expect(approved.body.auditEvent).toMatchObject({
      action: "recommendation-approved",
      actor: "matias-reviewer",
    });
  });

  it("cancels an approved recommendation and returns the ticket workflow to active", async () => {
    const { deps, json } = await startFixture();
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
          approvedFields: ["category"],
          actor: "matias-reviewer",
          confirm: true,
        }),
      },
    );
    expect(approved.status).toBe(200);

    const canceled = await json(
      `/api/recommendations/${created.body.recommendation.id}/cancel-approval`,
      {
        method: "POST",
        body: JSON.stringify({
          ticketId: "TKT-1005",
          actor: "matias-reviewer",
          reason: "Replacing the approved recommendation with a better draft.",
        }),
      },
    );

    expect(canceled.status).toBe(200);
    expect(canceled.body.auditEvent).toMatchObject({
      action: "recommendation-canceled",
      actor: "matias-reviewer",
      before: { resolution: "approved" },
      after: { resolution: "canceled" },
    });
    expect((await deps.recommendations.get(created.body.recommendation.id))).toMatchObject({
      resolution: "canceled",
    });

    const detail = await json("/api/tickets/TKT-1005");
    expect(detail.body.recommendationSummary).toMatchObject({
      hasPendingRecommendation: false,
      hasApprovedRecommendation: false,
      workflowState: "active",
    });
    expect(detail.body).not.toHaveProperty("latestRecommendation");
  });

  it("approves reviewer-edited field values through the local API", async () => {
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
          fieldOverrides: {
            category: "incident",
            priority: "P1",
            team: "incident-response",
          },
          actor: "matias-reviewer",
          confirm: true,
        }),
      },
    );

    expect(approved.status).toBe(200);
    expect(approved.body.ticket).toMatchObject({
      id: "TKT-1005",
      revision: 1,
      category: "incident",
      priority: "P1",
      team: "incident-response",
    });
    expect(approved.body.auditEvent.after).toMatchObject({
      category: "incident",
      priority: "P1",
      team: "incident-response",
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

async function startFixture(
  options: Parameters<typeof createApprovalDeskHttpServer>[1] = {},
  fixtureOptions: { now?: () => Date } = {},
): Promise<{
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
    now: fixtureOptions.now ?? (() => now),
  });
  const server = createApprovalDeskHttpServer(deps, options);
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

async function ticketRevision(
  json: Awaited<ReturnType<typeof startFixture>>["json"],
  ticketId: string,
): Promise<number> {
  const detail = await json(`/api/tickets/${ticketId}`);
  return detail.body.ticket.revision;
}

async function approveAndSend(
  json: Awaited<ReturnType<typeof startFixture>>["json"],
  ticketId: string,
  recommendation: { id: string; draftCustomerResponse: string },
): Promise<void> {
  const approved = await json(`/api/recommendations/${recommendation.id}/approve`, {
    method: "POST",
    body: JSON.stringify({
      ticketId,
      expectedRevision: await ticketRevision(json, ticketId),
      approvedFields: ["customerResponse"],
      editedCustomerResponse: recommendation.draftCustomerResponse,
      actor: "matias-reviewer",
      confirm: true,
    }),
  });
  expect(approved.status).toBe(200);
  const sent = await json(`/api/recommendations/${recommendation.id}/mark-sent`, {
    method: "POST",
    body: JSON.stringify({
      ticketId,
      actor: "matias-reviewer",
    }),
  });
  expect(sent.status).toBe(200);
}

async function createDiagnosedPlatformDelayTicket(
  json: Awaited<ReturnType<typeof startFixture>>["json"],
  setNow: (value: string) => void = () => {},
): Promise<{ id: string; draftCustomerResponse: string }> {
  setNow("2026-06-10T09:00:00.000Z");
  const first = await json("/api/tickets/TKT-1001/recommendations", {
    method: "POST",
    body: JSON.stringify({ actor: "approval-desk" }),
  });
  await approveAndSend(json, "TKT-1001", first.body.recommendation);

  setNow("2026-06-10T09:05:00.000Z");
  await json("/api/tickets/TKT-1001/customer-replies", {
    method: "POST",
    body: JSON.stringify({
      actor: "Maya Chen",
      body: "The affected store URL is https://store.example.test. One affected profile email is customer@example.test.",
      source: "manual",
    }),
  });
  setNow("2026-06-10T09:06:00.000Z");
  const partial = await json("/api/tickets/TKT-1001/recommendations", {
    method: "POST",
    body: JSON.stringify({ actor: "approval-desk" }),
  });
  await approveAndSend(json, "TKT-1001", partial.body.recommendation);

  setNow("2026-06-10T09:10:00.000Z");
  await json("/api/tickets/TKT-1001/customer-replies", {
    method: "POST",
    body: JSON.stringify({
      actor: "Maya Chen",
      body: "The event ID is evt_12345. The request ID is req_12345. The API response status is 400 validation_error.",
      source: "manual",
    }),
  });
  setNow("2026-06-10T09:11:00.000Z");
  const complete = await json("/api/tickets/TKT-1001/recommendations", {
    method: "POST",
    body: JSON.stringify({ actor: "approval-desk" }),
  });
  await approveAndSend(json, "TKT-1001", complete.body.recommendation);

  setNow("2026-06-10T09:15:00.000Z");
  const diagnosis = await json("/api/tickets/TKT-1001/diagnosis", {
    method: "POST",
    body: JSON.stringify({ actor: "product-support" }),
  });
  expect(diagnosis.status).toBe(201);
  setNow("2026-06-10T09:16:00.000Z");
  const update = await json("/api/tickets/TKT-1001/recommendations", {
    method: "POST",
    body: JSON.stringify({ actor: "approval-desk" }),
  });
  expect(update.status).toBe(201);
  return update.body.recommendation;
}
