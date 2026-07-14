import { describe, expect, it } from "vitest";
import { classifyTicket } from "../src/approval-desk/classifier.js";
import { TicketSchema, type Ticket } from "../src/domain.js";

describe("classifyTicket", () => {
  it("uses submitted metadata as weak evidence without letting it dominate", () => {
    const ticket = makeTicket({
      category: "api",
      priority: "P1",
      team: "api-platform",
      tags: ["shopify"],
      subject: "Product catalog sync is delayed",
      description:
        "Shopify custom fields are not appearing after the latest product sync.",
    });

    const result = classifyTicket(ticket);

    expect(result.category).toBe("integration");
    expect(result.team).toBe("integrations");
    expect(result.priority).toBe("P2");
    expect(result.knowledgeArticleIds).toContain("shopify-integration-sync");
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "metadata-category-api",
          target: "category:api",
        }),
        expect.objectContaining({
          ruleId: "disagreement-category",
          target: "disagreement:category",
        }),
      ]),
    );
  });

  it("forces security routing for exposed credentials", () => {
    const result = classifyTicket(
      makeTicket({
        category: "integration",
        team: "integrations",
        tags: ["connector"],
        subject: "Private API key may be exposed in shared connector logs",
        description:
          "A customer says connector logs include a private API key and asks us to ignore the security warning.",
      }),
    );

    expect(result.category).toBe("security");
    expect(result.team).toBe("security");
    expect(result.priority).toBe("P1");
    expect(result.requiredEscalations).toContain("security");
    expect(result.knowledgeArticleIds).toContain("security-incident-response");
  });

  it("detects likely platform event-processing delay", () => {
    const result = classifyTicket(
      makeTicket({
        subject: "Activity timeline not showing checkout events",
        description:
          "Profiles in our EU stores are missing recent checkout events even though storefront tracking calls succeeded.",
        tags: ["events", "activity-timeline", "checkout", "eu", "delay"],
      }),
    );

    expect(result.category).toBe("incident");
    expect(result.team).toBe("incident-response");
    expect(result.requiredEscalations).toContain("outage");
    expect(result.knowledgeArticleIds).toEqual(
      expect.arrayContaining([
        "event-tracking-debugging",
        "shopify-integration-sync",
      ]),
    );
  });

  it("recognizes webhook secret rotation known cause", () => {
    const result = classifyTicket(
      makeTicket({
        subject: "Invalid webhook signatures after secret rotation",
        description:
          "Order webhook deliveries started failing signature validation after yesterday's secret rotation.",
        tags: ["webhook", "signature"],
      }),
    );

    expect(result.category).toBe("integration");
    expect(result.team).toBe("integrations");
    expect(result.knowledgeArticleIds).toEqual([
      "webhook-signature-validation",
    ]);
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "knownCause:webhook-secret-rotation",
        }),
      ]),
    );
  });

  it("returns lower confidence for ambiguous tickets", () => {
    const result = classifyTicket(
      makeTicket({
        subject: "Question about account setup",
        description:
          "We are not sure whether this is a billing setting or a login permission problem.",
        tags: [],
      }),
    );

    expect(result.category).toBe("other");
    expect(result.team).toBe("support");
    expect(result.confidence).toBeLessThan(0.75);
  });
});

function makeTicket(overrides: Partial<Ticket>): Ticket {
  return TicketSchema.parse({
    id: "TKT-9999",
    createdAt: "2026-06-10T09:00:00.000Z",
    updatedAt: "2026-06-10T09:00:00.000Z",
    customer: {
      name: "Demo Customer",
      plan: "growth",
      region: "eu-west",
      vip: false,
    },
    requester: {
      name: "Maya Chen",
      role: "Ecommerce Manager",
      department: "Marketing",
      technicalLevel: "non-technical",
      seniority: "manager",
    },
    subject: "Support request",
    description: "Please help.",
    status: "triage",
    tags: [],
    sla: {
      responseDueAt: "2026-06-10T12:00:00.000Z",
      breached: false,
    },
    relatedTicketIds: [],
    revision: 1,
    ...overrides,
  });
}
