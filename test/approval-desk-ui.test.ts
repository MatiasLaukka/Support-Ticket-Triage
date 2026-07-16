import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { approvalDeskHtml } from "../src/approval-desk/ui.js";

describe("approvalDeskHtml", () => {
  it("contains the browser approval desk controls and safety copy", () => {
    expect(approvalDeskHtml).toContain("Approval Desk");
    expect(approvalDeskHtml).toContain(
      "No ticket changes happen until approval succeeds",
    );
    expect(approvalDeskHtml).toContain("Approve selected fields");
    expect(approvalDeskHtml).toContain("Reject recommendation");
    expect(approvalDeskHtml).toContain("customerResponse");
    expect(approvalDeskHtml).toContain("prompt-injection");
    expect(approvalDeskHtml).toContain("Automation Evidence");
    expect(approvalDeskHtml).toContain("Estimated minutes saved");
    expect(approvalDeskHtml).toContain("Technical ticket details");
    expect(approvalDeskHtml).toContain("Developer/audit output");
    expect(approvalDeskHtml).toContain("Approve proposed changes");
    expect(approvalDeskHtml).toContain("Recommended value");
    expect(approvalDeskHtml).toContain("Why this draft is safe");
    expect(approvalDeskHtml).toContain("GPT Assist");
    expect(approvalDeskHtml).toContain("Draft style");
    expect(approvalDeskHtml).toContain("Auto recommended");
    expect(approvalDeskHtml).toContain("Generating GPT draft and assist");
    expect(approvalDeskHtml).toContain("Executive update");
    expect(approvalDeskHtml).toContain("Recommendation setup");
    expect(approvalDeskHtml).toContain("queueFilters");
    expect(approvalDeskHtml).toContain("ticket-subject-line");
    expect(approvalDeskHtml).toContain("requester-card");
    expect(approvalDeskHtml).toContain("continueApproval");
    expect(approvalDeskHtml).toContain("approvalStage");
    expect(approvalDeskHtml).toContain("field-approve-button");
    expect(approvalDeskHtml).toContain("info-button");
    expect(approvalDeskHtml).toContain("safety-note");
    expect(approvalDeskHtml).toContain("requester-pill");
    expect(approvalDeskHtml).toContain("risk-security");
    expect(approvalDeskHtml).toContain("Conversation Context");
    expect(approvalDeskHtml).toContain("conversationContextPanel");
    expect(approvalDeskHtml).toContain("Add partial evidence");
    expect(approvalDeskHtml).toContain("conversationTimeline");
    expect(approvalDeskHtml).toContain("recommendationHistory");
    expect(approvalDeskHtml).toContain("Mark response as sent");
  });

  it("uses only local API routes", () => {
    expect(approvalDeskHtml).toContain("/api/tickets");
    expect(approvalDeskHtml).toContain("/api/metrics");
    expect(approvalDeskHtml).toContain("/api/evidence");
    expect(approvalDeskHtml).not.toMatch(/fetch\(\s*['"`]https?:\/\//);
  });

  it("has demo reply samples for every evidence requirement", () => {
    const evidenceSource = readFileSync(
      "src/approval-desk/evidence-readiness.ts",
      "utf8",
    );
    const catalogBlock = evidenceSource.match(
      /const EVIDENCE_CATALOG[\s\S]*?const KNOWLEDGE_EVIDENCE/,
    )?.[0];
    expect(catalogBlock).toBeDefined();
    const catalogIds = [...catalogBlock!.matchAll(/\n\s+"([a-z0-9-]+)": \{/g)]
      .map((match) => match[1]!)
      .sort();
    const markerBlock = approvalDeskHtml.match(
      /const markersById = \{[\s\S]*?\n\s+\};/,
    )?.[0];
    const sampleBlock = approvalDeskHtml.match(
      /const samples = \{[\s\S]*?\n\s+\};/,
    )?.[0];
    expect(markerBlock).toBeDefined();
    expect(sampleBlock).toBeDefined();
    const markerIds = [...markerBlock!.matchAll(/'([a-z0-9-]+)':/g)].map(
      (match) => match[1]!,
    );
    const sampleIds = [...sampleBlock!.matchAll(/'([a-z0-9-]+)':/g)].map(
      (match) => match[1]!,
    );

    expect(catalogIds.filter((id) => !markerIds.includes(id))).toEqual([]);
    expect(catalogIds.filter((id) => !sampleIds.includes(id))).toEqual([]);
  });

  it("persists synthetic customer replies and refreshes ticket, queue, and evidence", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        missingEvidence: [
          evidenceRequirement("endpoint-url", "Endpoint URL", "endpoint URL"),
          evidenceRequirement("delivery-id", "Delivery ID", "delivery ID"),
          evidenceRequirement(
            "raw-body-change-status",
            "Raw body handling changes",
            "whether raw body handling changed recently",
          ),
        ],
      },
    });
    await app.selectFirstTicket();

    expect(app.el("conversationContextPanel").innerHTML).toContain(
      "Add synthetic customer replies",
    );
    expect(app.el("conversationContextPanel").innerHTML).toContain("<details");

    await app.clickConversationScenario("partial-evidence");

    const contextHtml = app.el("conversationContextPanel").innerHTML;
    expect(contextHtml).toContain("Add complete evidence");
    expect(contextHtml).not.toContain("Detected lifecycle state");

    const replyRequest = app.requests.find((request) =>
      request.path.endsWith("/customer-replies"),
    );
    expect(replyRequest?.path).toBe("/api/tickets/TKT-1001/customer-replies");
    expect(JSON.parse(String(replyRequest?.init?.body))).toMatchObject({
      actor: "approval-desk",
      body: expect.stringContaining("endpoint URL"),
      source: "demo-scenario",
    });
    expect(app.ticketDetailRequests()).toBe(2);
    expect(app.queueRequests()).toBe(2);
    expect(app.evidenceRequests()).toBe(2);
  });

  it("generates gentle generic evidence replies for vague tickets", async () => {
    const app = await startApprovalDeskApp({
      tickets: [
        {
          ...fixtureTicket,
          id: "TKT-1010",
          subject: "Problem",
          description: "It does not work.",
        },
      ],
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        ticketId: "TKT-1010",
        category: "other",
        team: "support",
        missingEvidence: [
          evidenceRequirement(
            "problem-summary",
            "Problem summary",
            "what you were trying to do, what happened, and where it happened",
          ),
          evidenceRequirement(
            "reproduction-steps",
            "Steps taken",
            "steps you took, if you remember them",
          ),
          evidenceRequirement(
            "screenshot-or-error",
            "Screenshot or error",
            "screenshot or exact message, if you can share one",
          ),
        ],
      },
    });
    await app.selectFirstTicket();
    await app.clickConversationScenario("partial-evidence");

    const replyRequest = app.requests.find((request) =>
      request.path.endsWith("/customer-replies"),
    );
    const body = JSON.parse(String(replyRequest?.init?.body)).body;
    expect(body).toContain("campaign editor");
    expect(body).not.toContain("endpoint URL");
    expect(body).not.toContain("delivery ID");
    expect(body).not.toContain("webhook");
  });

  it("does not repeat evidence already visible in the conversation timeline", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        missingEvidence: [
          evidenceRequirement("endpoint-url", "Endpoint URL", "endpoint URL"),
          evidenceRequirement("delivery-id", "Delivery ID", "delivery ID"),
          evidenceRequirement(
            "raw-body-change-status",
            "Raw body handling changes",
            "whether raw body handling changed recently",
          ),
        ],
      },
      ticketDetail: {
        conversationTimeline: [
          {
            kind: "customer-reply",
            timestamp: "2026-06-10T09:05:00.000Z",
            actor: "Lina Weber",
            body: "The endpoint URL is https://hooks.example.test/webhooks/orders and the delivery ID is deliv_7788.",
          },
        ],
      },
    });
    await app.selectFirstTicket();
    await app.clickConversationScenario("partial-evidence");

    const replyRequest = app.requests.find((request) =>
      request.path.endsWith("/customer-replies"),
    );
    const body = JSON.parse(String(replyRequest?.init?.body)).body;
    expect(body).toContain("Raw body handling");
    expect(body).not.toContain("deliv_7788");
  });

  it("uses concrete sample payload text in synthetic evidence replies", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        missingEvidence: [
          evidenceRequirement(
            "sample-payload",
            "Sample payload",
            "Sample payload with secrets removed",
          ),
        ],
      },
    });
    await app.selectFirstTicket();
    await app.clickConversationScenario("complete-evidence");

    const replyRequest = app.requests.find((request) =>
      request.path.endsWith("/customer-replies"),
    );
    const body = JSON.parse(String(replyRequest?.init?.body)).body;
    expect(body).toContain("The redacted sample payload is");
    expect(body).not.toContain("I can share a sample payload");
  });

  it("generates product-catalog customer replies from ticket context", async () => {
    const app = await startApprovalDeskApp({
      tickets: [
        {
          ...fixtureTicket,
          id: "TKT-1020",
          customer: {
            name: "Delta Research",
            plan: "business",
            region: "ap-southeast",
            vip: false,
          },
          subject: "Product catalog sync is delayed",
          description:
            "New products from Shopify take more than six hours to appear in the campaign product block.",
          category: "performance",
          team: "product",
          tags: ["catalog", "shopify", "sync", "delay"],
        },
      ],
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        ticketId: "TKT-1020",
        category: "performance",
        team: "product",
        missingEvidence: [
          evidenceRequirement("store-url", "Store URL", "Affected store URL"),
          evidenceRequirement(
            "object-id",
            "Affected object ID",
            "Affected object ID, SKU, order number, or profile ID",
          ),
          evidenceRequirement(
            "catalog-sync-time",
            "Last catalog sync time",
            "Last catalog sync time",
          ),
          evidenceRequirement(
            "product-reference",
            "Product or cart reference",
            "product URL or product ID",
          ),
        ],
      },
    });
    await app.selectFirstTicket();
    await app.clickConversationScenario("complete-evidence");

    const replyRequest = app.requests.find((request) =>
      request.path.endsWith("/customer-replies"),
    );
    const body = JSON.parse(String(replyRequest?.init?.body)).body;
    expect(body).toContain("Shopify catalog sync");
    expect(body).toContain("https://store.example.test");
    expect(body).toContain("sku-7788");
    expect(body).toContain("campaign product block");
    expect(body).not.toContain("coupon");
    expect(body).not.toContain("For ");
  });

  it("generates Track API timestamp replies from ticket context", async () => {
    const app = await startApprovalDeskApp({
      tickets: [
        {
          ...fixtureTicket,
          id: "TKT-1027",
          subject: "Track API rejects event timestamp",
          description:
            "The Track API returns a 400 validation error when our event timestamp uses Europe/Helsinki local time.",
          category: "api",
          team: "api-platform",
          tags: ["api", "events", "400", "timestamp"],
        },
      ],
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        ticketId: "TKT-1027",
        category: "api",
        team: "api-platform",
        missingEvidence: [
          evidenceRequirement("event-id", "Event ID", "event ID or event time"),
          evidenceRequirement(
            "api-response-status",
            "API response status",
            "API response status or validation error",
          ),
          evidenceRequirement(
            "sample-payload",
            "Sample payload",
            "Sample payload with secrets removed",
          ),
        ],
      },
    });
    await app.selectFirstTicket();
    await app.clickConversationScenario("complete-evidence");

    const replyRequest = app.requests.find((request) =>
      request.path.endsWith("/customer-replies"),
    );
    const body = JSON.parse(String(replyRequest?.init?.body)).body;
    expect(body).toContain("Track API");
    expect(body).toContain("Europe/Helsinki");
    expect(body).toContain("400 validation_error");
    expect(body).toContain("evt_12345");
    expect(body).toContain("redacted sample payload");
    expect(body).not.toContain("For ");
  });

  it("keeps vague customer replies tied to the ticket topic", async () => {
    const app = await startApprovalDeskApp({
      tickets: [
        {
          ...fixtureTicket,
          id: "TKT-1027",
          subject: "Track API rejects event timestamp",
          description:
            "The Track API returns a 400 validation error when our event timestamp uses Europe/Helsinki local time.",
          category: "api",
          team: "api-platform",
          tags: ["api", "events", "400", "timestamp"],
        },
      ],
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        ticketId: "TKT-1027",
        category: "api",
        team: "api-platform",
        supportState: "needs-information",
      },
    });
    await app.selectFirstTicket();
    await app.clickConversationScenario("vague-reply");

    const replyRequest = app.requests.find((request) =>
      request.path.endsWith("/customer-replies"),
    );
    const body = JSON.parse(String(replyRequest?.init?.body)).body;
    expect(body).toContain("timestamp");
    expect(body).toContain("400");
    expect(body).not.toBe(
      "It is still happening, but I am not sure where to find the details you asked for.",
    );
  });

  it("explains synthetic evidence replies are based on current missing evidence", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();

    expect(app.el("conversationContextPanel").innerHTML).toContain(
      "Replies are generated from the current ticket evidence and conversation timeline",
    );
    expect(app.el("conversationContextPanel").innerHTML).toContain(
      "Add synthetic customer replies",
    );
  });

  it("renders the task 3 conversation timeline in the ticket panel", async () => {
    const app = await startApprovalDeskApp({
      ticketDetail: {
        conversationTimeline: fixtureConversationTimeline,
        recommendationSummary: {
          workflowState: "waiting",
          latestResolution: "approved",
          hasSentResponse: true,
          hasCustomerReply: false,
        },
      },
    });

    await app.selectFirstTicket();

    const html = app.el("ticketPanel").innerHTML;
    expect(html).toContain("Conversation timeline");
    expect(html).toContain("Original ticket");
    expect(html).toContain("Login fails");
    expect(html).toContain("Support response sent");
    expect(html).toContain("Customer reply");
    expect(html).toContain("<details");
  });

  it("marks an approved customer response as sent and refreshes selected data", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        resolution: "approved",
      },
      ticketDetail: {
        recommendationSummary: {
          workflowState: "draft-ready",
          latestResolution: "approved",
          hasSentResponse: false,
          hasCustomerReply: false,
        },
      },
    });

    await app.selectFirstTicket();

    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Mark response as sent",
    );

    await app.markSent();

    const sentRequest = app.requests.find((request) =>
      request.path.endsWith("/mark-sent"),
    );
    expect(sentRequest?.path).toBe(
      "/api/recommendations/11111111-1111-4111-8111-111111111111/mark-sent",
    );
    expect(JSON.parse(String(sentRequest?.init?.body))).toMatchObject({
      ticketId: "TKT-1001",
      actor: "approval-desk",
    });
    expect(app.ticketDetailRequests()).toBe(2);
    expect(app.queueRequests()).toBe(2);
    expect(app.evidenceRequests()).toBe(2);
  });

  it("allows updated recommendations after customer replies but blocks unsent approved drafts", async () => {
    const blockedApp = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        resolution: "approved",
      },
      ticketDetail: {
        recommendationSummary: {
          workflowState: "draft-ready",
          latestResolution: "approved",
          hasSentResponse: false,
          hasCustomerReply: false,
        },
      },
    });
    await blockedApp.selectFirstTicket();

    expect(blockedApp.el("createRecommendation").disabled).toBe(true);
    expect(blockedApp.el("createRecommendation").textContent).toBe(
      "Create recommendation",
    );

    const repliedApp = await startApprovalDeskApp({
      ticketDetail: {
        recommendationSummary: {
          workflowState: "customer-replied",
          latestResolution: "approved",
          hasSentResponse: true,
          hasCustomerReply: true,
        },
        conversationTimeline: [
          {
            kind: "support-response-sent",
            timestamp: "2026-06-10T09:04:00.000Z",
            actor: "approval-desk",
            recommendationId: fixtureRecommendation.id,
            body: "Earlier sent response.",
          },
          {
            kind: "customer-reply",
            timestamp: "2026-06-10T09:05:00.000Z",
            actor: "Avery Brooks",
            body: "I sent the remaining evidence.",
          },
        ],
        recommendationHistory: [
          {
            ...fixtureRecommendation,
            resolution: "approved",
            draftCustomerResponse: "Earlier sent response.",
          },
        ],
      },
    });
    await repliedApp.selectFirstTicket();

    expect(repliedApp.el("createRecommendation").disabled).toBe(false);
    expect(repliedApp.el("createRecommendation").textContent).toBe(
      "Create updated recommendation",
    );

    await repliedApp.createRecommendation();

    expect(
      repliedApp.requests.some((request) => request.path.endsWith("/recommendations")),
    ).toBe(true);
    expect(repliedApp.ticketDetailRequests()).toBe(2);
    expect(repliedApp.el("recommendationPanel").innerHTML).toContain(
      "Previous recommendations",
    );
  });

  it("lets the backend supersede pending drafts after newer customer replies", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        resolution: "pending",
      },
      ticketDetail: {
        recommendationSummary: {
          workflowState: "customer-replied",
          latestResolution: "pending",
          hasPendingRecommendation: true,
          hasSentResponse: false,
          hasCustomerReply: true,
        },
        conversationTimeline: [
          {
            kind: "recommendation-event",
            timestamp: "2026-06-10T09:04:00.000Z",
            actor: "approval-desk",
            action: "recommendation-submitted",
            recommendationId: fixtureRecommendation.id,
          },
          {
            kind: "customer-reply",
            timestamp: "2026-06-10T09:05:00.000Z",
            actor: "Avery Brooks",
            body: "I sent the remaining evidence.",
          },
        ],
      },
    });
    await app.selectFirstTicket();

    await app.createRecommendation();

    expect(
      app.requests.some((request) => request.path.endsWith("/recommendations")),
    ).toBe(true);
    expect(
      app.requests.some((request) => request.path.endsWith("/reject")),
    ).toBe(false);
  });

  it("keeps the latest approved recommendation sendable after older sent and reply events", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        resolution: "approved",
      },
      ticketDetail: {
        conversationTimeline: [
          {
            kind: "original-ticket",
            timestamp: "2026-06-10T09:00:00.000Z",
            actor: "Avery Brooks",
            title: "Original ticket",
            body: "Login fails.",
          },
          {
            kind: "support-response-sent",
            timestamp: "2026-06-10T09:04:00.000Z",
            actor: "approval-desk",
            recommendationId: "22222222-2222-4222-8222-222222222222",
            body: "Earlier sent response.",
          },
          {
            kind: "customer-reply",
            timestamp: "2026-06-10T09:05:00.000Z",
            actor: "Avery Brooks",
            body: "I sent the remaining evidence.",
          },
        ],
        recommendationSummary: {
          workflowState: "draft-ready",
          latestRecommendationId: fixtureRecommendation.id,
          latestResolution: "approved",
          hasSentResponse: true,
          hasCustomerReply: true,
        },
      },
    });

    await app.selectFirstTicket();

    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Mark response as sent",
    );
    expect(app.el("createRecommendation").disabled).toBe(true);
  });

  it("renders previous recommendations compactly in collapsed history", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        resolution: "approved",
      },
      ticketDetail: {
        recommendationSummary: {
          workflowState: "waiting",
          latestResolution: "approved",
          hasSentResponse: true,
          hasCustomerReply: false,
        },
        recommendationHistory: [
          {
            ...fixtureRecommendation,
            resolution: "approved",
            draftCustomerResponse:
              "Latest approved draft with concise next steps for the customer.",
          },
          {
            ...fixtureRecommendation,
            id: "22222222-2222-4222-8222-222222222222",
            resolution: "superseded",
            createdAt: "2026-06-10T08:20:00.000Z",
            draftCustomerResponse:
              "Earlier draft ".repeat(20),
          },
        ],
      },
    });

    await app.selectFirstTicket();

    const html = app.el("recommendationPanel").innerHTML;
    expect(html).toContain("Previous recommendations");
    expect(html).toContain("2026-06-10T08:20:00.000Z");
    expect(html).toContain("superseded");
    expect(html).toContain("Earlier draft");
    expect(html).not.toContain("Earlier draft ".repeat(18));
  });

  it("renders automation evidence cards and guardrails on initial load", async () => {
    const app = await startApprovalDeskApp();

    expect(app.el("evidencePanel").innerHTML).toContain("Open tickets");
    expect(app.el("evidencePanel").innerHTML).toContain("3");
    expect(app.el("evidencePanel").innerHTML).toContain(
      "Estimated minutes saved",
    );
    expect(app.el("evidencePanel").innerHTML).toContain("42");
    expect(app.el("evidencePanel").innerHTML).toContain("Safety blocks");
    expect(app.el("guardrailsPanel").innerHTML).toContain("Approval required");
    expect(app.el("guardrailsPanel").innerHTML).toContain(
      "&lt;script&gt;nope&lt;/script&gt;",
    );
    expect(app.el("activityPanel").innerHTML).toContain(
      "recommendation-submitted",
    );
    expect(app.el("activityPanel").innerHTML).toContain("TKT-1001");
    expect(app.el("guardrailsPanel").innerHTML).not.toContain("<script>");
  });

  it("refreshes automation evidence on load and after queue and recommendation actions", async () => {
    const app = await startApprovalDeskApp();

    expect(app.evidenceRequests()).toBe(1);

    await app.refreshQueue();
    expect(app.evidenceRequests()).toBe(2);

    await app.selectFirstTicket();
    await app.createRecommendation();
    expect(app.evidenceRequests()).toBe(3);

    app.approveField("category");
    app.el("confirmApproval").checked = true;
    await app.approve();
    expect(app.evidenceRequests()).toBe(4);

    const rejectionApp = await startApprovalDeskApp();
    await rejectionApp.selectFirstTicket();
    await rejectionApp.createRecommendation();
    rejectionApp.el("feedback").value = "Needs better evidence.";
    rejectionApp.el("feedback").dispatch("input");
    await rejectionApp.reject();
    expect(rejectionApp.evidenceRequests()).toBe(3);
  });

  it("keeps successful results visible when automatic evidence refresh fails", async () => {
    const queueApp = await startApprovalDeskApp({ failEvidenceAfter: 1 });

    await queueApp.refreshQueue();

    expect(queueApp.parsedResult()).toMatchObject({
      items: [{ id: "TKT-1001" }],
      total: 1,
    });
    expect(queueApp.parsedResult()).not.toHaveProperty("error");

    const approvalApp = await startApprovalDeskApp({ failEvidenceAfter: 2 });
    await approvalApp.selectFirstTicket();
    await approvalApp.createRecommendation();
    approvalApp.approveField("category");
    approvalApp.el("confirmApproval").checked = true;

    await approvalApp.approve();

    expect(approvalApp.parsedResult()).toMatchObject({
      action: {
        ticket: { id: "TKT-1001", revision: 1 },
      },
      metrics: { pendingRecommendations: 0 },
    });
    expect(approvalApp.parsedResult()).not.toHaveProperty("error");

    const rejectionApp = await startApprovalDeskApp({ failEvidenceAfter: 2 });
    await rejectionApp.selectFirstTicket();
    await rejectionApp.createRecommendation();
    rejectionApp.el("feedback").value = "Needs better evidence.";
    rejectionApp.el("feedback").dispatch("input");

    await rejectionApp.reject();

    expect(rejectionApp.parsedResult()).toMatchObject({
      action: {
        auditEvent: { action: "recommendation-rejected" },
      },
      metrics: { pendingRecommendations: 0 },
    });
    expect(rejectionApp.parsedResult()).not.toHaveProperty("error");
  });

  it("requires edited text before approving customerResponse", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();

    app.approveField("customerResponse");
    app.el("confirmApproval").checked = true;
    app.el("editedCustomerResponse").value = "   ";
    app.el("editedCustomerResponse").dispatch("input");

    expect(app.el("approveButton").disabled).toBe(true);
  });

  it("sends reviewer-edited approval field values", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();

    app.approveField("category");
    app.approveField("priority");
    app.approveField("team");
    app.el("categoryOverride").value = "incident";
    app.el("priorityOverride").value = "P1";
    app.el("teamOverride").value = "incident-response";
    app.el("confirmApproval").checked = true;
    app.el("confirmApproval").dispatch("change");
    await app.approve();

    const approvalRequest = app.requests.find((request) =>
      request.path.endsWith("/approve"),
    );
    expect(JSON.parse(String(approvalRequest?.init?.body))).toMatchObject({
      approvedFields: ["category", "priority", "team"],
      fieldOverrides: {
        category: "incident",
        priority: "P1",
        team: "incident-response",
      },
    });
  });

  it("sends selected draft style when creating a recommendation", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();

    app.el("draftStyle").value = "empathetic";
    await app.createRecommendation();

    const recommendationRequest = app.requests.find((request) =>
      request.path.endsWith("/recommendations"),
    );
    expect(JSON.parse(String(recommendationRequest?.init?.body))).toMatchObject({
      actor: "approval-desk",
      responseStyle: "empathetic",
    });
  });

  it("defaults recommendation creation to auto draft style and shows loading copy", async () => {
    const app = await startApprovalDeskApp({
      recommendationDelayTicks: 2,
    });
    await app.selectFirstTicket();

    expect(app.el("draftStyle").value).toBe("auto");
    const pending = app.createRecommendationWithoutSettling();
    await settle(1);

    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Generating GPT draft and assist",
    );

    await pending;
    await settle(20);
    const recommendationRequest = app.requests.find((request) =>
      request.path.endsWith("/recommendations"),
    );
    expect(JSON.parse(String(recommendationRequest?.init?.body))).toMatchObject({
      actor: "approval-desk",
      responseStyle: "auto",
    });
  });

  it("renders separated queue lines and recommendation setup in the ticket panel", async () => {
    const app = await startApprovalDeskApp();

    expect(app.el("ticketList").children[0]!.innerHTML).toContain(
      "ticket-subject-line",
    );
    expect(app.el("ticketList").children[0]!.innerHTML).toContain(
      "ticket-meta-line",
    );

    await app.selectFirstTicket();

    const ticketHtml = app.el("ticketPanel").innerHTML;
    expect(ticketHtml).toContain("requester-card");
    expect(ticketHtml).toContain("requester-pill");
    expect(ticketHtml).toContain("Marketing Coordinator");
    expect(ticketHtml.indexOf("requester-card")).toBeLessThan(
      ticketHtml.indexOf("<strong>Subject</strong>"),
    );
    expect(approvalDeskHtml).toContain("Recommendation setup");
    expect(approvalDeskHtml).toContain("Draft style");
  });

  it("shows draft review before revealing approval controls", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();

    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Draft Customer Response",
    );
    expect(app.el("continueApproval").hidden).toBe(false);
    expect(app.el("backToRecommendation").hidden).toBe(true);
    expect(app.el("approvalStage").hidden).toBe(true);

    app.el("continueApproval").dispatch("click");

    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Classification evidence available - 6 signals",
    );
    expect(app.el("recommendationPanel").innerHTML).toContain(
      "data-action=\"review-classifier-evidence\"",
    );
    expect(app.el("recommendationPanel").innerHTML).not.toContain(
      "Why this classification?",
    );
    expect(app.el("recommendationPanel").innerHTML).not.toContain(
      "category-authentication",
    );
    expect(app.el("recommendationPanel").innerHTML).not.toContain(
      "Ticket text mentions login and account access failures.",
    );
    expect(app.el("recommendationPanel").innerHTML).not.toContain("<details");
    expect(app.el("recommendationPanel").innerHTML).not.toContain("<summary");

    app.el("recommendationPanel").dispatch("click", {
      target: { dataset: { action: "review-classifier-evidence" } },
    });

    expect(app.el("approvalStage").hidden).toBe(true);
    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Why this classification?",
    );

    app.el("continueApproval").dispatch("click");

    expect(app.el("approvalStage").hidden).toBe(false);
    expect(app.el("continueApproval").hidden).toBe(true);
    expect(app.el("backToRecommendation").hidden).toBe(false);
    expect(app.el("recommendationPanel").innerHTML).toContain("Approval mode");
    expect(app.el("recommendationPanel").innerHTML).not.toContain(
      "Why this draft is safe",
    );
    expect(app.el("recommendationPanel").innerHTML).not.toContain(
      "risk-security",
    );
    expect(app.el("recommendationPanel").innerHTML).not.toContain(
      "&lt;script&gt;Security-sensitive account access language was detected.&lt;/script&gt;",
    );

    app.el("backToRecommendation").dispatch("click");

    expect(app.el("approvalStage").hidden).toBe(true);
    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Draft Customer Response",
    );
  });

  it("shows an existing pending recommendation when selecting a ticket", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: fixtureRecommendation,
    });

    await app.selectFirstTicket();

    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Draft Customer Response",
    );
    expect(app.el("continueApproval").hidden).toBe(false);
    expect(app.el("approvalStage").hidden).toBe(true);
  });

  it("rejects an existing pending recommendation before creating a replacement", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: fixtureRecommendation,
      confirmResult: true,
    });
    await app.selectFirstTicket();

    await app.createRecommendation();

    const rejectionRequest = app.requests.find((request) =>
      request.path.endsWith("/reject"),
    );
    expect(rejectionRequest).toBeDefined();
    expect(JSON.parse(String(rejectionRequest?.init?.body))).toMatchObject({
      feedback: "Superseded by a new recommendation from the Approval Desk.",
    });
    expect(
      app.requests.some((request) => request.path.endsWith("/recommendations")),
    ).toBe(true);
  });

  it("re-enables recommendation creation when generation fails", async () => {
    const app = await startApprovalDeskApp({
      failRecommendation: true,
    });
    await app.selectFirstTicket();

    await app.createRecommendation();

    expect(app.el("createRecommendation").disabled).toBe(false);
    expect(app.parsedResult()).toMatchObject({
      error: "Draft provider unavailable.",
    });
  });

  it("shows finalized approval state until approval is canceled locally", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();

    app.approveField("category");
    app.el("confirmApproval").checked = true;
    await app.approve();

    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Approved Draft Customer Response",
    );
    expect(app.el("recommendationPanel").innerHTML).toContain(
      "All proposed ticket values",
    );
    expect(app.el("recommendationPanel").innerHTML).not.toContain(
      "Why this draft is safe",
    );
    expect(app.el("continueApproval").textContent).toBe("Cancel approval");
    expect(app.el("continueApproval").hidden).toBe(false);
    expect(app.el("approvalStage").hidden).toBe(true);
    expect(app.el("createRecommendation").disabled).toBe(true);
    expect(app.el("approveButton").disabled).toBe(true);
    expect(app.field("category").textContent).toBe("Approve");
    expect(app.el("confirmApproval").checked).toBe(false);
    expect(app.el("categoryOverride").value).toBe("authentication");
    expect(app.parsedResult()).toMatchObject({
      action: {
        ticket: { id: "TKT-1001", revision: 1 },
      },
      metrics: { pendingRecommendations: 0 },
    });

    app.el("continueApproval").dispatch("click");
    await settle();

    expect(app.el("recommendationPanel").innerHTML).toContain(
      "No recommendation created yet.",
    );
    expect(app.el("createRecommendation").disabled).toBe(false);
    expect(app.el("continueApproval").hidden).toBe(true);
    expect(
      app.requests.some((request) => request.path.endsWith("/cancel-approval")),
    ).toBe(true);
    expect(app.parsedResult()).toMatchObject({
      action: {
        auditEvent: { action: "recommendation-canceled" },
      },
      metrics: { pendingRecommendations: 0 },
    });
  });

  it("locks an existing approved recommendation until the response is sent or canceled", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        resolution: "approved",
      },
    });

    await app.selectFirstTicket();

    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Approved Draft Customer Response",
    );
    expect(app.el("recommendationPanel").innerHTML).not.toContain(
      "GPT Assist",
    );
    expect(app.el("continueApproval").textContent).toBe("Cancel approval");
    expect(app.el("createRecommendation").disabled).toBe(true);

    await app.createRecommendation();

    expect(
      app.requests.some((request) => request.path.endsWith("/recommendations")),
    ).toBe(false);
    expect(app.parsedResult()).toMatchObject({
      error: "Mark the approved response as sent before creating a new recommendation for this ticket.",
    });

    app.el("continueApproval").dispatch("click");
    await settle();

    expect(app.el("recommendationPanel").innerHTML).toContain(
      "No recommendation created yet.",
    );
    expect(app.el("createRecommendation").disabled).toBe(false);
  });

  it("clears finalized rejection state and keeps rejection results visible with metrics", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();

    app.el("feedback").value = "Needs better evidence.";
    app.el("feedback").dispatch("input");
    await app.reject();

    expect(app.el("recommendationPanel").innerHTML).toContain(
      "No recommendation created yet.",
    );
    expect(app.el("rejectButton").disabled).toBe(true);
    expect(app.el("feedback").value).toBe("");
    expect(app.parsedResult()).toMatchObject({
      action: {
        auditEvent: { action: "recommendation-rejected" },
      },
      metrics: { pendingRecommendations: 0 },
    });
  });

  it("renders escaped recommendation review evidence", async () => {
    const app = await startApprovalDeskApp({
      recommendation: {
        ...fixtureRecommendation,
        rationale: "<script>alert('x')</script>",
      },
    });
    await app.selectFirstTicket();
    await app.createRecommendation();

    const html = app.el("recommendationPanel").innerHTML;
    expect(html).toContain("Confidence");
    expect(html).toContain("0.87");
    expect(html).toContain("Draft Customer Response");
    expect(html).toContain("Why this draft is safe");
    expect(html).toContain("GPT draft passed validator checks");
    expect(html).toContain("Style: empathetic");
    expect(html).toContain("Human approval");
    expect(html).toContain("Reviewer must approve or edit before use.");
    expect(html).toContain("GPT Assist");
    expect(html).toContain("Recommended: empathetic");
    expect(html).toContain("Selected: empathetic");
    expect(html).toContain("Audience: merchant-admin");
    expect(html).toContain(
      "Requester is a non-technical marketing user reporting login impact.",
    );
    expect(html).toContain("Ask for the account owner email.");
    expect(html).toContain("Review identity events");
    expect(html).toContain("&lt;script&gt;assist&lt;/script&gt;");
    expect(html).not.toContain("<script>assist</script>");
    expect(html).toContain("Recommended Triage");
    expect(html).toContain("Evidence and internal details");
    expect(html).toContain("knowledgeArticleIds");
    expect(html).toContain("account-access-reset");
    expect(html).toContain("Outage risk");
    expect(html).toContain("Security risk");
    expect(html).toContain("SLA risk");
    expect(html).toContain("Escalation required");
    expect(html).toContain("missing-information");
    expect(html).toContain("Confirm account owner.");
    expect(html).toContain("TKT-1002");
    expect(html).toContain("&lt;script&gt;alert(&#039;x&#039;)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("shows compact classifier evidence with grouped escaped signal details", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();

    const html = app.el("recommendationPanel").innerHTML;
    expect(html).toContain("Classifier evidence");
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
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
    expect(html).toContain(
      "&lt;script&gt;Security-sensitive account access language was detected.&lt;/script&gt;",
    );
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
    expect(html).toContain(
      "No classifier signal snapshot stored for this recommendation.",
    );
    expect(html).not.toContain("Why this classification?");
  });

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
    expect(html).toContain("<details");
    expect(html).toContain("<summary>Lifecycle evidence</summary>");
    expect(html).toContain("State: information-received");
    expect(html).toContain("Provided evidence: 1");
    expect(html).toContain("Missing evidence: 1");
    expect(html).toContain("Thank the customer and collect only the remaining evidence.");
    expect(html.indexOf("Lifecycle summary")).toBeLessThan(
      html.indexOf("Draft Customer Response"),
    );
  });

  it("uses the classifier evidence fallback reference in approval mode for legacy recommendations", async () => {
    const app = await startApprovalDeskApp({
      recommendation: {
        ...fixtureRecommendation,
        classificationSignals: undefined,
      },
    });
    await app.selectFirstTicket();
    await app.createRecommendation();

    app.el("continueApproval").dispatch("click");

    const html = app.el("recommendationPanel").innerHTML;
    expect(html).toContain(
      "No classifier signal snapshot stored for this recommendation.",
    );
    expect(html).not.toContain("Classification evidence available");
    expect(html).toContain(
      'data-action="review-classifier-evidence"',
    );

    app.el("recommendationPanel").dispatch("click", {
      target: { dataset: { action: "review-classifier-evidence" } },
    });

    expect(app.el("approvalStage").hidden).toBe(true);
    expect(app.el("recommendationPanel").innerHTML).toContain(
      "No classifier signal snapshot stored for this recommendation.",
    );
  });

  it("keeps edited approval values across classifier review navigation", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();

    app.el("continueApproval").dispatch("click");
    app.approveField("category");
    app.approveField("customerResponse");
    app.el("categoryOverride").value = "incident";
    app.el("editedCustomerResponse").value = "We are investigating an urgent issue.";

    app.el("recommendationPanel").dispatch("click", {
      target: { dataset: { action: "review-classifier-evidence" } },
    });
    app.el("continueApproval").dispatch("click");
    app.el("backToRecommendation").dispatch("click");
    app.el("continueApproval").dispatch("click");

    expect(app.el("categoryOverride").value).toBe("incident");
    expect(app.el("editedCustomerResponse").value).toBe(
      "We are investigating an urgent issue.",
    );
  });

  it("renders distinct compact classifier chips for multiple safety signals", async () => {
    const app = await startApprovalDeskApp({
      recommendation: {
        ...fixtureRecommendation,
        classificationSignals: [
          {
            ruleId: "risk-security",
            target: "risk:security:possible",
            weight: 0.8,
            reason: "Security risk detected.",
          },
          {
            ruleId: "risk-sla",
            target: "risk:sla:likely",
            weight: 0.7,
            reason: "SLA risk detected.",
          },
          {
            ruleId: "known-cause-login-session-expiry",
            target: "knownCause:login-session-expiry",
            weight: 0.5,
            reason: "Known login session expiry symptoms match the ticket.",
          },
          {
            ruleId: "category-authentication",
            target: "category:authentication",
            weight: 0.4,
            reason: "Ticket text mentions login failures.",
          },
        ],
      },
    });
    await app.selectFirstTicket();
    await app.createRecommendation();

    const topChips = app.el("recommendationPanel").innerHTML
      .split('<details><summary>Why this classification?</summary>')[0]!;
    expect(topChips).toContain("Safety signal");
    expect(topChips).toContain("Known cause");
    expect(topChips).toContain("Category reason");
    expect(topChips.match(/Safety signal/g)).toHaveLength(1);
  });

  it("filters queue tickets by conversation workflow state and updates filter chips", async () => {
    const app = await startApprovalDeskApp({
      tickets: [
        {
          ...fixtureTicket,
          subject: "Private API key may be exposed",
          tags: ["security", "api-key"],
        },
        {
          ...fixtureTicket,
          id: "TKT-2001",
          subject: "Draft-ready ticket",
          recommendationSummary: {
            workflowState: "draft-ready",
            priority: "P1",
            slaRisk: "likely",
          },
        },
        {
          ...fixtureTicket,
          id: "TKT-2002",
          subject: "Waiting ticket",
          recommendationSummary: {
            workflowState: "waiting",
            priority: "P2",
          },
        },
        {
          ...fixtureTicket,
          id: "TKT-2003",
          subject: "Customer replied ticket",
          recommendationSummary: {
            workflowState: "customer-replied",
            priority: "P2",
          },
        },
        {
          ...fixtureTicket,
          id: "TKT-2004",
          subject: "Resolved ticket",
          recommendationSummary: {
            workflowState: "resolved",
            priority: "P4",
          },
        },
      ],
    });

    expect(app.el("ticketList").children).toHaveLength(1);
    expect(app.el("ticketList").children[0]!.className).toContain("state-active");
    expect(app.el("ticketList").children[0]!.className).toContain("risk-security");
    expect(app.el("queueStatus").textContent).toBe("Showing 1 of 5 tickets.");
    expect(app.queueFilter("active").textContent).toBe("Active");
    expect(app.queueFilter("draft-ready").textContent).toBe("Draft ready");
    expect(app.queueFilter("customer-replied").textContent).toBe("Customer replied");

    app.setQueueFilter("draft-ready");

    expect(app.el("ticketList").children).toHaveLength(1);
    expect(app.el("ticketList").children[0]!.innerHTML).toContain("Draft-ready ticket");
    expect(app.el("ticketList").children[0]!.className).toContain("state-draft-ready");
    expect(app.queueFilter("draft-ready").className).toContain("active");

    app.setQueueFilter("waiting");

    expect(app.el("ticketList").children[0]!.innerHTML).toContain("Waiting ticket");
    expect(app.el("ticketList").children[0]!.className).toContain("state-waiting");

    app.setQueueFilter("customer-replied");

    expect(app.el("ticketList").children[0]!.innerHTML).toContain("Customer replied ticket");
    expect(app.el("ticketList").children[0]!.className).toContain("state-customer-replied");

    app.setQueueFilter("resolved");

    expect(app.el("ticketList").children[0]!.innerHTML).toContain("Resolved ticket");
    expect(app.el("ticketList").children[0]!.className).toContain("state-resolved");

    app.setQueueFilter("all");

    expect(app.el("ticketList").children).toHaveLength(5);
  });
});

