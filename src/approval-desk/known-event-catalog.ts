import type { Ticket } from "../domain.js";

export type KnownEventStatus = "investigating" | "active" | "resolved";

export interface KnownEventMatch {
  eventId: string;
  label: string;
  status: KnownEventStatus;
  relatedKnownCauseId: string;
  customerSafeSummary: string;
  operatorSummary: string;
  matchReasons: string[];
}

export interface KnownEventDefinition {
  id: string;
  label: string;
  status: KnownEventStatus;
  startsAt: string;
  endsAt: string;
  relatedKnownCauseId: string;
  servicePattern: RegExp;
  symptomPattern: RegExp;
  customerSafeSummary: string;
  operatorSummary: string;
}

export const KNOWN_EVENTS: readonly KnownEventDefinition[] = [
  {
    id: "EVT-2026-06-10-WEBHOOK-LATENCY",
    label: "Webhook delivery latency incident",
    status: "active",
    startsAt: "2026-06-10T06:00:00.000Z",
    endsAt: "2026-06-10T08:00:00.000Z",
    relatedKnownCauseId: "webhook-delivery-latency",
    servicePattern: /\bwebhooks?\b/i,
    symptomPattern: /\b(?:delayed|delay|latency|lag|late)\b/i,
    customerSafeSummary:
      "We are tracking a platform-side delay affecting webhook delivery during the reported time window.",
    operatorSummary:
      "The ticket matches the active webhook delivery-latency event by service, symptom, and creation window.",
  },
  {
    id: "EVT-2026-06-10-SMS-CONSENT-SYNC",
    label: "SMS consent synchronization incident",
    status: "resolved",
    startsAt: "2026-06-10T06:00:00.000Z",
    endsAt: "2026-06-10T07:00:00.000Z",
    relatedKnownCauseId: "sms-stop-sync-delay",
    servicePattern: /\bsms\b/i,
    symptomPattern: /\b(?:stop|opt-out|eligible|not reflected|delay(?:ed)?)\b/i,
    customerSafeSummary:
      "The reported SMS consent delay matches a resolved synchronization incident in the reported time window.",
    operatorSummary:
      "The ticket matches the resolved SMS consent-sync event by service, symptom, and creation window.",
  },
  {
    id: "EVT-2026-06-10-WEBHOOK-LATENCY-INVESTIGATION",
    label: "Webhook delivery latency investigation",
    status: "investigating",
    startsAt: "2026-06-10T08:00:00.000Z",
    endsAt: "2026-06-10T09:00:00.000Z",
    relatedKnownCauseId: "webhook-delivery-latency",
    servicePattern: /\bwebhooks?\b/i,
    symptomPattern: /\b(?:delayed|delay|latency|lag|late)\b/i,
    customerSafeSummary:
      "We are investigating a possible platform-side delay affecting webhook delivery during the reported time window.",
    operatorSummary:
      "The ticket matches an investigating webhook event, but the event is not yet confirmed for customer-facing diagnosis.",
  },
];

export function detectKnownEvent(input: {
  ticket: Ticket;
  content?: string;
  knownCause?: string | null;
}): KnownEventMatch | undefined {
  const text = (input.content ?? ticketText(input.ticket)).toLowerCase();
  const createdAt = new Date(input.ticket.createdAt).getTime();

  return KNOWN_EVENTS.map((event) => {
    const reasons: string[] = [];
    if (input.knownCause !== event.relatedKnownCauseId) {
      return undefined;
    }
    reasons.push("known-cause");
    if (!event.servicePattern.test(text)) {
      return undefined;
    }
    reasons.push("service");
    if (!event.symptomPattern.test(text)) {
      return undefined;
    }
    reasons.push("symptom");
    const startsAt = new Date(event.startsAt).getTime();
    const endsAt = new Date(event.endsAt).getTime();
    if (createdAt < startsAt || createdAt >= endsAt) {
      return undefined;
    }
    reasons.push("time-window");
    return {
      eventId: event.id,
      label: event.label,
      status: event.status,
      relatedKnownCauseId: event.relatedKnownCauseId,
      customerSafeSummary: event.customerSafeSummary,
      operatorSummary: event.operatorSummary,
      matchReasons: reasons,
    } satisfies KnownEventMatch;
  }).find((match): match is KnownEventMatch => match !== undefined);
}

export function getKnownEvent(
  eventId: string | null | undefined,
): KnownEventDefinition | undefined {
  if (eventId === undefined || eventId === null) {
    return undefined;
  }
  return KNOWN_EVENTS.find((event) => event.id === eventId);
}

function ticketText(ticket: Ticket): string {
  return [
    ticket.subject,
    ticket.description,
    ticket.category,
    ticket.priority,
    ticket.team,
    ...ticket.tags,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ");
}
