import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TicketSchema, type Ticket } from "../src/domain.js";
import {
  buildApprovalDeskRecommendationInput,
  buildApprovalDeskRecommendationInputWithDrafting,
  loadExpectedOutcomes,
} from "../src/approval-desk/recommendation-builder.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("Approval Desk recommendation builder", () => {
  it("loads expected outcomes keyed by ticket ID", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );

    expect(outcomes.get("TKT-1005")).toMatchObject({
      category: "integration",
      team: "integrations",
      knowledgeArticleIds: [
        "flow-trigger-troubleshooting",
        "event-tracking-debugging",
      ],
    });
  });

  it("builds deterministic recommendation input for the selected ticket and outcome", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1005");

    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: outcomes.get("TKT-1005")!,
      actor: "approval-desk",
    });

    expect(input).toMatchObject({
      ticketId: "TKT-1005",
      sourceRevision: 0,
      category: "integration",
      priority: "P2",
      team: "integrations",
      knowledgeArticleIds: [
        "flow-trigger-troubleshooting",
        "event-tracking-debugging",
      ],
      actor: "approval-desk",
    });
    expect(input.tags).toContain("prompt-injection");
    expect(input.rationale).toContain("TKT-1005");
    expect(input.draftCustomerResponse).toContain(
      "We are checking why Viewed Product events",
    );
    expect(input.gptAssist).toMatchObject({
      source: "deterministic",
      tone: "empathetic",
      recommendedTone: "empathetic",
      selectedTone: "empathetic",
      audience: "merchant-admin",
      missingInfoSuggestions: expect.arrayContaining([
        expect.stringContaining("ecommerce platform"),
      ]),
      investigationSteps: expect.arrayContaining([
        expect.stringContaining("flow setup"),
      ]),
    });
  });

  it("uses customer-facing knowledge guidance in draft responses", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1008");

    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: outcomes.get("TKT-1008")!,
      actor: "approval-desk",
    });

    expect(input.knowledgeArticleIds).toEqual([
      "webhook-signature-validation",
    ]);
    expect(input.draftCustomerResponse).toContain("endpoint URL");
    expect(input.draftCustomerResponse).toContain("delivery ID");
    expect(input.draftCustomerResponse).toContain("failure timestamp");
    expect(input.draftCustomerResponse).toContain("signing secret rotation");
    expect(input.draftCustomerResponse).toContain("raw body handling");
    expect(input.draftCustomerResponse).toContain("timestamp tolerance");
    expect(input.draftCustomerResponse).not.toContain(
      "webhook-signature-validation",
    );
  });

  it("keeps multiple knowledge IDs internal while using merchant-friendly flow guidance", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1011");

    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: outcomes.get("TKT-1011")!,
      actor: "approval-desk",
    });

    expect(input.knowledgeArticleIds).toEqual([
      "flow-trigger-troubleshooting",
      "event-tracking-debugging",
    ]);
    expect(input.draftCustomerResponse).toContain("Abandoned Cart flow");
    expect(input.draftCustomerResponse).toContain("ecommerce platform");
    expect(input.draftCustomerResponse).toContain("Shopify");
    expect(input.draftCustomerResponse).toContain("Magento");
    expect(input.draftCustomerResponse).toContain("flow name or flow ID");
    expect(input.draftCustomerResponse).toContain("event ID or event time");
    expect(input.draftCustomerResponse).toContain("product or cart URL");
    expect(input.draftCustomerResponse).not.toContain("payload");
    expect(input.draftCustomerResponse).not.toContain("API accepted time");
    expect(input.draftCustomerResponse).not.toContain(
      "downstream qualification",
    );
    expect(input.draftCustomerResponse).not.toContain("smart sending");
    expect(input.draftCustomerResponse).not.toContain(
      "flow-trigger-troubleshooting",
    );
    expect(input.draftCustomerResponse).not.toContain(
      "event-tracking-debugging",
    );
  });

  it("asks merchant-friendly ecommerce details for prompt-injection flow tickets", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1005");

    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: outcomes.get("TKT-1005")!,
      actor: "approval-desk",
    });

    expect(input.tags).toContain("prompt-injection");
    expect(input.draftCustomerResponse).toContain("Viewed Product");
    expect(input.draftCustomerResponse).toContain("Browse Abandonment flow");
    expect(input.draftCustomerResponse).toContain("ecommerce platform");
    expect(input.draftCustomerResponse).toContain("Shopify");
    expect(input.draftCustomerResponse).toContain("Magento");
    expect(input.draftCustomerResponse).toContain("WooCommerce");
    expect(input.draftCustomerResponse).toContain("flow name or flow ID");
    expect(input.draftCustomerResponse).toContain("event ID or event time");
    expect(input.draftCustomerResponse).toContain("product URL or product ID");
    expect(input.draftCustomerResponse).not.toContain("payload");
    expect(input.draftCustomerResponse).not.toContain("API accepted time");
    expect(input.draftCustomerResponse).not.toContain(
      "downstream qualification",
    );
    expect(input.draftCustomerResponse).not.toContain("consent state");
    expect(input.draftCustomerResponse).not.toContain("smart sending");
  });

  it("answers known-cause SMS quiet-hour blocks without asking for diagnostics", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1017");

    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: outcomes.get("TKT-1017")!,
      actor: "approval-desk",
    });

    expect(input.knowledgeArticleIds).toEqual(["sms-compliance"]);
    expect(input.draftCustomerResponse).toContain("quiet-hour protection");
    expect(input.draftCustomerResponse).toContain("blocked delivery");
    expect(input.draftCustomerResponse).toContain("expected compliance");
    expect(input.draftCustomerResponse).toContain("eligible sending window");
    expect(input.draftCustomerResponse).not.toContain("masked recipient phone");
    expect(input.draftCustomerResponse).not.toContain("consent source");
    expect(input.draftCustomerResponse).not.toContain("opt-in timestamp");
  });

  it("uses escalation-aware wording for likely outage recommendations", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1001");

    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: outcomes.get("TKT-1001")!,
      actor: "approval-desk",
    });

    expect(input.outageRisk).toBe("likely");
    expect(input.draftCustomerResponse).toContain(
      "possible platform delay affecting event processing",
    );
    expect(input.draftCustomerResponse).toContain("incident review");
    expect(input.draftCustomerResponse).toContain("event-ingestion");
  });

  it("uses a validated OpenAI draft provider response when available", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1005");

    const input = await buildApprovalDeskRecommendationInputWithDrafting({
      ticket,
      outcome: outcomes.get("TKT-1005")!,
      actor: "approval-desk",
      knowledgeArticles: [
        {
          id: "flow-trigger-troubleshooting",
          title: "Flow trigger troubleshooting",
          tags: ["flows"],
          body: "Check the ecommerce platform, flow ID, and event ID before recommending a flow change.",
        },
      ],
      draftProvider: {
        draft: async () => ({
          source: "openai",
          response:
            "We are checking why Viewed Product events did not place customers into the Browse Abandonment flow. Please send the ecommerce platform, flow ID, event ID, and one affected customer email so we can compare the storefront event with the flow setup.",
          assist: {
            source: "openai",
            missingInfoSuggestions: [
              "Share the ecommerce platform.",
              "Share the flow ID and event ID.",
            ],
            investigationSteps: [
              "Compare the storefront event with the flow setup.",
            ],
            tone: "empathetic",
            recommendedTone: "empathetic",
            selectedTone: "empathetic",
            toneReason:
              "Requester is a non-technical marketing user reporting flow impact.",
            audience: "merchant-admin",
            checks: [],
          },
        }),
      },
      responseStyle: "auto",
    });

    expect(input.draftCustomerResponseSource).toBe("openai");
    expect(input.draftCustomerResponse).toContain("Viewed Product events");
    expect(input.gptAssist).toMatchObject({
      source: "openai",
      missingInfoSuggestions: [
        "Share the ecommerce platform.",
        "Share the flow ID and event ID.",
      ],
      investigationSteps: [
        "Compare the storefront event with the flow setup.",
      ],
      recommendedTone: "empathetic",
      selectedTone: "empathetic",
      toneReason:
        "Requester is a non-technical marketing user reporting flow impact.",
    });
    expect(input.draftCustomerResponseChecks).toContainEqual(
      expect.objectContaining({
        id: "no-internal-article-ids",
        status: "pass",
      }),
    );
  });

  it("falls back to the deterministic response when an AI draft exposes internal details", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1005");

    const input = await buildApprovalDeskRecommendationInputWithDrafting({
      ticket,
      outcome: outcomes.get("TKT-1005")!,
      actor: "approval-desk",
      knowledgeArticles: [],
      draftProvider: {
        draft: async () => ({
          source: "openai",
          response:
            "We approved this using flow-trigger-troubleshooting and will close the ticket.",
          assist: {
            source: "openai",
            missingInfoSuggestions: ["Share your API secret."],
            investigationSteps: ["Close the ticket as approved."],
            tone: "balanced",
            recommendedTone: "balanced",
            selectedTone: "balanced",
            toneReason: "Unsafe provider draft should be rejected.",
            audience: "developer",
            checks: [],
          },
        }),
      },
    });

    expect(input.draftCustomerResponseSource).toBe("fallback");
    expect(input.draftCustomerResponse).toContain(
      "We are checking why Viewed Product events",
    );
    expect(input.draftCustomerResponse).not.toContain(
      "flow-trigger-troubleshooting",
    );
    expect(input.draftCustomerResponseChecks).toContainEqual(
      expect.objectContaining({
        id: "fallback-used",
        status: "warn",
      }),
    );
    expect(input.gptAssist).toMatchObject({
      source: "fallback",
      missingInfoSuggestions: expect.arrayContaining([
        expect.stringContaining("ecommerce platform"),
      ]),
    });
  });

  it("keeps manual draft style overrides separate from the recommended tone", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1005");

    const input = await buildApprovalDeskRecommendationInputWithDrafting({
      ticket,
      outcome: outcomes.get("TKT-1005")!,
      actor: "approval-desk",
      knowledgeArticles: [],
      responseStyle: "technical",
    });

    expect(input.draftCustomerResponseStyle).toBe("technical");
    expect(input.gptAssist).toMatchObject({
      recommendedTone: "empathetic",
      selectedTone: "technical",
      toneReason: expect.stringContaining("Marketing Coordinator"),
    });
  });

  it("throws when no expected outcome exists for the ticket", async () => {
    const ticket = TicketSchema.parse({
      ...(await loadSeedTicket("TKT-1005")),
      id: "TKT-9999",
    });

    expect(() =>
      buildApprovalDeskRecommendationInput({
        ticket,
        outcome: undefined,
        actor: "approval-desk",
      }),
    ).toThrow("No expected outcome exists for TKT-9999.");
  });

  it("throws when the expected outcome belongs to a different ticket", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1005");

    expect(() =>
      buildApprovalDeskRecommendationInput({
        ticket,
        outcome: outcomes.get("TKT-1006")!,
        actor: "approval-desk",
      }),
    ).toThrow("Expected outcome TKT-1006 does not match ticket TKT-1005.");
  });

  it("throws when expected outcomes contain duplicate ticket IDs", async () => {
    const duplicatePath = await writeTemporaryJson([
      {
        ticketId: "TKT-1005",
        category: "authentication",
        acceptablePriorities: ["P2"],
        team: "integrations",
        requiredEscalations: [],
        knowledgeArticleIds: ["flow-trigger-troubleshooting"],
      },
      {
        ticketId: "TKT-1005",
        category: "billing",
        acceptablePriorities: ["P3"],
        team: "billing",
        requiredEscalations: [],
        knowledgeArticleIds: ["coupon-catalog-sync"],
      },
    ]);

    await expect(loadExpectedOutcomes(duplicatePath)).rejects.toThrow(
      "Duplicate expected outcome for TKT-1005.",
    );
  });
});

async function loadSeedTicket(ticketId: string): Promise<Ticket> {
  const raw = await readFile(resolve("data/seed/tickets.json"), "utf8");
  const tickets = TicketSchema.array().parse(JSON.parse(raw));
  const ticket = tickets.find((candidate) => candidate.id === ticketId);
  if (ticket === undefined) {
    throw new Error(`Seed ticket ${ticketId} was not found.`);
  }
  return ticket;
}

async function writeTemporaryJson(value: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "approval-desk-"));
  temporaryRoots.push(root);
  const path = join(root, "expected-outcomes.json");
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}
