import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TicketSchema, type Ticket } from "../src/domain.js";
import {
  buildApprovalDeskRecommendationInput,
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
      category: "authentication",
      team: "identity",
      knowledgeArticleIds: ["account-access", "triage-policy"],
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
      category: "authentication",
      priority: "P2",
      team: "identity",
      knowledgeArticleIds: ["account-access", "triage-policy"],
      actor: "approval-desk",
    });
    expect(input.tags).toContain("prompt-injection");
    expect(input.rationale).toContain("TKT-1005");
    expect(input.draftCustomerResponse).toContain("investigating");
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
        team: "identity",
        requiredEscalations: [],
        knowledgeArticleIds: ["account-access"],
      },
      {
        ticketId: "TKT-1005",
        category: "billing",
        acceptablePriorities: ["P3"],
        team: "billing",
        requiredEscalations: [],
        knowledgeArticleIds: ["billing-refunds"],
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
