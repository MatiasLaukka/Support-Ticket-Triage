import { describe, expect, it } from "vitest";
import {
  AuditEventSchema,
  RecommendationSchema,
  type AuditEvent,
  type Ticket,
  type TriageRecommendation,
} from "../src/domain.js";
import { buildConversationTimeline } from "../src/approval-desk/conversation-history.js";

const ticket = {
  id: "TKT-1001",
  revision: 0,
  customer: {
    name: "Northstar Apparel",
    plan: "enterprise",
    region: "eu-west",
    vip: false,
  },
  requester: {
    name: "Maya Chen",
    role: "Ecommerce Manager",
    department: "Marketing",
    technicalLevel: "technical",
    seniority: "manager",
  },
  subject: "Checkout events missing",
  description: "Checkout Started events are delayed.",
  status: "triage",
  category: "incident",
  priority: "P1",
  team: "incident-response",
  tags: ["events"],
  relatedTicketIds: [],
  sla: {
    responseDueAt: "2026-06-10T10:00:00.000Z",
    breached: false,
  },
  createdAt: "2026-06-10T09:00:00.000Z",
  updatedAt: "2026-06-10T09:00:00.000Z",
} satisfies Ticket;

const recommendation = {
  id: "11111111-1111-4111-8111-111111111111",
  ticketId: "TKT-1001",
  sourceRevision: 0,
  category: "incident",
  priority: "P1",
  team: "incident-response",
  duplicateCandidates: [],
  outageRisk: "likely",
  securityRisk: "none",
  slaRisk: "likely",
  missingInformation: [],
  knowledgeArticleIds: ["event-tracking-debugging"],
  draftCustomerResponse: "Hi Northstar Apparel,\n\nWe are investigating the delay.",
  rationale: "Incident routing.",
  confidence: 0.95,
  recommendedNextAction: "Monitor platform delay.",
  escalationRequired: true,
  escalationReasons: ["outage"],
  resolution: "approved",
  createdAt: "2026-06-10T09:05:00.000Z",
} satisfies TriageRecommendation;

