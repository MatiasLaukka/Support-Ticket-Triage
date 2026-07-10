import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  TicketSchema,
  type DuplicateCandidate,
  type Ticket,
} from "../src/domain.js";
import {
  findSimilarTickets,
  jaccardSimilarity,
  normalizeTokens,
} from "../src/similarity.js";

async function loadTickets(): Promise<Ticket[]> {
  return TicketSchema.array().parse(
    JSON.parse(await readFile("data/seed/tickets.json", "utf8")),
  );
}

describe("ticket similarity", () => {
  it("normalizes lowercase alphanumeric tokens and removes fixed stop words", () => {
    expect(normalizeTokens("The WEBHOOK's signature, and API-503!")).toEqual(
      new Set(["webhook", "s", "signature", "api", "503"]),
    );
  });

  it("computes Jaccard similarity", () => {
    expect(
      jaccardSimilarity(
        new Set(["webhook", "signature", "rotation"]),
        new Set(["webhook", "signature", "hmac"]),
      ),
    ).toBeCloseTo(0.5);
  });

  it("ranks webhook and outage duplicates together without unrelated billing", async () => {
    const tickets = await loadTickets();

    const webhook = findSimilarTickets(
      tickets.find(({ id }) => id === "TKT-1007")!,
      tickets,
    );
    const outage = findSimilarTickets(
      tickets.find(({ id }) => id === "TKT-1001")!,
      tickets,
    );
    const delayedTimeline = findSimilarTickets(
      tickets.find(({ id }) => id === "TKT-1002")!,
      tickets,
    );

    expect(webhook[0]?.ticketId).toBe("TKT-1008");
    expect(
      webhook.some(
        ({ ticketId }: DuplicateCandidate) => ticketId === "TKT-1011",
      ),
    ).toBe(false);
    expect(
      outage
        .slice(0, 2)
        .map(({ ticketId }: DuplicateCandidate) => ticketId),
    ).toEqual(expect.arrayContaining(["TKT-1002", "TKT-1003"]));
    expect(
      delayedTimeline.some(
        ({ ticketId }: DuplicateCandidate) => ticketId === "TKT-1003",
      ),
    ).toBe(true);
  });

  it("excludes the source, filters scores at or below 0.2, caps at five, and breaks ties by ticket ID", () => {
    const source = makeTicket("TKT-1001", "shared alpha");
    const tickets = [
      source,
      makeTicket("TKT-1007", "shared alpha seven"),
      makeTicket("TKT-1006", "shared alpha six"),
      makeTicket("TKT-1005", "shared alpha five"),
      makeTicket("TKT-1004", "shared alpha four"),
      makeTicket("TKT-1003", "shared alpha three"),
      makeTicket("TKT-1002", "shared alpha two"),
      makeTicket("TKT-1008", "shared unrelated one two three four five six"),
    ];

    expect(
      findSimilarTickets(source, tickets).map(
        ({ ticketId }: DuplicateCandidate) => ticketId,
      ),
    ).toEqual(["TKT-1002", "TKT-1003", "TKT-1004", "TKT-1005", "TKT-1006"]);
  });
});

function makeTicket(id: Ticket["id"], text: string): Ticket {
  return TicketSchema.parse({
    id,
    createdAt: "2026-06-10T08:00:00.000Z",
    updatedAt: "2026-06-10T08:00:00.000Z",
    customer: {
      name: "Example",
      plan: "starter",
      region: "eu-west",
      vip: false,
    },
    subject: text,
    description: text,
    status: "triage",
    tags: [],
    sla: {
      responseDueAt: "2026-06-10T12:00:00.000Z",
      breached: false,
    },
    revision: 0,
  });
}
