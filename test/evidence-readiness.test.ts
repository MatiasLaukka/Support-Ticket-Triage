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
