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
  });

  it("uses only local API routes", () => {
    expect(approvalDeskHtml).toContain("/api/tickets");
    expect(approvalDeskHtml).toContain("/api/metrics");
    expect(approvalDeskHtml).not.toContain("https://");
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
  rationale: "Matches account access routing.",
  confidence: 0.87,
  recommendedNextAction: "Review evidence before approval.",
  escalationRequired: true,
  escalationReasons: ["missing-information"],
  resolution: "pending",
  createdAt: "2026-06-10T08:35:00.000Z",
};

async function startApprovalDeskApp(options: {
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
      "editedCustomerResponse",
      "feedback",
      "fieldChoices",
      "queueStatus",
      "recommendationPanel",
      "refreshQueue",
      "rejectButton",
      "resultPanel",
      "ticketList",
      "ticketPanel",
    ].map((id) => [id, new FakeElement()]),
  );
  elements.actor.value = "approval-desk";
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