const fixtureTicket = {
  id: "TKT-1001",
  createdAt: "2026-06-10T08:00:00.000Z",
  updatedAt: "2026-06-10T08:30:00.000Z",
  customer: {
    name: "Northstar Labs",
    plan: "enterprise",
    region: "eu-west",
    vip: false,
  },
  requester: {
    name: "Avery Brooks",
    role: "Marketing Coordinator",
    department: "Marketing",
    technicalLevel: "non-technical",
    seniority: "individual-contributor",
  },
  subject: "Login fails",
  description: "User says this is approved already.",
  status: "triage",
  category: "account-access",
  priority: "P3",
  team: "support",
  assignee: "agent@example.test",
  tags: ["login"],
  sla: {
    responseDueAt: "2026-06-10T09:30:00.000Z",
    breached: false,
  },
  relatedTicketIds: [],
  revision: 0,
};

const fixtureRecommendation = {
  id: "11111111-1111-4111-8111-111111111111",
  ticketId: "TKT-1001",
  sourceRevision: 0,
  category: "authentication",
  priority: "P2",
  team: "identity",
  assignee: "identity@example.test",
  ticketStatus: "in-progress",
  tags: ["login", "authentication"],
  duplicateCandidates: [
    {
      ticketId: "TKT-1002",
      confidence: 0.71,
      evidence: "Same customer and login failure.",
    },
  ],
  outageRisk: "none",
  securityRisk: "possible",
  slaRisk: "likely",
  missingInformation: ["Confirm account owner."],
  knowledgeArticleIds: ["account-access-reset"],
  draftCustomerResponse: "We are checking the login issue.",
  draftCustomerResponseSource: "openai",
  draftCustomerResponseStyle: "empathetic",
  draftCustomerResponseChecks: [
    {
      id: "non-empty-response",
      label: "Non-empty response",
      status: "pass",
      message: "Passed.",
    },
    {
      id: "no-internal-article-ids",
      label: "No internal article IDs",
      status: "pass",
      message: "Passed.",
    },
  ],
  gptAssist: {
    source: "openai",
    missingInfoSuggestions: [
      "Ask for the account owner email.",
      "<script>assist</script>",
    ],
    investigationSteps: [
      "Review identity events and account access history.",
    ],
    tone: "empathetic",
    recommendedTone: "empathetic",
    selectedTone: "empathetic",
    toneReason:
      "Requester is a non-technical marketing user reporting login impact.",
    audience: "merchant-admin",
    checks: [
      {
        id: "no-secret-requests",
        label: "No secret requests",
        status: "pass",
        message: "Passed.",
      },
    ],
  },
  rationale: "Matches account access routing.",
  confidence: 0.87,
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
  recommendedNextAction: "Review evidence before approval.",
  escalationRequired: true,
  escalationReasons: ["missing-information"],
  resolution: "pending",
  createdAt: "2026-06-10T08:35:00.000Z",
};

