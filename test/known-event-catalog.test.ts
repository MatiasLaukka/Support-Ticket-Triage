import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TicketSchema, type Ticket } from "../src/domain.js";
import { detectKnownEvent } from "../src/approval-desk/known-event-catalog.js";

describe("known event catalog", () => {
  it("links in-window webhook latency tickets to the same active event", async () => {
    const first = await loadSeedTicket("TKT-1028");
    const second = await loadSeedTicket("TKT-1029");

    const firstMatch = detectKnownEvent({
      ticket: first,
      knownCause: "webhook-delivery-latency",
    });
    const secondMatch = detectKnownEvent({
      ticket: second,
      knownCause: "webhook-delivery-latency",
    });

    expect(firstMatch).toMatchObject({
      eventId: "EVT-2026-06-10-WEBHOOK-LATENCY",
      status: "active",
      relatedKnownCauseId: "webhook-delivery-latency",
    });
    expect(secondMatch?.eventId).toBe(firstMatch?.eventId);
    expect(firstMatch?.matchReasons).toEqual(
      expect.arrayContaining(["service", "symptom", "time-window"]),
    );
  });

  it("does not link an out-of-window ticket or a ruled-out cause", async () => {
    const ticket = await loadSeedTicket("TKT-1028");

    expect(
      detectKnownEvent({
        ticket: { ...ticket, createdAt: "2026-06-11T06:35:00.000Z" },
        knownCause: "webhook-delivery-latency",
      }),
    ).toBeUndefined();
    expect(
      detectKnownEvent({
        ticket,
        knownCause: "webhook-secret-rotation",
      }),
    ).toBeUndefined();
  });
});

async function loadSeedTicket(ticketId: string): Promise<Ticket> {
  const tickets = JSON.parse(
    await readFile(resolve("data/seed/tickets.json"), "utf8"),
  ) as unknown[];
  const ticket = tickets.find(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { id?: unknown }).id === ticketId,
  );
  return TicketSchema.parse(ticket);
}
