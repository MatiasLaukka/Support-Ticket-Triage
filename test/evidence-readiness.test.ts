import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TicketSchema, type Ticket } from "../src/domain.js";
import { analyzeEvidenceReadiness } from "../src/approval-desk/evidence-readiness.js";

describe("analyzeEvidenceReadiness", () => {
  it("dedupes overlapping evidence requirements from multiple knowledge articles", async () => {
    const ticket = await loadSeedTicket("TKT-1005");
    const readiness = analyzeEvidenceReadiness({
      ticket,
      outcome: {
        ticketId: "TKT-1005",
        category: "integration",
        acceptablePriorities: ["P2"],
        team: "integrations",
        requiredEscalations: [],
        knowledgeArticleIds: [
          "flow-trigger-troubleshooting",
          "event-tracking-debugging",
        ],
      },
    });

    expect(readiness.supportState).toBe("needs-information");
    expect(
      readiness.requiredEvidence.filter(
        (requirement) => requirement.id === "platform",
      ),
    ).toHaveLength(1);
    expect(
      readiness.missingEvidence.filter(
        (requirement) => requirement.id === "event-id",
      ),
    ).toHaveLength(1);
  });

  it("detects known SMS quiet-hour causes without asking for evidence", async () => {
    const ticket = await loadSeedTicket("TKT-1017");
    const readiness = analyzeEvidenceReadiness({
      ticket,
      outcome: {
        ticketId: "TKT-1017",
        category: "other",
        acceptablePriorities: ["P3"],
        team: "support",
        requiredEscalations: [],
        knowledgeArticleIds: ["sms-compliance"],
      },
    });

    expect(readiness.supportState).toBe("known-cause");
    expect(readiness.knownCause).toBe("sms-quiet-hours");
    expect(readiness.missingEvidence).toEqual([]);
  });

  it("detects webhook secret rotation known causes and asks only for confirming evidence", async () => {
    const ticket = await loadSeedTicket("TKT-1008");
    const readiness = analyzeEvidenceReadiness({
      ticket,
      outcome: {
        ticketId: "TKT-1008",
        category: "integration",
        acceptablePriorities: ["P2"],
        team: "integrations",
        requiredEscalations: [],
        knowledgeArticleIds: ["webhook-signature-validation"],
      },
    });

    expect(readiness.supportState).toBe("known-cause");
    expect(readiness.knownCause).toBe("webhook-secret-rotation");
    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).toEqual([
      "endpoint-url",
      "delivery-id",
      "signing-secret-rotation-time",
      "raw-body-change-status",
    ]);
    expect(readiness.nextInvestigationSteps).toContain(
      "Confirm the endpoint validates with the current signing secret.",
    );
  });

  it("recognizes provided platform, email, event, and URL evidence", async () => {
    const ticket = TicketSchema.parse({
      ...(await loadSeedTicket("TKT-1005")),
      description:
        "Shopify store https://example-store.com has Viewed Product event ID evt_123 for alex@example.com.",
    });
    const readiness = analyzeEvidenceReadiness({
      ticket,
      outcome: {
        ticketId: "TKT-1005",
        category: "integration",
        acceptablePriorities: ["P2"],
        team: "integrations",
        requiredEscalations: [],
        knowledgeArticleIds: [
          "flow-trigger-troubleshooting",
          "event-tracking-debugging",
        ],
      },
    });

    expect(readiness.providedEvidence.map((requirement) => requirement.id)).toEqual(
      expect.arrayContaining([
        "platform",
        "profile-email",
        "event-id",
        "product-reference",
      ]),
    );
    expect(readiness.missingEvidence.map((requirement) => requirement.id)).not.toContain(
      "platform",
    );
  });

  it("uses API timestamp evidence for Track API local-time timestamp tickets", async () => {
    const ticket = await loadSeedTicket("TKT-1027");
    const readiness = analyzeEvidenceReadiness({
      ticket,
      outcome: {
        ticketId: "TKT-1027",
        category: "api",
        acceptablePriorities: ["P3"],
        team: "api-platform",
        requiredEscalations: [],
        knowledgeArticleIds: ["event-tracking-debugging"],
      },
    });

    expect(readiness.knownCause).toBe("track-api-local-time-timestamp");
    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).toEqual([
      "event-id",
      "api-response-status",
      "sample-payload",
    ]);
    expect(readiness.providedEvidence.map((requirement) => requirement.id)).toEqual(
      expect.arrayContaining(["event-id", "api-response-status"]),
    );
    expect(readiness.missingEvidence.map((requirement) => requirement.id)).toEqual([
      "sample-payload",
    ]);
  });

  it("uses custom field evidence for Shopify field mapping tickets", async () => {
    const ticket = await loadSeedTicket("TKT-1018");
    const readiness = analyzeEvidenceReadiness({
      ticket,
      outcome: {
        ticketId: "TKT-1018",
        category: "integration",
        acceptablePriorities: ["P3"],
        team: "integrations",
        requiredEscalations: [],
        knowledgeArticleIds: ["shopify-integration-sync"],
      },
    });

    expect(readiness.knownCause).toBe("shopify-custom-field-mapping");
    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).toEqual([
      "store-url",
      "object-id",
      "expected-field",
      "source-update-time",
      "catalog-sync-time",
    ]);
    expect(readiness.providedEvidence.map((requirement) => requirement.id)).toContain(
      "expected-field",
    );
  });

  it("uses SMS opt-out evidence instead of campaign send evidence for STOP sync tickets", async () => {
    const ticket = await loadSeedTicket("TKT-1030");
    const readiness = analyzeEvidenceReadiness({
      ticket,
      outcome: {
        ticketId: "TKT-1030",
        category: "account-access",
        acceptablePriorities: ["P3"],
        team: "identity",
        requiredEscalations: [],
        knowledgeArticleIds: ["sms-compliance", "profile-sync-issues"],
      },
    });

    expect(readiness.knownCause).toBe("sms-stop-sync-delay");
    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).toEqual([
      "masked-recipient",
      "opt-out-timestamp",
      "profile-email",
      "consent-timeline",
    ]);
    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).not.toContain(
      "campaign-name",
    );
    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).not.toContain(
      "catalog-sync-time",
    );
  });

  it("uses webhook latency evidence instead of signature evidence for delayed deliveries", async () => {
    const ticket = await loadSeedTicket("TKT-1028");
    const readiness = analyzeEvidenceReadiness({
      ticket,
      outcome: {
        ticketId: "TKT-1028",
        category: "integration",
        acceptablePriorities: ["P2", "P3"],
        team: "integrations",
        requiredEscalations: [],
        knowledgeArticleIds: ["webhook-signature-validation"],
      },
    });

    expect(readiness.knownCause).toBe("webhook-delivery-latency");
    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).toEqual([
      "delivery-id",
      "event-created-time",
      "delivery-attempt-time",
      "endpoint-response-code",
      "retry-history",
    ]);
    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).not.toContain(
      "signing-secret-rotation-time",
    );
    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).not.toContain(
      "timestamp-tolerance",
    );
  });

  it("recognizes rotated signing secret phrasing as signing-secret rotation time evidence", async () => {
    const seedTicket = await loadSeedTicket("TKT-1007");
    const ticket = TicketSchema.parse({
      ...seedTicket,
      description: [
        seedTicket.description,
        "I found the remaining details:",
        "- The failure timestamp was 2026-06-10 09:15 UTC",
        "- We rotated the signing secret yesterday at 08:10 UTC",
        "- The timestamp tolerance configured for verification is five minutes",
        "- The endpoint response code is HTTP 401",
        "- Raw body handling has not changed since yesterday",
      ].join("\n"),
    });

    const readiness = analyzeEvidenceReadiness({
      ticket,
      outcome: {
        ticketId: "TKT-1007",
        category: "integration",
        acceptablePriorities: ["P2"],
        team: "integrations",
        requiredEscalations: [],
        knowledgeArticleIds: ["webhook-signature-validation"],
      },
    });

    expect(readiness.providedEvidence.map((requirement) => requirement.id)).toContain(
      "signing-secret-rotation-time",
    );
    expect(readiness.missingEvidence.map((requirement) => requirement.id)).not.toContain(
      "signing-secret-rotation-time",
    );
  });

  it("uses incident-specific evidence for regional event ingestion incidents", async () => {
    const ticket = await loadSeedTicket("TKT-1001");
    const readiness = analyzeEvidenceReadiness({
      ticket,
      outcome: {
        ticketId: "TKT-1001",
        category: "incident",
        acceptablePriorities: ["P1"],
        team: "incident-response",
        requiredEscalations: ["outage", "sla"],
        knowledgeArticleIds: [
          "event-tracking-debugging",
          "shopify-integration-sync",
        ],
      },
    });

    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).toEqual([
      "store-url",
      "profile-email",
      "event-id",
      "request-id",
      "api-response-status",
      "timeline-visibility",
    ]);
    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).not.toContain(
      "catalog-sync-time",
    );
  });

  it("recognizes demo-safe incident evidence from customer IDs, .test URLs, and accepted API statuses", async () => {
    const ticket = TicketSchema.parse({
      ...(await loadSeedTicket("TKT-1001")),
      description:
        "The affected store URL is https://eu-a.example.test. One affected customer ID is cus_8821. Event time was 2026-06-10 08:42 UTC. Request ID req_1001 returned 202 Accepted. The event is still missing from the profile activity timeline.",
    });
    const readiness = analyzeEvidenceReadiness({
      ticket,
      outcome: {
        ticketId: "TKT-1001",
        category: "incident",
        acceptablePriorities: ["P1"],
        team: "incident-response",
        requiredEscalations: ["outage", "sla"],
        knowledgeArticleIds: [
          "event-tracking-debugging",
          "shopify-integration-sync",
        ],
      },
    });

    expect(readiness.missingEvidence).toEqual([]);
    expect(readiness.providedEvidence.map((requirement) => requirement.id)).toEqual(
      expect.arrayContaining([
        "store-url",
        "profile-email",
        "event-id",
        "request-id",
        "api-response-status",
        "timeline-visibility",
      ]),
    );
  });

  it("uses security containment evidence for API key exposure tickets", async () => {
    const ticket = await loadSeedTicket("TKT-1004");
    const readiness = analyzeEvidenceReadiness({
      ticket,
      outcome: {
        ticketId: "TKT-1004",
        category: "security",
        acceptablePriorities: ["P1"],
        team: "security",
        requiredEscalations: ["security", "missing-information"],
        knowledgeArticleIds: ["security-incident-response"],
      },
    });

    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).toEqual([
      "key-identifier",
      "exposure-location",
      "key-usage-status",
      "rotation-status",
      "audit-source",
      "affected-scope",
    ]);
    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).not.toContain(
      "delivery-id",
    );
    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).not.toContain(
      "catalog-sync-time",
    );
    expect(readiness.providedEvidence.map((requirement) => requirement.id)).toEqual([
      "exposure-location",
    ]);
    expect(readiness.missingEvidence.map((requirement) => requirement.id)).toEqual([
      "key-identifier",
      "key-usage-status",
      "rotation-status",
      "audit-source",
      "affected-scope",
    ]);
  });

  it("keeps unknown private-key facts missing for TKT-1019", async () => {
    const ticket = await loadSeedTicket("TKT-1019");
    const readiness = analyzeEvidenceReadiness({
      ticket,
      outcome: {
        ticketId: "TKT-1019",
        category: "security",
        acceptablePriorities: ["P1"],
        team: "security",
        requiredEscalations: ["security", "missing-information"],
        knowledgeArticleIds: ["security-incident-response"],
      },
    });

    expect(readiness.providedEvidence).toEqual([]);
    expect(readiness.missingEvidence.map((requirement) => requirement.id)).toEqual([
      "key-identifier",
      "exposure-location",
      "key-usage-status",
      "rotation-status",
      "audit-source",
      "affected-scope",
    ]);
  });

  it("credits a blank-page follow-up as a concrete vague-ticket problem summary", async () => {
    const ticket = TicketSchema.parse({
      ...(await loadSeedTicket("TKT-1010")),
      description:
        "It does not work. Customer reply: I was trying to open the campaign editor, but the page stayed blank. The steps were: I opened the campaign and clicked Edit.",
    });
    const readiness = analyzeEvidenceReadiness({
      ticket,
      outcome: {
        ticketId: "TKT-1010",
        category: "other",
        acceptablePriorities: ["P3"],
        team: "support",
        requiredEscalations: [],
        knowledgeArticleIds: [],
      },
    });

    expect(readiness.providedEvidence.map((requirement) => requirement.id)).toEqual(
      expect.arrayContaining(["problem-summary", "reproduction-steps"]),
    );
    expect(readiness.missingEvidence.map((requirement) => requirement.id)).toEqual([
      "screenshot-or-error",
    ]);
  });

  it("uses app-loading evidence after campaign editor blank-page context", async () => {
    const ticket = TicketSchema.parse({
      ...(await loadSeedTicket("TKT-1010")),
      description:
        "It does not work.\n\nCustomer follow-up:\nI was trying to open the campaign editor, but the page stayed blank. The steps were: I opened the campaign, clicked Edit, and then the page stayed blank.",
    });
    const readiness = analyzeEvidenceReadiness({
      ticket,
      outcome: {
        ticketId: "TKT-1010",
        category: "performance",
        acceptablePriorities: ["P3"],
        team: "product",
        requiredEscalations: [],
        knowledgeArticleIds: ["campaign-send-failures"],
      },
    });

    expect(readiness.providedEvidence.map((requirement) => requirement.id)).toEqual(
      expect.arrayContaining(["problem-summary", "reproduction-steps"]),
    );
    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).toEqual([
      "campaign-name",
      "failure-timestamp",
      "browser-session-details",
      "affected-scope",
      "problem-summary",
      "reproduction-steps",
    ]);
    expect(readiness.missingEvidence.map((requirement) => requirement.id)).not.toContain(
      "screenshot-or-error",
    );
  });

  it("credits negative post-exposure usage as security evidence", async () => {
    const ticket = TicketSchema.parse({
      ...(await loadSeedTicket("TKT-1004")),
      description:
        "A private API key may have been pasted into a shared integration log bundle. We do not know whether it was used or which profiles were accessed. Customer reply: The key identifier ends in 4f8a; I am not sending the secret value. I cannot see any post-exposure key usage in the audit view.",
    });
    const readiness = analyzeEvidenceReadiness({
      ticket,
      outcome: {
        ticketId: "TKT-1004",
        category: "security",
        acceptablePriorities: ["P1"],
        team: "security",
        requiredEscalations: ["security", "missing-information"],
        knowledgeArticleIds: ["security-incident-response"],
      },
    });

    expect(readiness.providedEvidence.map((requirement) => requirement.id)).toEqual(
      expect.arrayContaining(["key-identifier", "key-usage-status"]),
    );
    expect(readiness.missingEvidence.map((requirement) => requirement.id)).not.toContain(
      "key-usage-status",
    );
  });

  it("uses catalog sync evidence without coupon-pool evidence for product catalog delays", async () => {
    const ticket = await loadSeedTicket("TKT-1020");
    const readiness = analyzeEvidenceReadiness({
      ticket,
      outcome: {
        ticketId: "TKT-1020",
        category: "performance",
        acceptablePriorities: ["P3"],
        team: "product",
        requiredEscalations: [],
        knowledgeArticleIds: ["shopify-integration-sync", "coupon-catalog-sync"],
      },
    });

    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).toEqual([
      "store-url",
      "object-id",
      "catalog-sync-time",
      "product-reference",
    ]);
    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).not.toContain(
      "coupon-pool-name",
    );
    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).not.toContain(
      "unused-coupon-status",
    );
  });

  it.each([
    {
      name: "generic API reference issues",
      ticket: {
        subject: "API endpoint returns an unexpected response",
        description:
          "The endpoint returns a response we cannot map to the order we sent.",
      },
      outcome: {
        category: "api",
        team: "api-platform",
        knowledgeArticleIds: ["api-reference"],
      },
      evidenceIds: [
        "endpoint-url",
        "request-id",
        "api-response-status",
        "sample-payload",
        "failure-timestamp",
      ],
    },
    {
      name: "billing and invoice issues",
      ticket: {
        subject: "Invoice charge looks wrong",
        description:
          "The invoice includes a charge we do not understand for our current plan.",
      },
      outcome: {
        category: "billing",
        team: "billing",
        knowledgeArticleIds: ["billing-and-invoices"],
      },
      evidenceIds: [
        "invoice-number",
        "billing-account",
        "plan-or-promotion",
        "failure-timestamp",
        "error-banner",
      ],
    },
    {
      name: "account access issues",
      ticket: {
        subject: "Cannot access campaign reports",
        description:
          "The user cannot access campaign reports even though they should have the right role.",
      },
      outcome: {
        category: "account-access",
        team: "identity",
        knowledgeArticleIds: ["account-access"],
      },
      evidenceIds: [
        "profile-email",
        "object-id",
        "error-banner",
        "failure-timestamp",
        "browser-session-details",
      ],
    },
    {
      name: "authentication issues",
      ticket: {
        subject: "Two-factor authentication blocks sign in",
        description:
          "The user cannot sign in after two-factor authentication prompts.",
      },
      outcome: {
        category: "authentication",
        team: "identity",
        knowledgeArticleIds: ["authentication"],
      },
      evidenceIds: [
        "profile-email",
        "error-banner",
        "failure-timestamp",
        "browser-session-details",
      ],
    },
    {
      name: "product feedback",
      ticket: {
        subject: "Feature request for reusable approval workflows",
        description:
          "We would like reusable approval workflows for campaign launches.",
      },
      outcome: {
        category: "feature-request",
        team: "product",
        knowledgeArticleIds: ["product-feedback"],
      },
      evidenceIds: [
        "feature-description",
        "use-case",
        "affected-scope",
      ],
    },
  ] as const)("uses practical evidence requirements for $name", ({ ticket, outcome, evidenceIds }) => {
    const parsedTicket = TicketSchema.parse({
      id: "TKT-9998",
      createdAt: "2026-06-10T09:00:00.000Z",
      updatedAt: "2026-06-10T09:00:00.000Z",
      customer: {
        name: "Demo Customer",
        plan: "business",
        region: "us-east",
        vip: false,
      },
      requester: {
        name: "Maya Chen",
        role: "Ecommerce Manager",
        department: "Marketing",
        technicalLevel: "technical",
        seniority: "manager",
      },
      status: "triage",
      priority: "P3",
      tags: [],
      sla: {
        responseDueAt: "2026-06-10T12:00:00.000Z",
        breached: false,
      },
      relatedTicketIds: [],
      revision: 1,
      ...ticket,
      category: outcome.category,
      team: outcome.team,
    });
    const readiness = analyzeEvidenceReadiness({
      ticket: parsedTicket,
      outcome: {
        ticketId: parsedTicket.id,
        acceptablePriorities: ["P3"],
        requiredEscalations: [],
        ...outcome,
        knowledgeArticleIds: [...outcome.knowledgeArticleIds],
      },
    });

    expect(readiness.requiredEvidence.map((requirement) => requirement.id)).toEqual(
      evidenceIds,
    );
    expect(readiness.missingEvidence.length).toBeGreaterThan(0);
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