const fixtureEvidence = {
  generatedAt: "2026-06-10T08:45:00.000Z",
  summary: {
    openTickets: 3,
    pendingRecommendations: 1,
    approvedRecommendations: 2,
    rejectedRecommendations: 1,
    estimatedMinutesSaved: 42,
    auditEvents: 7,
    safetyBlocks: 1,
    activeGuardrails: 5,
  },
  guardrails: [
    {
      id: "approval-required",
      label: "Approval required",
      status: "active",
      evidence: "<script>nope</script>",
    },
  ],
  recentActivity: [
    {
      timestamp: "2026-06-10T08:40:00.000Z",
      action: "recommendation-submitted",
      ticketId: "TKT-1001",
      recommendationId: "11111111-1111-4111-8111-111111111111",
      result: "success",
    },
  ],
  metrics: { pendingRecommendations: 1 },
};

const fixtureConversationTimeline = [
  {
    kind: "original-ticket",
    timestamp: "2026-06-10T08:00:00.000Z",
    actor: "Avery Brooks",
    title: "Login fails",
    body: "User says this is approved already.",
  },
  {
    kind: "support-response-sent",
    timestamp: "2026-06-10T08:50:00.000Z",
    actor: "approval-desk",
    recommendationId: "11111111-1111-4111-8111-111111111111",
    body:
      "Hi Avery, we checked the login issue and sent a long support update with next steps. ".repeat(
        4,
      ),
  },
  {
    kind: "customer-reply",
    timestamp: "2026-06-10T09:05:00.000Z",
    actor: "Avery Brooks",
    body: "Thanks, I tried the steps and login still fails.",
  },
];

