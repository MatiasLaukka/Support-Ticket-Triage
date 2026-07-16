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
    expect(input.draftCustomerResponse).toContain("Hi Prompt Streetwear,");
    expect(input.draftCustomerResponse).toContain(
      "To move this forward, please share:",
    );
    expect(input.draftCustomerResponse).toContain(
      "- ecommerce platform, such as Shopify, Magento, WooCommerce, or custom",
    );
    expect(countOccurrences(input.draftCustomerResponse, "ecommerce platform")).toBe(
      1,
    );
    expect(input.supportState).toBe("needs-information");
    expect(input.requiredEvidence?.map((requirement) => requirement.id)).toEqual(
      expect.arrayContaining(["platform", "flow-id", "event-id"]),
    );
    expect(input.missingEvidence?.map((requirement) => requirement.id)).toEqual(
      expect.arrayContaining(["platform", "flow-id", "event-id"]),
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

  it("uses known-cause guidance in webhook secret rotation draft responses", async () => {
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
    expect(input.supportState).toBe("needs-information");
    expect(input.knownCause).toBe("webhook-secret-rotation");
    expect(input.draftCustomerResponse).toContain(
      "post-rotation issue",
    );
    expect(input.draftCustomerResponse).toContain("current signing secret");
    expect(input.draftCustomerResponse).toContain("endpoint URL");
    expect(input.draftCustomerResponse).toContain("delivery ID");
    expect(input.draftCustomerResponse).toContain("raw body");
    expect(input.draftCustomerResponse).not.toContain("timestamp tolerance");
    expect(input.providedEvidence?.map((requirement) => requirement.id)).toContain(
      "signing-secret-rotation-time",
    );
    expect(input.draftCustomerResponse).not.toContain(
      "webhook-signature-validation",
    );
  });

  it("keeps product catalog delay drafts separate from coupon-pool wording", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1020");

    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: outcomes.get("TKT-1020")!,
      actor: "approval-desk",
    });

    expect(input.draftCustomerResponse).toContain(
      "product catalog sync delay",
    );
    expect(input.draftCustomerResponse).toContain("Affected store URL");
    expect(input.draftCustomerResponse).toContain("Last catalog sync time");
    expect(input.draftCustomerResponse).not.toContain("coupon");
    expect(input.draftCustomerResponse).not.toContain("Coupon pool");
    expect(input.draftCustomerResponse).not.toContain("unused coupon");
  });

  it("adapts vague ticket classification and draft after campaign editor blank-page reply", async () => {
    const ticket = await loadSeedTicket("TKT-1010");
    const input = buildApprovalDeskRecommendationInput({
      ticket,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-1",
          ticketId: "TKT-1010",
          createdAt: "2026-06-10T09:05:00.000Z",
          body:
            "I was trying to open the campaign editor, but the page stayed blank. The steps were: I opened the campaign, clicked Edit, and then the page stayed blank.",
        },
      ],
    });

    expect(input.category).toBe("performance");
    expect(input.team).toBe("product");
    expect(input.supportState).toMatch(/diagnosing|information-received/);
    expect(input.providedEvidence?.map((requirement) => requirement.id)).toEqual(
      expect.arrayContaining(["problem-summary", "reproduction-steps"]),
    );
    expect(input.missingEvidence?.map((requirement) => requirement.id)).not.toContain(
      "screenshot-or-error",
    );
    expect(input.missingEvidence?.map((requirement) => requirement.id)).toEqual(
      expect.arrayContaining([
        "campaign-name",
        "failure-timestamp",
        "browser-session-details",
        "affected-scope",
      ]),
    );
    expect(input.draftCustomerResponse).toContain("campaign editor");
    expect(input.draftCustomerResponse).toContain("loading");
    expect(input.draftCustomerResponse).not.toContain("screenshot or exact message");
  });

  it("adapts webhook known-cause drafts across customer follow-up turns", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1008");
    const outcome = outcomes.get("TKT-1008")!;

    const firstContact = buildApprovalDeskRecommendationInput({
      ticket,
      outcome,
      actor: "approval-desk",
    });

    expect(firstContact.supportState).toBe("needs-information");
    expect(firstContact.draftCustomerResponse).toContain(
      "To move this forward, please share:",
    );
    expect(firstContact.draftCustomerResponse).toContain("endpoint URL");
    expect(firstContact.draftCustomerResponse).toContain("delivery ID");

    const partialFollowUp = buildApprovalDeskRecommendationInput({
      ticket,
      outcome,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-1",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:05:00.000Z",
          body: "The endpoint URL is https://hooks.juniper.example/webhooks/orders and the delivery ID is deliv_7788.",
        },
      ],
    });

    expect(partialFollowUp.supportState).toBe("information-received");
    expect(partialFollowUp.draftCustomerResponse).toContain(
      "Thanks for sending those details.",
    );
    expect(partialFollowUp.draftCustomerResponse).toContain(
      "we still need:",
    );
    expect(partialFollowUp.draftCustomerResponse).not.toContain("- endpoint URL");
    expect(partialFollowUp.draftCustomerResponse).not.toContain("- delivery ID");
    expect(partialFollowUp.draftCustomerResponse).toContain("raw body");

    const allEvidence = buildApprovalDeskRecommendationInput({
      ticket,
      outcome,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-1",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:05:00.000Z",
          body: "The endpoint URL is https://hooks.juniper.example/webhooks/orders and the delivery ID is deliv_7788.",
        },
        {
          id: "reply-2",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:18:00.000Z",
          body: "Raw body handling has not changed since yesterday.",
        },
      ],
    });

    expect(allEvidence.supportState).toBe("known-cause");
    expect(allEvidence.missingEvidence).toEqual([]);
    expect(allEvidence.draftCustomerResponse).toContain(
      "Thanks for confirming those details.",
    );
    expect(allEvidence.draftCustomerResponse).toContain(
      "current signing secret",
    );

    const customerConfirmed = buildApprovalDeskRecommendationInput({
      ticket,
      outcome,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-1",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:05:00.000Z",
          body: "The endpoint URL is https://hooks.juniper.example/webhooks/orders and the delivery ID is deliv_7788.",
        },
        {
          id: "reply-2",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:18:00.000Z",
          body: "Raw body handling has not changed since yesterday.",
        },
        {
          id: "reply-3",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T10:02:00.000Z",
          body: "That fixed it. Thanks for the help!",
        },
      ],
    });

    expect(customerConfirmed.supportState).toBe("ready-for-close");
    expect(customerConfirmed.draftCustomerResponse).toContain(
      "Glad to hear that resolved it.",
    );
    expect(customerConfirmed.missingInformation).toEqual([]);
  });

  it("keeps needs-information when a vague reply adds no recognized evidence", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1008");

    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: outcomes.get("TKT-1008")!,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-vague",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:05:00.000Z",
          body: "It is still happening, but I am not sure where to find the technical details.",
        },
      ],
    });

    expect(input.supportState).toBe("needs-information");
    expect(input.draftCustomerResponse).toContain(
      "Thanks for getting back to us.",
    );
    expect(input.draftCustomerResponse).toContain(
      "we still need the specific details below",
    );
  });

  it("passes compact conversation context to GPT drafting for vague follow-ups", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1008");
    let capturedDraftInput: any;

    await buildApprovalDeskRecommendationInputWithDrafting({
      ticket,
      outcome: outcomes.get("TKT-1008")!,
      actor: "approval-desk",
      knowledgeArticles: [],
      customerReplies: [
        {
          id: "reply-vague",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:05:00.000Z",
          body: "It is still happening, but I am not sure where to find the technical details.",
        },
      ],
      draftProvider: {
        draft: async (draftInput) => {
          capturedDraftInput = draftInput;
          return {
            source: "openai",
            response:
              "Thanks for getting back to us. We still need the endpoint URL, delivery ID, and raw body handling details before we can confirm the safest next step.",
            assist: {
              source: "openai",
              missingInfoSuggestions: [
                "Share the endpoint URL, delivery ID, and raw body handling details.",
              ],
              investigationSteps: [
                "Compare the latest customer reply with the remaining evidence checklist.",
              ],
              tone: "empathetic",
              recommendedTone: "empathetic",
              selectedTone: "empathetic",
              toneReason:
                "The customer replied but needs help finding technical details.",
              audience: "developer",
              checks: [],
            },
          };
        },
      },
    });

    expect(capturedDraftInput.conversationContext).toMatchObject({
      turnType: "vague-follow-up",
      hasCustomerReply: true,
      recognizedEvidenceProgress: false,
      latestCustomerReply: {
        body: "It is still happening, but I am not sure where to find the technical details.",
        createdAt: "2026-06-10T09:05:00.000Z",
      },
    });
  });

  it("infers lifecycle state from reply content rather than reply order", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1008");
    const outcome = outcomes.get("TKT-1008")!;

    const completeKnownCauseFirst = buildApprovalDeskRecommendationInput({
      ticket,
      outcome,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-complete-known-cause",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:05:00.000Z",
          body:
            "Endpoint URL is https://hooks.juniper.example/webhooks/orders. Delivery ID is deliv_7788. Raw body handling has not changed since yesterday.",
        },
      ],
    });

    expect(completeKnownCauseFirst.supportState).toBe("known-cause");
    expect(completeKnownCauseFirst.missingEvidence).toEqual([]);
    expect(completeKnownCauseFirst.draftCustomerResponse).toContain(
      "current signing secret",
    );

    const resolvedAsFirstReply = buildApprovalDeskRecommendationInput({
      ticket,
      outcome,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-resolved",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:05:00.000Z",
          body: "This works now. The issue is resolved on our end.",
        },
      ],
    });

    expect(resolvedAsFirstReply.supportState).toBe("ready-for-close");
    expect(resolvedAsFirstReply.draftCustomerResponse).toContain(
      "Glad to hear that resolved it.",
    );

    const negatedKnownCause = buildApprovalDeskRecommendationInput({
      ticket,
      outcome,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-ruled-out",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:05:00.000Z",
          body:
            "We ruled out signing secret rotation. Endpoint URL is https://hooks.juniper.example/webhooks/orders and delivery ID is deliv_7788.",
        },
      ],
    });

    expect(negatedKnownCause.knownCause).not.toBe("webhook-secret-rotation");
  });

  it("can infer waiting-on-platform-fix from first context when impact is platform-side", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1001");
    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: outcomes.get("TKT-1001")!,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-platform-impact",
          ticketId: "TKT-1001",
          createdAt: "2026-06-10T09:05:00.000Z",
          body:
            "This is affecting all EU stores and recent Checkout Started events are delayed even though the API accepted them.",
        },
      ],
    });

    expect(input.supportState).toBe("waiting-on-platform-fix");
    expect(input.draftCustomerResponse).toContain(
      "possible platform delay affecting event processing",
    );
  });

  it("makes platform-delay context authoritative over a preexisting known cause", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1008");

    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: outcomes.get("TKT-1008")!,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-platform-impact",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:05:00.000Z",
          body:
            "This is affecting all EU stores and recent Checkout Started events are delayed even though the API accepted them.",
        },
      ],
    });

    expect(input.supportState).toBe("waiting-on-platform-fix");
    expect(input.knownCause).not.toBe("webhook-secret-rotation");
    expect(input.draftCustomerResponse).toContain(
      "possible platform delay affecting event processing",
    );
    expect(input.draftCustomerResponse).not.toContain("secret rotation");
    expect(input.draftCustomerResponse).not.toContain("current signing secret");
  });

  it("does not infer a platform fix from negated platform impact", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1008");

    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: outcomes.get("TKT-1008")!,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-negated-platform-impact",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:05:00.000Z",
          body:
            "This is not affecting all stores, but recent Checkout Started events are delayed even though the API accepted them.",
        },
      ],
    });

    expect(input.supportState).not.toBe("waiting-on-platform-fix");
  });

  it.each([
    "Only one store is affected, not all stores, although recent Checkout Started events are delayed even though the API accepted them.",
    "One account is affected, not multiple accounts, although recent Checkout Started events are delayed even though the API accepted them.",
  ])(
    "does not infer a platform fix when limited impact is stated after the quantity phrase",
    async (body) => {
      const outcomes = await loadExpectedOutcomes(
        resolve("data/seed/expected-outcomes.json"),
      );
      const ticket = await loadSeedTicket("TKT-1001");

      const input = buildApprovalDeskRecommendationInput({
        ticket,
        outcome: outcomes.get("TKT-1001")!,
        actor: "approval-desk",
        customerReplies: [
          {
            id: "reply-limited-platform-impact",
            ticketId: "TKT-1001",
            createdAt: "2026-06-10T09:05:00.000Z",
            body,
          },
        ],
      });

      expect(input.supportState).not.toBe("waiting-on-platform-fix");
    },
  );

  it("uses reply-enriched known-cause evidence when choosing the deterministic draft style", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const originalTicket = await loadSeedTicket("TKT-1008");
    const ticket = TicketSchema.parse({
      ...originalTicket,
      subject: "Webhook signature verification fails",
      description: "Our endpoint rejects webhook HMAC signatures.",
    });

    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: outcomes.get("TKT-1008")!,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-known-cause-evidence",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:05:00.000Z",
          body:
            "Since the secret rotation, webhook signature verification fails. Endpoint URL is https://hooks.juniper.example/webhooks/orders. Delivery ID is deliv_7788. Raw body handling has not changed since yesterday.",
        },
      ],
    });

    expect(input.supportState).toBe("known-cause");
    expect(input.missingEvidence).toEqual([]);
    expect(input.draftCustomerResponse).toContain("post-rotation issue");
    expect(input.draftCustomerResponse).toContain("current signing secret");
  });

  it("ignores customer replies from other tickets when building lifecycle drafts", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1008");

    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: outcomes.get("TKT-1008")!,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-other-ticket",
          ticketId: "TKT-9999",
          createdAt: "2026-06-10T09:05:00.000Z",
          body: "That fixed it. Thanks for the help!",
        },
      ],
    });

    expect(input.supportState).toBe("needs-information");
    expect(input.draftCustomerResponse).toContain("endpoint URL");
    expect(input.draftCustomerResponse).not.toContain(
      "Glad to hear that resolved it.",
    );
  });

  it("does not treat negated resolution language as customer confirmation", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1008");

    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: outcomes.get("TKT-1008")!,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-negative",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T10:02:00.000Z",
          body: "This is not fixed and the webhook is still unresolved.",
        },
      ],
    });

    expect(input.supportState).not.toBe("ready-for-close");
    expect(input.draftCustomerResponse).not.toContain(
      "Glad to hear that resolved it.",
    );
  });

  it("does not close on a contradictory customer reply", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1008");

    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: outcomes.get("TKT-1008")!,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-contradictory",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T10:02:00.000Z",
          body: "The workaround works now, but the issue is still unresolved.",
        },
      ],
    });

    expect(input.supportState).not.toBe("ready-for-close");
    expect(input.draftCustomerResponse).not.toContain(
      "Glad to hear that resolved it.",
    );
  });

  it("does not close when a workaround works but the issue still fails", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1008");

    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: outcomes.get("TKT-1008")!,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-contradictory-failure",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T10:02:00.000Z",
          body:
            "The workaround works now, but the underlying issue continues to fail intermittently.",
        },
      ],
    });

    expect(input.supportState).not.toBe("ready-for-close");
    expect(input.draftCustomerResponse).not.toContain(
      "Glad to hear that resolved it.",
    );
  });

  it("uses the newest customer reply by createdAt for confirmation", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1008");

    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: outcomes.get("TKT-1008")!,
      actor: "approval-desk",
      customerReplies: [
        {
          id: "reply-newer",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T10:02:00.000Z",
          body: "That fixed it. Thanks for the help!",
        },
        {
          id: "reply-older",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:05:00.000Z",
          body: "The endpoint URL is https://hooks.juniper.example/webhooks/orders.",
        },
      ],
    });

    expect(input.supportState).toBe("ready-for-close");
    expect(input.draftCustomerResponse).toContain(
      "Glad to hear that resolved it.",
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
    expect(input.supportState).toBe("known-cause");
    expect(input.knownCause).toBe("sms-quiet-hours");
    expect(input.missingEvidence).toEqual([]);
    expect(input.draftCustomerResponse).toContain("quiet-hour protection");
    expect(input.draftCustomerResponse).toContain("blocked delivery");
    expect(input.draftCustomerResponse).toContain("expected compliance");
    expect(input.draftCustomerResponse).toContain("eligible sending window");
    expect(input.draftCustomerResponse).not.toContain("masked recipient phone");
    expect(input.draftCustomerResponse).not.toContain("consent source");
    expect(input.draftCustomerResponse).not.toContain("opt-in timestamp");
    expect(input.draftCustomerResponse).toContain(
      "We do not need any additional information from you before the next update.",
    );
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

  it("rejects AI webhook secret guidance when platform-fix context is authoritative", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1008");

    const input = await buildApprovalDeskRecommendationInputWithDrafting({
      ticket,
      outcome: outcomes.get("TKT-1008")!,
      actor: "approval-desk",
      knowledgeArticles: [],
      customerReplies: [
        {
          id: "reply-platform-delay",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:05:00.000Z",
          body:
            "This is affecting all EU stores and recent Checkout Started events are delayed even though the API accepted them.",
        },
      ],
      draftProvider: {
        draft: async () => ({
          source: "openai",
          response:
            "Please verify the current signing secret configured for the webhook endpoint.",
          assist: {
            source: "openai",
            missingInfoSuggestions: [
              "Confirm whether secret rotation changed recently.",
            ],
            investigationSteps: [
              "Compare the signed webhook payload with the endpoint response.",
            ],
            tone: "technical",
            recommendedTone: "technical",
            selectedTone: "technical",
            toneReason: "Webhook troubleshooting needs integration details.",
            audience: "developer",
            checks: [],
          },
        }),
      },
    });

    expect(input.supportState).toBe("waiting-on-platform-fix");
    expect(input.draftCustomerResponseSource).toBe("fallback");
    expect(input.draftCustomerResponse).toContain(
      "possible platform delay affecting event processing",
    );
    expect(input.draftCustomerResponse).not.toContain("current signing secret");
    expect(input.draftCustomerResponseChecks).toContainEqual(
      expect.objectContaining({
        id: "fallback-used",
        status: "warn",
        message: expect.stringContaining("platform-fix lifecycle state"),
      }),
    );
  });

  it("rejects AI active-webhook-secret guidance when platform-fix context is authoritative", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1008");

    const input = await buildApprovalDeskRecommendationInputWithDrafting({
      ticket,
      outcome: outcomes.get("TKT-1008")!,
      actor: "approval-desk",
      knowledgeArticles: [],
      customerReplies: [
        {
          id: "reply-platform-delay",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:05:00.000Z",
          body:
            "This is affecting all EU stores and recent Checkout Started events are delayed even though the API accepted them.",
        },
      ],
      draftProvider: {
        draft: async () => ({
          source: "openai",
          response: "Please confirm the webhook uses the active secret.",
          assist: {
            source: "openai",
            missingInfoSuggestions: [
              "Confirm which webhook secret is configured.",
            ],
            investigationSteps: [
              "Verify the active secret configured for the webhook endpoint.",
            ],
            tone: "technical",
            recommendedTone: "technical",
            selectedTone: "technical",
            toneReason: "Webhook troubleshooting needs integration details.",
            audience: "developer",
            checks: [],
          },
        }),
      },
    });

    expect(input.supportState).toBe("waiting-on-platform-fix");
    expect(input.draftCustomerResponseSource).toBe("fallback");
    expect(input.draftCustomerResponse).toContain(
      "possible platform delay affecting event processing",
    );
    expect(input.draftCustomerResponseChecks).toContainEqual(
      expect.objectContaining({
        id: "fallback-used",
        status: "warn",
        message: expect.stringContaining("platform-fix lifecycle state"),
      }),
    );
  });

  it("rejects AI signature guidance for a secret that is currently active during a platform fix", async () => {
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const ticket = await loadSeedTicket("TKT-1008");

    const input = await buildApprovalDeskRecommendationInputWithDrafting({
      ticket,
      outcome: outcomes.get("TKT-1008")!,
      actor: "approval-desk",
      knowledgeArticles: [],
      customerReplies: [
        {
          id: "reply-platform-delay",
          ticketId: "TKT-1008",
          createdAt: "2026-06-10T09:05:00.000Z",
          body:
            "This is affecting all EU stores and recent Checkout Started events are delayed even though the API accepted them.",
        },
      ],
      draftProvider: {
        draft: async () => ({
          source: "openai",
          response:
            "Make sure the endpoint validates signatures with the secret that is currently active.",
          assist: {
            source: "openai",
            missingInfoSuggestions: ["No additional details are needed."],
            investigationSteps: ["Review the reported processing delay."],
            tone: "technical",
            recommendedTone: "technical",
            selectedTone: "technical",
            toneReason: "The requester is technical.",
            audience: "developer",
            checks: [],
          },
        }),
      },
    });

    expect(input.supportState).toBe("waiting-on-platform-fix");
    expect(input.draftCustomerResponseSource).toBe("fallback");
    expect(input.draftCustomerResponseChecks).toContainEqual(
      expect.objectContaining({
        id: "fallback-used",
        status: "warn",
        message: expect.stringContaining("platform-fix lifecycle state"),
      }),
    );
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

  it("builds a classifier-driven recommendation when no expected outcome exists", async () => {
    const ticket = TicketSchema.parse({
      ...(await loadSeedTicket("TKT-1008")),
      id: "TKT-9999",
    });

    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: undefined,
      actor: "approval-desk",
    });

    expect(input).toMatchObject({
      ticketId: "TKT-9999",
      category: "integration",
      priority: "P2",
      team: "integrations",
      knowledgeArticleIds: ["webhook-signature-validation"],
      actor: "approval-desk",
    });
    expect(input.classificationSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "knownCause:webhook-secret-rotation",
        }),
      ]),
    );
    expect(input.rationale).toContain("classifier");
  });

  it("asks for basic problem evidence for vague classifier-driven tickets", async () => {
    const ticket = await loadSeedTicket("TKT-1010");

    const input = buildApprovalDeskRecommendationInput({
      ticket,
      outcome: undefined,
      actor: "approval-desk",
    });

    expect(input.category).toBe("other");
    expect(input.supportState).toBe("needs-information");
    expect(input.missingInformation).toEqual(
      expect.arrayContaining([
        expect.stringContaining("what you were trying to do"),
        expect.stringContaining("steps you took"),
        expect.stringContaining("screenshot or exact message"),
      ]),
    );
    expect(input.draftCustomerResponse).toContain(
      "I am sorry this is getting in your way.",
    );
    expect(input.draftCustomerResponse).toContain(
      "To move this forward, please share:",
    );
    expect(input.draftCustomerResponse).toContain(
      "what you were trying to do",
    );
    expect(input.draftCustomerResponse).not.toContain(
      "We do not need any additional information",
    );
    expect(input.draftCustomerResponse).not.toContain("Once we have those details");
    expect(input.draftCustomerResponse).not.toContain("activity timeline");
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

function countOccurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}
