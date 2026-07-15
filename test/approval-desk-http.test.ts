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

  it("marks an approved recommendation as sent five minutes after approval", async () => {
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
      timestamp: "2026-06-10T09:05:00.000Z",
      after: {
        sentAt: "2026-06-10T09:05:00.000Z",
        customerResponse: approvedResponse,
      },
    });
    expect(detail.body.recommendationSummary).toMatchObject({
      latestRecommendationId: created.body.recommendation.id,
      latestResolution: "approved",
      workflowState: "waiting",
      hasSentResponse: true,
      hasCustomerReply: false,
      latestSentAt: "2026-06-10T09:05:00.000Z",
    });
    expect(detail.body.conversationTimeline).toContainEqual(
      expect.objectContaining({
        kind: "support-response-sent",
        timestamp: "2026-06-10T09:05:00.000Z",
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
      latestSentAt: "2026-06-10T09:05:00.000Z",
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
        body: "Raw body handling has not changed since yesterday.",
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