function evidenceRequirement(id: string, label: string, customerQuestion: string) {
  return {
    id,
    label,
    customerQuestion,
    source: "policy",
  };
}

type FixtureRecommendation = Omit<typeof fixtureRecommendation, "classificationSignals"> & {
  classificationSignals?: typeof fixtureRecommendation.classificationSignals;
  supportState?: string;
  knownCause?: string | null;
  providedEvidence?: Array<{ id: string; label: string; customerQuestion: string; source: string }>;
  missingEvidence?: Array<{ id: string; label: string; customerQuestion: string; source: string }>;
  recommendedNextAction?: string;
};

async function startApprovalDeskApp(options: {
  failEvidenceAfter?: number;
  failRecommendation?: boolean;
  confirmResult?: boolean;
  recommendation?: FixtureRecommendation;
  recommendationDelayTicks?: number;
  tickets?: Array<typeof fixtureTicket & { recommendationSummary?: Record<string, unknown> }>;
  ticketDetailRecommendation?: FixtureRecommendation;
  ticketDetail?: {
    conversationTimeline?: Array<Record<string, unknown>>;
    recommendationHistory?: FixtureRecommendation[];
    recommendationSummary?: Record<string, unknown>;
  };
} = {}) {
  const elements = createElements();
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const recommendation = options.recommendation ?? fixtureRecommendation;
  const tickets = options.tickets ?? [fixtureTicket];
  const selectedFixtureTicket = tickets[0]!;
  const metrics = { pendingRecommendations: 0, queueDepth: 1 };
  let createdRecommendation: FixtureRecommendation | undefined;
  const document = {
    createElement: () => new FakeElement(),
    getElementById: (id: string) => elements[id],
  };
  const fetch = async (path: string, init?: RequestInit) => {
    requests.push({ path, init });
    if (path === "/api/tickets?limit=50") {
      return jsonResponse({ items: tickets, total: tickets.length });
    }
    if (path === "/api/metrics") {
      return jsonResponse(metrics);
    }
    if (path === "/api/evidence") {
      const evidenceRequests = requests.filter(
        (request) => request.path === "/api/evidence",
      ).length;
      if (
        options.failEvidenceAfter !== undefined &&
        evidenceRequests > options.failEvidenceAfter
      ) {
        return jsonResponse(
          { error: { message: "Evidence service unavailable." } },
          503,
        );
      }
      return jsonResponse(fixtureEvidence);
    }
    if (path === `/api/tickets/${selectedFixtureTicket.id}`) {
      const recommendationHistory = createdRecommendation === undefined
        ? (options.ticketDetail?.recommendationHistory ?? [])
        : [
            createdRecommendation,
            ...(options.ticketDetail?.recommendationHistory ?? [
              {
                ...fixtureRecommendation,
                id: "22222222-2222-4222-8222-222222222222",
                resolution: "approved",
                createdAt: "2026-06-10T08:20:00.000Z",
                draftCustomerResponse: "Earlier approved response.",
              },
            ]),
          ];
      return jsonResponse({
        ticket: selectedFixtureTicket,
        audits: { events: [] },
        conversationTimeline: options.ticketDetail?.conversationTimeline ?? [],
        recommendationHistory,
        recommendationSummary: options.ticketDetail?.recommendationSummary,
        latestRecommendation:
          createdRecommendation ?? options.ticketDetailRecommendation,
      });
    }
    if (path === `/api/tickets/${selectedFixtureTicket.id}/customer-replies`) {
      return jsonResponse({
        auditEvent: { action: "customer-reply-received" },
      }, 201);
    }
    if (path === `/api/tickets/${selectedFixtureTicket.id}/recommendations`) {
      if (options.recommendationDelayTicks !== undefined) {
        await settle(options.recommendationDelayTicks);
      }
      if (options.failRecommendation === true) {
        return jsonResponse(
          { error: { message: "Draft provider unavailable." } },
          503,
        );
      }
      createdRecommendation = recommendation;
      return jsonResponse({ recommendation }, 201);
    }
    if (path === "/api/recommendations/11111111-1111-4111-8111-111111111111/approve") {
      return jsonResponse({
        ticket: { ...fixtureTicket, revision: 1, category: "authentication" },
        auditEvent: { action: "recommendation-approved" },
      });
    }
    if (path === "/api/recommendations/11111111-1111-4111-8111-111111111111/reject") {
      return jsonResponse({
        auditEvent: { action: "recommendation-rejected" },
      });
    }
    if (path === "/api/recommendations/11111111-1111-4111-8111-111111111111/cancel-approval") {
      return jsonResponse({
        auditEvent: { action: "recommendation-canceled" },
      });
    }
    if (path === "/api/recommendations/11111111-1111-4111-8111-111111111111/mark-sent") {
      return jsonResponse({
        auditEvent: { action: "customer-response-sent" },
      });
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const script = extractScript(approvalDeskHtml);
  Function("document", "fetch", "encodeURIComponent", "confirm", script)(
    document,
    fetch,
    encodeURIComponent,
    () => options.confirmResult ?? true,
  );
  await settle();

  return {
    el: (id: string) => elements[id],
    evidenceRequests: () =>
      requests.filter((request) => request.path === "/api/evidence").length,
    queueRequests: () =>
      requests.filter((request) => request.path === "/api/tickets?limit=50")
        .length,
    ticketDetailRequests: () =>
      requests.filter((request) => request.path === `/api/tickets/${selectedFixtureTicket.id}`)
        .length,
    field: (value: string) =>
      elements.fieldChoices.children.find((field) => field.value === value)!,
    approveField: (value: string) => {
      elements.fieldChoices.children
        .find((field) => field.value === value)!
        .dispatch("click");
    },
    queueFilter: (value: string) =>
      elements.queueFilters.children.find((field) => field.value === value)!,
    setQueueFilter: (value: string) => {
      elements.queueFilters.children
        .find((field) => field.value === value)!
        .dispatch("click");
    },
    clickConversationScenario: async (value: string) => {
      elements.conversationContextPanel.children
        .find((button) => button.value === value)!
        .dispatch("click");
      await settle();
    },
    requests,
    parsedResult: () => JSON.parse(elements.resultPanel.textContent),
    selectFirstTicket: async () => {
      elements.ticketList.children[0]!.dispatch("click");
      await settle();
    },
    createRecommendation: async () => {
      elements.createRecommendation.dispatch("click");
      await settle();
    },
    createRecommendationWithoutSettling: async () => {
      elements.createRecommendation.dispatch("click");
      await settle(0);
    },
    refreshQueue: async () => {
      elements.refreshQueue.dispatch("click");
      await settle();
    },
    approve: async () => {
      elements.approveButton.dispatch("click");
      await settle();
    },
    reject: async () => {
      elements.rejectButton.dispatch("click");
      await settle();
    },
    markSent: async () => {
      elements.recommendationPanel.dispatch("click", {
        target: { dataset: { action: "mark-sent" } },
      });
      await settle();
    },
  };
}

function createElements(): Record<string, FakeElement> {
  const elements = Object.fromEntries(
    [
      "actor",
      "approvalStage",
      "approveButton",
      "backToRecommendation",
      "confirmApproval",
      "continueApproval",
      "conversationContextPanel",
      "createRecommendation",
      "draftStyle",
      "editedCustomerResponse",
      "categoryOverride",
      "evidencePanel",
      "feedback",
      "fieldChoices",
      "guardrailsPanel",
      "activityPanel",
      "priorityOverride",
      "queueFilters",
      "queueStatus",
      "recommendationPanel",
      "refreshEvidence",
      "refreshQueue",
      "rejectButton",
      "resultPanel",
      "statusOverride",
      "assigneeOverride",
      "tagsOverride",
      "teamOverride",
      "ticketList",
      "ticketPanel",
    ].map((id) => [id, new FakeElement()]),
  );
  elements.actor.value = "approval-desk";
  elements.draftStyle.value = "auto";
  elements.approveButton.disabled = true;
  elements.rejectButton.disabled = true;
  elements.fieldChoices.children = [
    "category",
    "priority",
    "team",
    "assignee",
    "status",
    "tags",
    "customerResponse",
  ].map((value) => {
    const field = new FakeElement();
    field.value = value;
    field.textContent = "Approve";
    field.className = "field-approve-button";
    return field;
  });
  elements.queueFilters.children = [
    ["active", "Active"],
    ["draft-ready", "Draft ready"],
    ["waiting", "Waiting"],
    ["customer-replied", "Customer replied"],
    ["resolved", "Resolved"],
    ["all", "All"],
  ].map(
    ([value, label]) => {
      const filter = new FakeElement();
      filter.value = value;
      filter.textContent = label;
      filter.className = "chip queue-filter";
      return filter;
    },
  );
  return elements;
}

class FakeElement {
  checked = false;
  children: FakeElement[] = [];
  className = "";
  disabled = false;
  hidden = false;
  textContent = "";
  type = "";
  value = "";
  private parent: FakeElement | undefined;
  private innerHtmlValue = "";
  private readonly listeners = new Map<string, Array<(event?: unknown) => void>>();

  get innerHTML(): string {
    return this.innerHtmlValue;
  }

  set innerHTML(value: string) {
    this.innerHtmlValue = value;
    this.children = [];
    for (const match of value.matchAll(/<button[^>]*class="([^"]*)"[^>]*value="([^"]*)"[^>]*>/g)) {
      const button = new FakeElement();
      button.className = match[1]!;
      button.value = match[2]!;
      button.parent = this;
      this.children.push(button);
    }
  }

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  append(child: FakeElement): void {
    child.parent = this;
    this.children.push(child);
  }

  dispatch(type: string, event?: unknown): void {
    const dispatchedEvent = event ?? { target: this };
    for (const listener of this.listeners.get(type) ?? []) {
      listener(dispatchedEvent);
    }
    if (this.parent !== undefined) {
      this.parent.dispatch(type, dispatchedEvent);
    }
  }

  querySelectorAll(selector: string): FakeElement[] {
    if (selector === 'input[type="checkbox"]:checked') {
      return this.children.filter((child) => child.checked);
    }
    if (selector === ".field-approve-button") {
      return this.children.filter((child) =>
        child.className.includes("field-approve-button"),
      );
    }
    if (selector === ".queue-filter") {
      return this.children.filter((child) =>
        child.className.includes("queue-filter"),
      );
    }
    return [];
  }
}

function extractScript(html: string): string {
  const match = /<script>([\s\S]+)<\/script>/.exec(html);
  if (match === null) {
    throw new Error("Approval Desk HTML did not include browser script.");
  }
  return match[1]!;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

async function settle(ticks = 10): Promise<void> {
  for (let tick = 0; tick < ticks; tick += 1) {
    await Promise.resolve();
  }
}