describe("conversation timeline", () => {
  it("supports sent, reply, and superseded audit actions", () => {
    expect(
      AuditEventSchema.parse({
        id: "22222222-2222-4222-8222-222222222222",
        timestamp: "2026-06-10T09:10:00.000Z",
        actor: "approval-desk",
        action: "customer-response-sent",
        ticketId: "TKT-1001",
        recommendationId: recommendation.id,
        before: {},
        after: {
          sentAt: "2026-06-10T09:10:00.000Z",
          customerResponse: recommendation.draftCustomerResponse,
        },
        rationale: "Approved response sent to customer.",
        knowledgeArticleIds: ["event-tracking-debugging"],
        result: "success",
      }),
    ).toMatchObject({ action: "customer-response-sent" });

    expect(
      AuditEventSchema.parse({
        id: "33333333-3333-4333-8333-333333333333",
        timestamp: "2026-06-10T09:15:00.000Z",
        actor: "Maya Chen",
        action: "customer-reply-received",
        ticketId: "TKT-1001",
        before: {},
        after: { body: "The API accepted the events but they are still missing." },
        rationale: "Customer reply added to ticket conversation.",
        knowledgeArticleIds: [],
        result: "success",
      }),
    ).toMatchObject({ action: "customer-reply-received" });

    expect(
      AuditEventSchema.parse({
        id: "44444444-4444-4444-8444-444444444444",
        timestamp: "2026-06-10T09:20:00.000Z",
        actor: "approval-desk",
        action: "recommendation-superseded",
        ticketId: "TKT-1001",
        recommendationId: recommendation.id,
        before: {},
        after: {},
        rationale: "A newer recommendation replaced this version.",
        knowledgeArticleIds: [],
        result: "success",
      }),
    ).toMatchObject({ action: "recommendation-superseded" });

    expect(
      RecommendationSchema.parse({
        ...recommendation,
        resolution: "superseded",
      }),
    ).toMatchObject({ resolution: "superseded" });
  });

  it("keeps original ticket, recommendation version, sent response, and customer reply visible", () => {
    const audits: AuditEvent[] = [
      {
        id: "22222222-2222-4222-8222-222222222222",
        timestamp: "2026-06-10T09:10:00.000Z",
        actor: "approval-desk",
        action: "customer-response-sent",
        ticketId: "TKT-1001",
        recommendationId: recommendation.id,
        before: {},
        after: {
          sentAt: "2026-06-10T09:10:00.000Z",
          customerResponse: recommendation.draftCustomerResponse,
        },
        rationale: "Approved response sent to customer.",
        knowledgeArticleIds: ["event-tracking-debugging"],
        result: "success",
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        timestamp: "2026-06-10T09:15:00.000Z",
        actor: "Maya Chen",
        action: "customer-reply-received",
        ticketId: "TKT-1001",
        before: {},
        after: {
          body: "The API accepted the events but they are still missing.",
          source: "demo-scenario",
        },
        rationale: "Customer reply added to ticket conversation.",
        knowledgeArticleIds: [],
        result: "success",
      },
    ];

    const timeline = buildConversationTimeline({
      ticket,
      audits,
      recommendations: [recommendation],
    });

    expect(timeline.map((item) => item.kind)).toEqual([
      "original-ticket",
      "recommendation-event",
      "support-response-sent",
      "customer-reply",
    ]);
    expect(timeline[0]).toMatchObject({
      kind: "original-ticket",
      body: "Checkout Started events are delayed.",
    });
    expect(timeline[1]).toMatchObject({
      kind: "recommendation-event",
      action: "recommendation-submitted",
      recommendationId: recommendation.id,
      summary: "Recommendation version is approved.",
    });
    expect(timeline[2]).toMatchObject({
      kind: "support-response-sent",
      body: recommendation.draftCustomerResponse,
    });
    expect(timeline[3]).toMatchObject({
      kind: "customer-reply",
      actor: "Maya Chen",
      body: "The API accepted the events but they are still missing.",
    });
  });

  it("keeps malformed sent and reply audit payloads as recommendation events", () => {
    const timeline = buildConversationTimeline({
      ticket,
      recommendations: [],
      audits: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          timestamp: "2026-06-10T09:10:00.000Z",
          actor: "approval-desk",
          action: "customer-response-sent",
          ticketId: "TKT-1001",
          before: {},
          after: {},
          rationale: "Response payload was unavailable.",
          knowledgeArticleIds: [],
          result: "success",
        },
        {
          id: "55555555-5555-4555-8555-555555555555",
          timestamp: "2026-06-10T09:15:00.000Z",
          actor: "Maya Chen",
          action: "customer-reply-received",
          ticketId: "TKT-1001",
          before: {},
          after: { source: "demo-scenario" },
          rationale: "Reply payload was unavailable.",
          knowledgeArticleIds: [],
          result: "success",
        },
      ],
    });

    expect(timeline.slice(1)).toMatchObject([
      {
        kind: "recommendation-event",
        action: "customer-response-sent",
        summary: "Approved customer response was sent.",
      },
      {
        kind: "recommendation-event",
        action: "customer-reply-received",
        summary: "Customer reply was added to the ticket conversation.",
      },
    ]);
  });

  it("keeps the original ticket first and preserves source order for timestamp ties", () => {
    const sameTimestamp = ticket.createdAt;
    const timeline = buildConversationTimeline({
      ticket,
      audits: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          timestamp: sameTimestamp,
          actor: "Maya Chen",
          action: "customer-reply-received",
          ticketId: "TKT-1001",
          before: {},
          after: { body: "Please keep us updated." },
          rationale: "Customer reply added to ticket conversation.",
          knowledgeArticleIds: [],
          result: "success",
        },
      ],
      recommendations: [{ ...recommendation, createdAt: sameTimestamp }],
    });

    expect(timeline.map((item) => item.kind)).toEqual([
      "original-ticket",
      "customer-reply",
      "recommendation-event",
    ]);
  });
});
