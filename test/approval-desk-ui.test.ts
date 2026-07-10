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
    expect(approvalDeskHtml).toContain("Draft style");
    expect(approvalDeskHtml).toContain("Executive update");
  });

  it("uses only local API routes", () => {
    expect(approvalDeskHtml).toContain("/api/tickets");
    expect(approvalDeskHtml).toContain("/api/metrics");
    expect(approvalDeskHtml).toContain("/api/evidence");
    expect(approvalDeskHtml).not.toContain("https://");
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

    app.field("category").checked = true;
    app.el("confirmApproval").checked = true;
    app.el("fieldChoices").dispatch("change");
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
    approvalApp.field("category").checked = true;
    approvalApp.el("confirmApproval").checked = true;
    approvalApp.el("fieldChoices").dispatch("change");

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

    app.field("customerResponse").checked = true;
    app.el("confirmApproval").checked = true;
    app.el("editedCustomerResponse").value = "   ";
    app.el("fieldChoices").dispatch("change");
    app.el("editedCustomerResponse").dispatch("input");

    expect(app.el("approveButton").disabled).toBe(true);
  });

  it("sends reviewer-edited approval field values", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();

    app.field("category").checked = true;
    app.field("priority").checked = true;
    app.field("team").checked = true;
    app.el("categoryOverride").value = "incident";
    app.el("priorityOverride").value = "P1";
    app.el("teamOverride").value = "incident-response";
    app.el("confirmApproval").checked = true;
    app.el("fieldChoices").dispatch("change");
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

  it("clears finalized approval state and keeps action results visible with metrics", async () => {
    const app = await startApprovalDeskApp();
    await app.selectFirstTicket();
    await app.createRecommendation();

    app.field("category").checked = true;
    app.el("confirmApproval").checked = true;
    app.el("fieldChoices").dispatch("change");
    await app.approve();

    expect(app.el("recommendationPanel").innerHTML).toContain(
      "No recommendation created yet.",
    );
    expect(app.el("approveButton").disabled).toBe(true);
    expect(app.field("category").checked).toBe(false);
    expect(app.el("confirmApproval").checked).toBe(false);
    expect(app.el("categoryOverride").value).toBe("");
    expect(app.parsedResult()).toMatchObject({
      action: {
        ticket: { id: "TKT-1001", revision: 1 },
      },
      metrics: { pendingRecommendations: 0 },
    });
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
  rationale: "Matches account access routing.",
  confidence: 0.87,
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

async function startApprovalDeskApp(options: {
  failEvidenceAfter?: number;
  recommendation?: typeof fixtureRecommendation;
} = {}) {
  const elements = createElements();
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const recommendation = options.recommendation ?? fixtureRecommendation;
  const metrics = { pendingRecommendations: 0, queueDepth: 1 };
  const document = {
    createElement: () => new FakeElement(),
    getElementById: (id: string) => elements[id],
  };
  const fetch = async (path: string, init?: RequestInit) => {
    requests.push({ path, init });
    if (path === "/api/tickets?status=triage&limit=20") {
      return jsonResponse({ items: [fixtureTicket], total: 1 });
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
    if (path === "/api/tickets/TKT-1001") {
      return jsonResponse({ ticket: fixtureTicket, audits: { events: [] } });
    }
    if (path === "/api/tickets/TKT-1001/recommendations") {
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
    throw new Error(`Unexpected request: ${path}`);
  };

  const script = extractScript(approvalDeskHtml);
  Function("document", "fetch", "encodeURIComponent", script)(
    document,
    fetch,
    encodeURIComponent,
  );
  await settle();

  return {
    el: (id: string) => elements[id],
    evidenceRequests: () =>
      requests.filter((request) => request.path === "/api/evidence").length,
    field: (value: string) =>
      elements.fieldChoices.children.find((field) => field.value === value)!,
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
  };
}

function createElements(): Record<string, FakeElement> {
  const elements = Object.fromEntries(
    [
      "actor",
      "approveButton",
      "confirmApproval",
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
  elements.draftStyle.value = "balanced";
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
    return field;
  });
  return elements;
}

class FakeElement {
  checked = false;
  children: FakeElement[] = [];
  className = "";
  disabled = false;
  innerHTML = "";
  textContent = "";
  type = "";
  value = "";
  private readonly listeners = new Map<string, Array<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  append(child: FakeElement): void {
    this.children.push(child);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }

  querySelectorAll(selector: string): FakeElement[] {
    if (selector === 'input[type="checkbox"]:checked') {
      return this.children.filter((child) => child.checked);
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

async function settle(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) {
    await Promise.resolve();
  }
}
