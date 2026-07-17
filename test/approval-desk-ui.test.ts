import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { approvalDeskHtml } from "../src/approval-desk/ui.js";

describe("approvalDeskHtml", () => {
  it("contains the browser approval desk controls and safety copy", () => {
    expect(approvalDeskHtml).toContain("Approval Desk");
    expect(approvalDeskHtml).toContain(
      "No ticket changes happen until approval succeeds",
    );
    expect(approvalDeskHtml).toContain("Evaluate ticket");
    expect(approvalDeskHtml).toContain("Mark task done");
    expect(approvalDeskHtml).toContain("Reject and log feedback");
    expect(approvalDeskHtml).toContain("customerResponse");
    expect(approvalDeskHtml).toContain("prompt-injection");
    expect(approvalDeskHtml).toContain("Automation Evidence");
    expect(approvalDeskHtml).toContain("Estimated minutes saved");
    expect(approvalDeskHtml).toContain("Technical ticket details");
    expect(approvalDeskHtml).toContain("Developer/audit output");
    expect(approvalDeskHtml.indexOf("Conversation context")).toBeLessThan(
      approvalDeskHtml.indexOf("Advanced details"),
    );
    expect(approvalDeskHtml.indexOf("Technical ticket details")).toBeLessThan(
      approvalDeskHtml.indexOf("Developer/audit output"),
    );
    expect(approvalDeskHtml).toContain("Workflow actions");
    expect(approvalDeskHtml).toContain("Edit fields");
    expect(approvalDeskHtml).toContain("Reject and log feedback");
    expect(approvalDeskHtml).toContain("Draft style");
    expect(approvalDeskHtml).toContain("Auto (Recommended)");
    expect(approvalDeskHtml).toContain("Drafting recommendation");
    expect(approvalDeskHtml).toContain("Executive update");
    expect(approvalDeskHtml).toContain("Evaluate ticket");
    expect(approvalDeskHtml).toContain("recommendation-setup-bar");
    expect(approvalDeskHtml).toContain("advanced-drawer");
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
    expect(approvalDeskHtml).toContain("Predicted reply text");
    expect(approvalDeskHtml).toContain("conversationTimeline");
    expect(approvalDeskHtml).toContain("recommendationHistory");
    expect(approvalDeskHtml).toContain("Done");
    expect(approvalDeskHtml).toContain("202 Accepted");
    expect(approvalDeskHtml).toContain("profile activity timeline");
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
    await app.createRecommendation();
    await app.approve();

    expect(app.el("replyControls").hidden).toBe(false);
    expect(app.el("conversationContextPanel").innerHTML).toContain(
      "Customer replies are added from the action bar",
    );

    await app.clickConversationScenario("partial-evidence");

    const contextHtml = app.el("conversationContextPanel").innerHTML;
    expect(contextHtml).not.toContain("Insert complete evidence sample");
    expect(contextHtml).not.toContain("Detected lifecycle state");

    const replyRequest = app.requests.find((request) =>
      request.path.endsWith("/customer-replies"),
    );
    expect(replyRequest?.path).toBe("/api/tickets/TKT-1001/customer-replies");
    expect(JSON.parse(String(replyRequest?.init?.body))).toMatchObject({
      actor: "approval-desk",
      body: expect.stringContaining("Confirm account owner"),
      source: "manual",
    });
    expect(app.ticketDetailRequests()).toBeGreaterThanOrEqual(4);
    expect(app.queueRequests()).toBeGreaterThanOrEqual(3);
    expect(app.evidenceRequests()).toBeGreaterThanOrEqual(3);
  });

  it("adds a manual customer reply from the conversation workspace", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();

    app.el("customerReplyBody").value =
      "The campaign editor opens, but the page stays blank after I click Edit.";
    app.el("customerReplyBody").dispatch("input");
    await app.addCustomerReply();

    const replyRequest = app.requests.find((request) =>
      request.path.endsWith("/customer-replies"),
    );
    expect(replyRequest?.path).toBe("/api/tickets/TKT-1001/customer-replies");
    expect(JSON.parse(String(replyRequest?.init?.body))).toMatchObject({
      actor: "approval-desk",
      body:
        "The campaign editor opens, but the page stays blank after I click Edit.",
      source: "manual",
    });
    expect(app.el("customerReplyBody").value).toBe("");
    expect(app.ticketDetailRequests()).toBe(2);
    expect(app.queueRequests()).toBe(2);
    expect(app.evidenceRequests()).toBe(2);
  });

  it("shows what changed between previous and latest recommendations", async () => {
    const previous = {
      ...fixtureRecommendation,
      id: "22222222-2222-4222-8222-222222222222",
      category: "other",
      team: "support",
      priority: "P3",
      supportState: "needs-information",
      missingEvidence: [
        evidenceRequirement(
          "problem-summary",
          "Problem summary",
          "what happened",
        ),
      ],
      createdAt: "2026-06-10T08:20:00.000Z",
    };
    const latest = {
      ...fixtureRecommendation,
      category: "performance",
      team: "product",
      priority: "P3",
      supportState: "diagnosing",
      missingEvidence: [
        evidenceRequirement(
          "campaign-name",
          "Campaign or flow name",
          "Campaign or flow name",
        ),
      ],
    };
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: latest,
      ticketDetail: {
        recommendationHistory: [latest, previous],
      },
    });
    await app.selectFirstTicket();

    const html = app.el("recommendationPanel").innerHTML;
    expect(html).toContain("What changed");
    expect(html).toContain("Category: other -&gt; performance");
    expect(html).toContain("Team: support -&gt; product");
    expect(html).toContain("State: needs-information -&gt; diagnosing");
  });

  it("surfaces a presenter-friendly current state summary in the recommendation panel", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        category: "performance",
        team: "product",
        priority: "P3",
        supportState: "diagnosing",
        knownCause: null,
        missingEvidence: [],
        providedEvidence: [
          evidenceRequirement(
            "problem-summary",
            "Problem summary",
            "what happened",
          ),
          evidenceRequirement(
            "browser-session-details",
            "Browser or session details",
            "browser/session details",
          ),
        ],
        draftCustomerResponseSource: "fallback",
        draftCustomerResponseChecks: [
          {
            id: "fallback-used",
            label: "Fallback used",
            status: "warn",
            message: "OpenAI drafting request timed out after 15000 ms.",
          },
        ],
        recommendedNextAction:
          "Review the supporting evidence, then approve or reject this recommendation.",
      },
    });

    await app.selectFirstTicket();

    const html = app.el("recommendationPanel").innerHTML;
    expect(html).toContain("Recommendation Summary");
    expect(html).toContain("Lifecycle: diagnosing");
    expect(html).toContain("Evidence: complete");
    expect(html).toContain("Category: performance");
    expect(html).toContain("Team: product");
    expect(html).toContain("Show technical evidence");
    expect(html).toContain("1 checked, 1 warning");
  });

  it("shows recommendation failures in the main recommendation panel", async () => {
    const app = await startApprovalDeskApp({ failRecommendation: true });
    await app.selectFirstTicket();

    await app.createRecommendation();

    const html = app.el("recommendationPanel").innerHTML;
    expect(html).toContain("Recommendation failed");
    expect(html).toContain("Draft provider unavailable.");
    expect(html).toContain("Try again");
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

  it("explains predicted reply text is based on current ticket context", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();

    expect(app.el("conversationContextPanel").innerHTML).toContain(
      "Customer replies are added from the action bar",
    );
    expect(app.el("predictedReply").hidden).toBe(false);
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
    expect(html).not.toContain("Technical ticket details");
    expect(app.el("ticketDetailsPanel").innerHTML).toContain(
      "Technical ticket details",
    );
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

    expect(app.el("actionBarTitle").textContent).toBe("Response ready");
    expect(app.el("approveButton").textContent).toBe("Done");
    expect(app.el("approveButton").hidden).toBe(false);

    await app.approve();

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

  it("shows an automatic customer reply in a chat bubble above the action bar after done", async () => {
    const app = await startApprovalDeskApp({
      markSentAutomaticReply:
        "The endpoint URL is https://hooks.example.test/webhooks/orders, the delivery ID is deliv_7788, raw body handling has not changed since yesterday, the last failed attempt was at 2026-06-10 09:12 UTC, and the endpoint returned HTTP 401 before the retry succeeded.",
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        ticketId: "TKT-1008",
      },
    });
    await app.selectFirstTicket();
    await app.createRecommendation();
    await app.approve();

    expect(app.el("actionBarTitle").textContent).toBe("Customer replied");
    expect(app.el("pendingReplyPreview").innerHTML).not.toContain(
      "New customer reply waiting for evaluation",
    );
    expect(app.el("pendingReplyPreview").innerHTML).not.toContain("endpoint URL");
    expect(app.el("customerReplyFocus").hidden).toBe(false);
    expect(app.el("customerReplyFocus").innerHTML).toContain("endpoint URL");
    expect(app.el("customerReplyFocus").innerHTML).toContain("retry succeeded");
    expect(approvalDeskHtml).toContain("workflow-action-stack");
    expect(approvalDeskHtml.indexOf('id="customerReplyFocus"')).toBeLessThan(
      approvalDeskHtml.indexOf('<section class="recommendation-setup-bar"'),
    );
    expect(app.el("createUpdatedRecommendation").hidden).toBe(false);
    expect(app.el("createUpdatedRecommendation").textContent).toBe("Evaluate");
    expect(app.el("replyTestingMode").open).toBe(false);
    expect(app.el("replyComposer").open).toBe(false);
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
    expect(blockedApp.el("createRecommendation").textContent).toBe("Evaluate");

    const repliedApp = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        resolution: "approved",
      },
      ticketDetail: {
        recommendationSummary: {
          workflowState: "customer-replied",
          latestRecommendationId: fixtureRecommendation.id,
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
    expect(repliedApp.el("createRecommendation").textContent).toBe("Evaluate");
    expect(repliedApp.el("createUpdatedRecommendation").hidden).toBe(false);
    expect(repliedApp.el("createUpdatedRecommendation").disabled).toBe(false);
    expect(repliedApp.el("createUpdatedRecommendation").textContent).toBe(
      "Evaluate",
    );

    await repliedApp.createUpdatedRecommendation();

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
      "Ready to mark done from the action bar",
    );
    expect(app.el("approveButton").textContent).toBe("Done");
    expect(app.el("replyControls").hidden).toBe(false);
  });

  it("shows Diagnose after a done response with complete evidence", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        resolution: "approved",
        supportState: "diagnosing",
        missingEvidence: [],
      },
      ticketDetail: {
        conversationTimeline: [
          {
            kind: "support-response-sent",
            timestamp: "2026-06-10T09:04:00.000Z",
            actor: "approval-desk",
            recommendationId: fixtureRecommendation.id,
            body: "We have the evidence needed to investigate.",
          },
        ],
        recommendationSummary: {
          workflowState: "waiting",
          latestRecommendationId: fixtureRecommendation.id,
          latestResolution: "approved",
          hasSentResponse: true,
          hasCustomerReply: false,
        },
      },
    });
    await app.selectFirstTicket();

    expect(app.el("diagnoseButton").hidden).toBe(false);
    expect(app.el("fixButton").hidden).toBe(true);

    await app.click("diagnoseButton");

    expect(app.requests).toContainEqual(
      expect.objectContaining({
        path: "/api/tickets/TKT-1001/diagnosis",
      }),
    );
    expect(app.el("createUpdatedRecommendation").hidden).toBe(false);
    expect(app.el("createUpdatedRecommendation").textContent).toBe("Update");
  });

  it("shows Diagnose after a newer customer reply has been evaluated despite an older diagnosis", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        resolution: "approved",
        createdAt: "2026-06-10T09:06:30.000Z",
        supportState: "diagnosing",
        missingEvidence: [],
      },
      ticketDetail: {
        conversationTimeline: [
          {
            kind: "diagnosis",
            timestamp: "2026-06-10T09:04:00.000Z",
            actor: "product-support",
            summary: "The previous reply narrowed the issue.",
            confidence: "likely",
            owner: "engineering",
          },
          {
            kind: "support-response-sent",
            timestamp: "2026-06-10T09:05:00.000Z",
            actor: "approval-desk",
            recommendationId: "22222222-2222-4222-8222-222222222222",
            body: "Please try the browser-session checks.",
          },
          {
            kind: "customer-reply",
            timestamp: "2026-06-10T09:06:00.000Z",
            actor: "Mia Johnson",
            body: "The editor is still blank in incognito, Edge, and for another admin.",
          },
          {
            kind: "support-response-sent",
            timestamp: "2026-06-10T09:07:00.000Z",
            actor: "approval-desk",
            recommendationId: fixtureRecommendation.id,
            body: "Thanks, we are checking the new evidence.",
          },
        ],
        recommendationSummary: {
          workflowState: "waiting",
          latestRecommendationId: fixtureRecommendation.id,
          latestResolution: "approved",
          hasSentResponse: true,
          hasCustomerReply: true,
        },
      },
    });
    await app.selectFirstTicket();

    expect(app.el("diagnoseButton").hidden).toBe(false);
    expect(app.el("fixButton").hidden).toBe(true);
  });

  it("shows Fix only after diagnosis has been recorded and response sent", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        resolution: "approved",
        supportState: "diagnosing",
        missingEvidence: [],
      },
      ticketDetail: {
        conversationTimeline: [
          {
            kind: "diagnosis",
            timestamp: "2026-06-10T09:04:00.000Z",
            actor: "product-support",
            summary: "The likely cause has been diagnosed.",
            confidence: "confirmed",
            owner: "engineering",
          },
          {
            kind: "support-response-sent",
            timestamp: "2026-06-10T09:05:00.000Z",
            actor: "approval-desk",
            recommendationId: fixtureRecommendation.id,
            body: "We found the likely cause.",
          },
        ],
        recommendationSummary: {
          workflowState: "waiting",
          latestRecommendationId: fixtureRecommendation.id,
          latestResolution: "approved",
          hasSentResponse: true,
          hasCustomerReply: false,
        },
      },
    });
    await app.selectFirstTicket();

    expect(app.el("diagnoseButton").hidden).toBe(true);
    expect(app.el("fixButton").hidden).toBe(false);

    await app.click("fixButton");

    expect(app.requests).toContainEqual(
      expect.objectContaining({
      path: "/api/tickets/TKT-1001/fix",
      }),
    );
  });

  it("does not show Fix while the latest diagnosis is only likely", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        resolution: "approved",
        supportState: "diagnosing",
        missingEvidence: [],
      },
      ticketDetail: {
        conversationTimeline: [
          {
            kind: "diagnosis",
            timestamp: "2026-06-10T09:04:00.000Z",
            actor: "product-support",
            summary: "The details narrow this to campaign editor loading.",
            confidence: "likely",
            owner: "engineering",
          },
          {
            kind: "support-response-sent",
            timestamp: "2026-06-10T09:05:00.000Z",
            actor: "approval-desk",
            recommendationId: fixtureRecommendation.id,
            body: "Please try the browser-session checks next.",
          },
        ],
        recommendationSummary: {
          workflowState: "waiting",
          latestRecommendationId: fixtureRecommendation.id,
          latestResolution: "approved",
          hasSentResponse: true,
          hasCustomerReply: false,
        },
      },
    });
    await app.selectFirstTicket();

    expect(app.el("diagnoseButton").hidden).toBe(true);
    expect(app.el("fixButton").hidden).toBe(true);
  });

  it("does not show Fix for a confirmed customer-owned diagnosis", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        resolution: "approved",
        supportState: "diagnosing",
        missingEvidence: [],
      },
      ticketDetail: {
        conversationTimeline: [
          {
            kind: "diagnosis",
            timestamp: "2026-06-10T09:04:00.000Z",
            actor: "product-support",
            summary:
              "The editor works in a private window, so the issue is local browser session state.",
            confidence: "confirmed",
            owner: "customer",
          },
          {
            kind: "support-response-sent",
            timestamp: "2026-06-10T09:05:00.000Z",
            actor: "approval-desk",
            recommendationId: fixtureRecommendation.id,
            body: "Please clear site data or continue in the working browser session.",
          },
        ],
        recommendationSummary: {
          workflowState: "waiting",
          latestRecommendationId: fixtureRecommendation.id,
          latestResolution: "approved",
          hasSentResponse: true,
          hasCustomerReply: false,
        },
      },
    });
    await app.selectFirstTicket();

    expect(app.el("diagnoseButton").hidden).toBe(true);
    expect(app.el("fixButton").hidden).toBe(true);
  });

  it("shows Evaluate for a diagnosis update when sent-response status comes from the summary", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        resolution: "approved",
        supportState: "waiting-on-platform-fix",
        missingEvidence: [],
        createdAt: "2026-06-10T09:00:00.000Z",
      },
      ticketDetail: {
        conversationTimeline: [
          {
            kind: "diagnosis",
            timestamp: "2026-06-10T09:05:00.000Z",
            actor: "approval-desk",
            summary:
              "The evidence points to a platform-side processing delay affecting the customer's expected results.",
          },
        ],
        recommendationSummary: {
          workflowState: "waiting",
          latestRecommendationId: fixtureRecommendation.id,
          latestResolution: "approved",
          hasSentResponse: true,
          hasCustomerReply: true,
        },
      },
    });
    await app.selectFirstTicket();

    expect(app.el("pendingReplyPreview").innerHTML).toContain(
      "Workflow update waiting for evaluation",
    );
    expect(app.el("decisionControls").hidden).toBe(false);
    expect(app.el("createUpdatedRecommendation").hidden).toBe(false);
    expect(app.el("createUpdatedRecommendation").textContent).toBe("Update");
    expect(app.el("actionBarHint").textContent).toContain(
      "Draft the customer update",
    );
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

  it("tells one recommendation story: draft, summary, reason, then technical evidence", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();

    const html = app.el("recommendationPanel").innerHTML;
    expect(html).toContain("Customer Response Draft");
    expect(html).toContain("Recommendation Summary");
    expect(html).toContain("Why this recommendation?");
    expect(html).toContain("Show technical evidence");
    expect(html).toContain("Category: authentication");
    expect(html).toContain("Lifecycle: not assessed");
    expect(html).not.toContain("Current state");
    expect(html).not.toContain("Lifecycle summary");
    expect(html).not.toContain("GPT Assist");
    expect(html).not.toContain("Why this draft is safe");
    expect(html).not.toContain("Evidence and internal details");
  });

  it("presents the workflow as evaluation, response, and done with no right-panel buttons", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();

    expect(app.el("actionBarTitle").textContent).toBe("Evaluate ticket");
    expect(app.el("createRecommendation").textContent).toBe("Evaluate");

    await app.createRecommendation();

    expect(app.el("actionBarTitle").textContent).toBe("Response ready");
    expect(app.el("reviewDraftButton").textContent).toBe("Response");
    expect(app.el("approveButton").textContent).toBe("Done");
    expect(app.el("recommendationPanel").innerHTML).toContain("Next Step");
    expect(app.el("recommendationPanel").innerHTML).toContain("Full workflow guide");
    expect(app.el("recommendationPanel").innerHTML).not.toContain("<button");
  });

  it("marks the task done by approving the evaluated response and sending it", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();

    await app.approve();

    const approvalRequest = app.requests.find((request) =>
      request.path.endsWith("/approve"),
    );
    const sentRequest = app.requests.find((request) =>
      request.path.endsWith("/mark-sent"),
    );
    expect(JSON.parse(String(approvalRequest?.init?.body))).toMatchObject({
      approvedFields: ["category", "priority", "team", "tags", "customerResponse"],
      editedCustomerResponse: fixtureRecommendation.draftCustomerResponse,
    });
    expect(JSON.parse(String(sentRequest?.init?.body))).toMatchObject({
      ticketId: "TKT-1001",
      actor: "approval-desk",
    });
  });

  it("keeps the newest customer reply visible in the action bar until evaluation", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        resolution: "approved",
      },
      ticketDetail: {
        recommendationSummary: {
          workflowState: "customer-replied",
          latestRecommendationId: fixtureRecommendation.id,
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
      },
    });
    await app.selectFirstTicket();

    expect(app.el("customerReplyFocus").innerHTML).toContain(
      "I sent the remaining evidence.",
    );
    expect(app.el("createUpdatedRecommendation").hidden).toBe(false);
    expect(app.el("createUpdatedRecommendation").textContent).toBe("Evaluate");

    await app.createUpdatedRecommendation();

    expect(app.el("pendingReplyPreview").innerHTML).not.toContain(
      "I sent the remaining evidence.",
    );
    expect(app.el("customerReplyFocus").innerHTML).not.toContain(
      "I sent the remaining evidence.",
    );
  });

  it("keeps manual customer reply tooling behind testing mode", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();
    await app.approve();

    expect(app.el("replyControls").hidden).toBe(false);
    expect(app.el("conversationContextPanel").innerHTML).not.toContain(
      "Insert partial evidence sample",
    );
    expect(app.el("replyTestingMode").open).toBe(false);
    expect(approvalDeskHtml).toContain("Testing mode");

    app.el("predictedReply").value = "partial-evidence";
    app.el("predictedReply").dispatch("change");

    expect(app.el("customerReplyBody").value).toContain("Confirm account owner");

    await app.addCustomerReply();

    const replyRequest = app.requests.find((request) =>
      request.path.endsWith("/customer-replies"),
    );
    expect(JSON.parse(String(replyRequest?.init?.body))).toMatchObject({
      body: expect.stringContaining("Confirm account owner"),
      source: "manual",
    });
  });

  it("does not open manual reply tooling after done when no automatic reply is returned", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();

    expect(app.el("replyControls").hidden).toBe(true);

    await app.createRecommendation();

    expect(app.el("replyControls").hidden).toBe(true);
    expect(app.el("replyComposer").open).toBe(false);

    await app.approve();

    expect(app.el("replyControls").hidden).toBe(false);
    expect(app.el("customerReplyFocus").hidden).toBe(true);
    expect(app.el("replyTestingMode").open).toBe(false);
    expect(app.el("replyComposer").open).toBe(false);
    expect(app.el("pendingReplyPreview").innerHTML).toContain(
      "No automatic customer reply was generated",
    );

    app.el("customerReplyBody").value =
      "The campaign editor is still blank after I click Edit.";
    await app.addCustomerReply();

    expect(app.el("replyComposer").open).toBe(false);
    expect(app.el("customerReplyFocus").innerHTML).toContain(
      "The campaign editor is still blank",
    );
  });

  it("uses the floating bar for fast approval with sensible default fields", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();

    expect(app.el("setupControls").hidden).toBe(true);
    expect(app.el("decisionControls").hidden).toBe(false);
    expect(app.el("decisionChips").innerHTML).toContain("authentication");
    expect(app.el("decisionChips").innerHTML).toContain("P2");
    expect(app.el("decisionChips").innerHTML).toContain("identity");
    expect(app.el("approvalStage").hidden).toBe(true);
    expect(app.el("approveButton").disabled).toBe(false);

    await app.approve();

    const approvalRequest = app.requests.find((request) =>
      request.path.endsWith("/approve"),
    );
    expect(JSON.parse(String(approvalRequest?.init?.body))).toMatchObject({
      approvedFields: ["category", "priority", "team", "tags", "customerResponse"],
      editedCustomerResponse: fixtureRecommendation.draftCustomerResponse,
    });
  });

  it("keeps the action bar compact and anchored away from the conversation workspace", () => {
    expect(approvalDeskHtml).toContain("right: 1rem");
    expect(approvalDeskHtml).toContain("width: min(520px");
    expect(approvalDeskHtml).toContain("bar-chip-summary");
    expect(approvalDeskHtml.indexOf("<h3>Conversation workspace</h3>")).toBeLessThan(
      approvalDeskHtml.indexOf('<section class="recommendation-setup-bar"'),
    );
  });

  it("uses primary styling for secondary workflow actions in the floating bar", () => {
    expect(approvalDeskHtml).toContain(".recommendation-setup-bar .secondary");
    expect(approvalDeskHtml).toContain("background: var(--accent)");
    expect(approvalDeskHtml).toContain("color: white");
    expect(approvalDeskHtml).toContain(
      ".recommendation-setup-bar .secondary:hover:not(:disabled)",
    );
    expect(approvalDeskHtml).toContain("background: var(--accent-dark)");
    expect(approvalDeskHtml).toContain(".conversation-controls .secondary");
    expect(approvalDeskHtml).toContain(
      ".conversation-controls .secondary:hover:not(:disabled)",
    );
  });

  it("shows done in the floating bar for approved responses", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        resolution: "approved",
      },
    });

    await app.selectFirstTicket();

    expect(app.el("markSentButton").hidden).toBe(true);
    expect(app.el("approveButton").hidden).toBe(false);
    expect(app.el("approveButton").textContent).toBe("Done");
    expect(app.el("startRejectButton").hidden).toBe(true);

    await app.approve();

    expect(
      app.requests.some((request) => request.path.endsWith("/mark-sent")),
    ).toBe(true);
  });

  it("switches the floating bar between edit and reject modes", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();

    app.el("continueApproval").dispatch("click");

    expect(app.el("editApprovalControls").hidden).toBe(false);
    expect(app.el("decisionControls").hidden).toBe(true);
    expect(app.el("backToRecommendation").hidden).toBe(false);

    app.el("backToRecommendation").dispatch("click");

    expect(app.el("decisionControls").hidden).toBe(false);
    expect(app.el("editApprovalControls").hidden).toBe(true);

    app.el("startRejectButton").dispatch("click");

    expect(app.el("rejectControls").hidden).toBe(false);
    expect(app.el("decisionControls").hidden).toBe(true);

    app.el("feedback").value = "";
    app.el("feedback").dispatch("input");
    expect(app.el("rejectButton").disabled).toBe(true);

    app.el("feedback").value = "Needs better evidence.";
    app.el("feedback").dispatch("input");
    expect(app.el("rejectButton").disabled).toBe(false);
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
    expect(app.evidenceRequests()).toBe(3);

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
      "Drafting recommendation",
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
    expect(approvalDeskHtml).toContain("Evaluate ticket");
    expect(approvalDeskHtml).toContain("Draft style");
    expect(approvalDeskHtml).toContain("Auto (Recommended)");
  });

  it("shows draft review before revealing approval controls", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();

    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Customer Response Draft",
    );
    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Recommendation Summary",
    );
    expect(app.el("continueApproval").hidden).toBe(false);
    expect(app.el("backToRecommendation").hidden).toBe(true);
    expect(app.el("approvalStage").hidden).toBe(true);

    app.el("continueApproval").dispatch("click");

    expect(app.el("approvalStage").hidden).toBe(true);
    expect(app.el("editApprovalControls").hidden).toBe(false);
    expect(app.el("decisionControls").hidden).toBe(true);
    expect(app.el("backToRecommendation").hidden).toBe(false);
    expect(app.el("recommendationPanel").innerHTML).not.toContain(
      "Why this draft is safe",
    );

    app.el("backToRecommendation").dispatch("click");

    expect(app.el("approvalStage").hidden).toBe(true);
    expect(app.el("decisionControls").hidden).toBe(false);
    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Customer Response Draft",
    );
  });

  it("shows an existing pending recommendation when selecting a ticket", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: fixtureRecommendation,
    });

    await app.selectFirstTicket();

    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Customer Response Draft",
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

  it("marks a response done and keeps the workflow panel read-only", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();

    app.approveField("category");
    app.el("confirmApproval").checked = true;
    await app.approve();

    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Customer Response Draft",
    );
    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Next Step",
    );
    expect(app.el("recommendationPanel").innerHTML).not.toContain("<button");
    expect(app.el("recommendationPanel").innerHTML).not.toContain(
      "Why this draft is safe",
    );
    expect(app.el("approveButton").textContent).toBe("Done");
    expect(app.el("approvalStage").hidden).toBe(true);
    expect(app.el("replyControls").hidden).toBe(false);
    expect(app.field("category").textContent).toBe("Approve");
    expect(app.el("confirmApproval").checked).toBe(false);
    expect(app.el("categoryOverride").value).toBe("authentication");
    expect(
      app.requests.some((request) => request.path.endsWith("/mark-sent")),
    ).toBe(true);
  });

  it("keeps an existing approved response in done-ready state until sent", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        resolution: "approved",
      },
    });

    await app.selectFirstTicket();

    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Customer Response Draft",
    );
    expect(app.el("recommendationPanel").innerHTML).not.toContain(
      "GPT Assist",
    );
    expect(app.el("approveButton").textContent).toBe("Done");
    expect(app.el("approveButton").hidden).toBe(false);
    expect(app.el("createRecommendation").disabled).toBe(true);

    await app.createRecommendation();

    expect(
      app.requests.some((request) => request.path.endsWith("/recommendations")),
    ).toBe(false);
    expect(app.parsedResult()).toMatchObject({
      error: "Mark the approved response as sent before creating a new recommendation for this ticket.",
    });

    await app.approve();

    expect(
      app.requests.some((request) => request.path.endsWith("/mark-sent")),
    ).toBe(true);
  });

  it("clears finalized rejection state and keeps rejection results visible with metrics", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();

    app.el("feedback").value = "Needs better evidence.";
    app.el("feedback").dispatch("input");
    await app.reject();

    expect(app.el("recommendationPanel").innerHTML).toContain(
      "Step 1: Evaluate ticket",
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
    expect(html).toContain("Customer Response Draft");
    expect(html).toContain("Recommendation Summary");
    expect(html).toContain("Why this recommendation?");
    expect(html).toContain("Show technical evidence");
    expect(html).toContain("Knowledge used");
    expect(html).toContain("account-access-reset");
    expect(html).toContain("Outage risk");
    expect(html).toContain("Security risk");
    expect(html).toContain("SLA risk");
    expect(html).toContain("Escalation");
    expect(html).toContain("Classifier signals");
    expect(html).toContain("Evidence requirements");
    expect(html).toContain("&lt;script&gt;alert(&#039;x&#039;)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("shows compact classifier evidence with grouped escaped signal details", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();

    const html = app.el("recommendationPanel").innerHTML;
    expect(html).toContain("Show technical evidence");
    expect(html).toContain("Classifier signals");
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("Category: authentication");
    expect(html).toContain("Priority: P2");
    expect(html).toContain("Team: identity");
    expect(html).toContain("Confidence");
    expect(html).toContain("0.87");
    expect(html).toContain("category-authentication");
    expect(html).toContain("metadata-priority");
    expect(html).toContain(
      "&lt;script&gt;Security-sensitive account access language was detected.&lt;/script&gt;",
    );
    expect(html).not.toContain("<script>Security-sensitive");
    expect(html.indexOf("Customer Response Draft")).toBeLessThan(
      html.indexOf("Recommendation Summary"),
    );
    expect(html.indexOf("Recommendation Summary")).toBeLessThan(
      html.indexOf("Show technical evidence"),
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
    expect(html).toContain("Show technical evidence");
    expect(html).toContain("Classifier signals");
    expect(html).toContain("Category: authentication");
    expect(html).toContain(
      "No classifier signal snapshot stored for this recommendation.",
    );
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
    expect(html).toContain("Recommendation Summary");
    expect(html).toContain("<details");
    expect(html).toContain("<summary>Show technical evidence</summary>");
    expect(html).toContain("Lifecycle: information-received");
    expect(html).toContain("Provided");
    expect(html).toContain("Endpoint URL");
    expect(html).toContain("Raw body change status");
    expect(html).toContain("Thank the customer and collect only the remaining evidence.");
    expect(html.indexOf("Customer Response Draft")).toBeLessThan(
      html.indexOf("Recommendation Summary"),
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
    expect(app.el("editApprovalControls").hidden).toBe(false);
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

    const html = app.el("recommendationPanel").innerHTML;
    expect(html).toContain("Show technical evidence");
    expect(html).toContain("Classifier signals");
    expect(html).toContain("risk-security: Security risk detected.");
    expect(html).toContain("risk-sla: SLA risk detected.");
    expect(html).toContain("known-cause-login-session-expiry");
    expect(html).toContain("category-authentication");
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
    expect(app.queueFilter("resolved").textContent).toBe("Closed");

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
    expect(app.el("ticketList").children[0]!.innerHTML).toContain("Closed");

    app.setQueueFilter("all");

    expect(app.el("ticketList").children).toHaveLength(5);
  });

  it("shows a close action after a ready-for-close response has been sent", async () => {
    const app = await startApprovalDeskApp({
      ticketDetailRecommendation: {
        ...fixtureRecommendation,
        resolution: "approved",
        supportState: "ready-for-close",
      },
      ticketDetail: {
        conversationTimeline: [
          {
            kind: "support-response-sent",
            timestamp: "2026-06-10T09:25:00.000Z",
            actor: "approval-desk",
            recommendationId: fixtureRecommendation.id,
            body: "Glad to hear that resolved it.",
          },
        ],
        recommendationSummary: {
          latestRecommendationId: fixtureRecommendation.id,
          latestResolution: "approved",
          workflowState: "waiting",
          hasSentResponse: true,
        },
      },
    });
    await app.selectFirstTicket();

    expect(app.el("closeTicketButton").hidden).toBe(false);
    expect(app.el("closeTicketButton").disabled).toBe(false);
    expect(app.el("actionBarTitle").textContent).toBe("Ready to close");

    await app.click("closeTicketButton");

    expect(app.requests.some((request) =>
      request.path === `/api/tickets/${fixtureTicket.id}/close`,
    )).toBe(true);
    expect(app.parsedResult()).toMatchObject({
      items: [
        expect.objectContaining({
          id: fixtureTicket.id,
          status: "resolved",
          recommendationSummary: {
            workflowState: "resolved",
          },
        }),
      ],
    });
  });

  it("uses customer-friendly predicted reply labels instead of fixture names", () => {
    expect(approvalDeskHtml).toContain("All requested evidence");
    expect(approvalDeskHtml).toContain("Fix verification details");
    expect(approvalDeskHtml).toContain("Customer says it works");
    expect(approvalDeskHtml).not.toContain(">Complete evidence<");
    expect(approvalDeskHtml).not.toContain(">Platform-fix context<");
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
  markSentAutomaticReply?: string;
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
  const conversationTimeline = [
    ...(options.ticketDetail?.conversationTimeline ?? []),
  ];
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
        conversationTimeline,
        recommendationHistory,
        recommendationSummary: options.ticketDetail?.recommendationSummary,
        latestRecommendation:
          createdRecommendation ?? options.ticketDetailRecommendation,
      });
    }
    if (path === `/api/tickets/${selectedFixtureTicket.id}/customer-replies`) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      conversationTimeline.push({
        kind: "customer-reply",
        timestamp: "2026-06-10T09:06:00.000Z",
        actor: body.actor ?? "approval-desk",
        body: body.body ?? "",
      });
      return jsonResponse({
        auditEvent: { action: "customer-reply-received" },
      }, 201);
    }
    if (path === `/api/tickets/${selectedFixtureTicket.id}/diagnosis`) {
      conversationTimeline.push({
        kind: "diagnosis",
        timestamp: "2026-06-10T09:06:00.000Z",
        actor: "product-support",
        summary: "The likely cause has been diagnosed.",
      });
      return jsonResponse({
        auditEvent: { action: "diagnosis-completed" },
      }, 201);
    }
    if (path === `/api/tickets/${selectedFixtureTicket.id}/fix`) {
      conversationTimeline.push({
        kind: "fix",
        timestamp: "2026-06-10T09:07:00.000Z",
        actor: "product-support",
        summary: "A fix is available.",
      });
      return jsonResponse({
        auditEvent: { action: "fix-available" },
      }, 201);
    }
    if (path === `/api/tickets/${selectedFixtureTicket.id}/close`) {
      selectedFixtureTicket.status = "resolved";
      const mutableFixtureTicket = selectedFixtureTicket as typeof selectedFixtureTicket & {
        recommendationSummary?: Record<string, unknown>;
      };
      mutableFixtureTicket.recommendationSummary = {
        ...(mutableFixtureTicket.recommendationSummary ?? {}),
        workflowState: "resolved",
      };
      return jsonResponse({
        ticket: selectedFixtureTicket,
        auditEvent: { action: "ticket-updated" },
      });
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
      conversationTimeline.push({
        kind: "support-response-sent",
        timestamp: "2026-06-10T09:05:00.000Z",
        actor: "approval-desk",
        recommendationId: fixtureRecommendation.id,
        body: fixtureRecommendation.draftCustomerResponse,
      });
      if (options.markSentAutomaticReply !== undefined) {
        conversationTimeline.push({
          kind: "customer-reply",
          timestamp: "2026-06-10T09:05:00.001Z",
          actor: "Dev Support",
          body: options.markSentAutomaticReply,
        });
      }
      return jsonResponse({
        auditEvent: { action: "customer-response-sent" },
        ...(options.markSentAutomaticReply === undefined
          ? {}
          : {
              automaticReply: {
                action: "customer-reply-received",
                after: {
                  body: options.markSentAutomaticReply,
                  source: "demo-auto-reply",
                },
              },
            }),
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
      elements.predictedReply.value = value;
      elements.predictedReply.dispatch("change");
      elements.addCustomerReply.dispatch("click");
      await settle(10);
    },
    addCustomerReply: async () => {
      elements.addCustomerReply.dispatch("click");
      await settle(10);
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
    createUpdatedRecommendation: async () => {
      elements.createUpdatedRecommendation.dispatch("click");
      await settle();
    },
    click: async (id: string) => {
      elements[id]!.dispatch("click");
      await settle(10);
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
      await settle(10);
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
      "actionBarHint",
      "actionBarTitle",
      "approvalStage",
      "approveButton",
      "approveEditedButton",
      "backToRecommendation",
      "addCustomerReply",
      "cancelRejectButton",
      "closeTicketButton",
      "confirmApproval",
      "continueApproval",
      "conversationContextPanel",
      "createRecommendation",
      "createUpdatedRecommendation",
      "customerReplyBody",
      "customerReplyFocus",
      "decisionChips",
      "decisionControls",
      "decisionSummary",
      "diagnoseButton",
      "draftStyle",
      "editApprovalControls",
      "editedCustomerResponse",
      "categoryOverride",
      "evidencePanel",
      "feedback",
      "fieldChoices",
      "fixButton",
      "guardrailsPanel",
      "activityPanel",
      "markSentButton",
      "priorityOverride",
      "pendingReplyPreview",
      "predictedReply",
      "queueFilters",
      "queueStatus",
      "recommendationPanel",
      "refreshEvidence",
      "refreshQueue",
      "rejectButton",
      "rejectControls",
      "replyComposer",
      "replyControls",
      "replyTestingMode",
      "resultPanel",
      "reviewDraftButton",
      "setupControls",
      "startRejectButton",
      "statusOverride",
      "assigneeOverride",
      "tagsOverride",
      "teamOverride",
      "ticketList",
      "ticketDetailsPanel",
      "ticketPanel",
    ].map((id) => [id, new FakeElement()]),
  );
  elements.actor.value = "approval-desk";
  elements.draftStyle.value = "auto";
  elements.approveButton.disabled = true;
  elements.approveEditedButton.disabled = true;
  elements.rejectButton.disabled = true;
  elements.replyComposer.open = false;
  elements.replyTestingMode.open = false;
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
    ["resolved", "Closed"],
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
  elements.rejectControls.children = [
    ["Wrong classification.", "Wrong"],
    ["Needs better evidence.", "Evidence"],
    ["Rewrite the customer response.", "Rewrite"],
  ].map(([value, label]) => {
    const button = new FakeElement();
    button.value = value;
    button.textContent = label;
    button.className = "quick-reason secondary";
    return button;
  });
  return elements;
}

class FakeElement {
  checked = false;
  children: FakeElement[] = [];
  className = "";
  disabled = false;
  hidden = false;
  open = false;
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
    if (selector === ".quick-reason") {
      return this.children.filter((child) =>
        child.className.includes("quick-reason"),
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
