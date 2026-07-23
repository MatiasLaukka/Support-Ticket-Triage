import { describe, expect, it } from "vitest";
import {
  AuditEventSchema,
  TicketSchema,
  TriageRecommendationSchema,
} from "../src/domain.js";
import { diagnosisContextForTicket } from "../src/approval-desk/diagnostic-workflow.js";

const ticket = TicketSchema.parse({
  id: "TKT-1010",
  createdAt: "2026-06-10T08:25:00.000Z",
  updatedAt: "2026-06-10T08:30:00.000Z",
  customer: {
    name: "Maple Studio",
    plan: "starter",
    region: "us-west",
    vip: false,
  },
  subject: "Campaign editor is blank",
  description: "The campaign editor stays blank after opening a campaign.",
  status: "in-progress",
  category: "performance",
  priority: "P3",
  team: "product",
  tags: ["performance"],
  sla: {
    responseDueAt: "2026-06-10T12:00:00.000Z",
    breached: false,
  },
  relatedTicketIds: [],
  revision: 2,
});

const recommendation = TriageRecommendationSchema.parse({
  id: "10000000-0000-4000-8000-000000000010",
  ticketId: "TKT-1010",
  sourceRevision: 2,
  category: "performance",
  priority: "P3",
  team: "product",
  tags: ["performance"],
  duplicateCandidates: [],
  outageRisk: "none",
  securityRisk: "none",
  slaRisk: "none",
  missingInformation: [],
  supportState: "diagnosing",
  requiredEvidence: [],
  providedEvidence: [],
  missingEvidence: [],
  knowledgeArticleIds: ["performance-troubleshooting"],
  draftCustomerResponse: "We are investigating the campaign editor.",
  rationale: "The campaign editor symptoms match the performance playbook.",
  confidence: 0.9,
  recommendedNextAction: "Record the diagnosis after the approved response.",
  escalationRequired: false,
  escalationReasons: [],
  resolution: "approved",
  createdAt: "2026-06-10T09:00:00.000Z",
});

let nextAuditId = 1;

function auditId(prefix: string): string {
  return `${prefix}-0000-4000-8000-${String(nextAuditId++).padStart(12, "0")}`;
}

function diagnosisAudit(
  timestamp: string,
  diagnosticState: Record<string, unknown>,
) {
  return AuditEventSchema.parse({
    id: auditId("20000000"),
    timestamp,
    actor: "product-support",
    action: "diagnosis-completed",
    ticketId: ticket.id,
    before: {},
    after: {
      diagnosis: {
        status: "completed",
        causeType: "performance",
        customerSafeSummary: "The campaign editor remains ambiguous.",
        evidenceUsed: ["blank editor"],
        confidence: "likely",
        owner: "engineering",
        recommendedNextAction: "Collect discriminating browser evidence.",
        doNotSay: ["Do not claim a final root cause."],
        diagnosticState,
      },
    },
    rationale: "Persisted diagnostic context for the next evaluation.",
    knowledgeArticleIds: ["performance-troubleshooting"],
    result: "success",
  });
}

function customerReply(timestamp: string, body: string) {
  return AuditEventSchema.parse({
    id: auditId("30000000"),
    timestamp,
    actor: "Jamie Lee",
    action: "customer-reply-received",
    ticketId: ticket.id,
    before: {},
    after: { body },
    rationale: "Customer supplied diagnostic follow-up evidence.",
    knowledgeArticleIds: [],
    result: "success",
  });
}

const ambiguousState = {
  state: "ambiguous",
  diagnosticAttempts: 0,
  hypotheses: [
    {
      id: "browser-session",
      label: "Browser/session issue",
      status: "plausible",
      evidenceUsed: ["blank editor"],
      evidenceToConfirm: ["Private window works"],
    },
    {
      id: "frontend-loading",
      label: "Frontend loading issue",
      status: "plausible",
      evidenceUsed: ["blank editor"],
      evidenceToConfirm: ["Console error persists"],
    },
  ],
  evidenceToRequest: ["Try a private or incognito window."],
};

describe("diagnosisContextForTicket", () => {
  it("projects an active known event into the existing platform-delay diagnosis", () => {
    const eventTicket = TicketSchema.parse({
      ...ticket,
      id: "TKT-1028",
      createdAt: "2026-06-10T06:35:00.000Z",
      updatedAt: "2026-06-10T07:45:00.000Z",
      subject: "Webhook deliveries delayed by ten minutes",
      description: "Order webhooks arrive late after the source event.",
      category: "integration",
      priority: "P2",
      team: "integrations",
      tags: ["webhook", "delivery", "latency"],
      sla: { ...ticket.sla, responseDueAt: "2026-06-10T11:50:00.000Z" },
    });
    const eventRecommendation = TriageRecommendationSchema.parse({
      ...recommendation,
      ticketId: "TKT-1028",
      supportState: "known-cause",
      knownCause: "webhook-delivery-latency",
      knownEventId: "EVT-2026-06-10-WEBHOOK-LATENCY",
      knownEventMatchReasons: ["known-cause", "service", "symptom", "time-window"],
      category: "integration",
      priority: "P2",
      team: "integrations",
      knowledgeArticleIds: ["webhook-signature-validation"],
    });

    expect(diagnosisContextForTicket(eventTicket, eventRecommendation)).toMatchObject({
      causeType: "platform-delay",
      confidence: "likely",
      owner: "engineering",
      knownEventId: "EVT-2026-06-10-WEBHOOK-LATENCY",
      knownEventMatchReasons: expect.arrayContaining(["time-window"]),
    });
  });

  it("uses a resolved known event as confirmed known-cause guidance", () => {
    const eventTicket = TicketSchema.parse({
      ...ticket,
      id: "TKT-1030",
      createdAt: "2026-06-10T06:15:00.000Z",
      updatedAt: "2026-06-10T07:25:00.000Z",
      subject: "SMS opt-out not reflected on profile",
      description: "A subscriber replied STOP but remains eligible.",
      category: "api",
      priority: "P3",
      team: "api-platform",
      tags: ["sms", "opt-out", "consent"],
      sla: { ...ticket.sla, responseDueAt: "2026-06-10T13:40:00.000Z" },
    });
    const eventRecommendation = TriageRecommendationSchema.parse({
      ...recommendation,
      ticketId: "TKT-1030",
      supportState: "known-cause",
      knownCause: "sms-stop-sync-delay",
      knownEventId: "EVT-2026-06-10-SMS-CONSENT-SYNC",
      category: "api",
      priority: "P3",
      team: "api-platform",
      knowledgeArticleIds: ["sms-compliance", "profile-sync-issues"],
    });

    expect(diagnosisContextForTicket(eventTicket, eventRecommendation)).toMatchObject({
      confidence: "confirmed",
      customerSafeSummary: expect.stringContaining("consent-state sync issue"),
    });
  });

  it("escalates after two persisted non-discriminating diagnostic cycles", () => {
    const first = diagnosisAudit("2026-06-10T09:02:00.000Z", ambiguousState);
    const firstReply = customerReply(
      "2026-06-10T09:03:00.000Z",
      "The editor is still blank, and I did not get a new result.",
    );
    const second = diagnosisAudit("2026-06-10T09:04:00.000Z", {
      ...ambiguousState,
      diagnosticAttempts: 1,
    });
    const secondReply = customerReply(
      "2026-06-10T09:05:00.000Z",
      "It is still blank, with no new browser or console evidence.",
    );

    const diagnosis = diagnosisContextForTicket(ticket, recommendation, [
      first,
      firstReply,
      second,
      secondReply,
    ]);

    expect(diagnosis).toMatchObject({
      confidence: "likely",
      diagnosticState: {
        state: "escalated",
        escalationReason: "diagnostic-ambiguity",
        specialistTeam: "product",
        diagnosticAttempts: 2,
      },
    });
  });

  it("confirms the browser-session hypothesis when a discriminating reply arrives", () => {
    const diagnosis = diagnosisContextForTicket(ticket, recommendation, [
      diagnosisAudit("2026-06-10T09:02:00.000Z", ambiguousState),
      customerReply(
        "2026-06-10T09:03:00.000Z",
        "The campaign editor works in a private window.",
      ),
    ]);

    expect(diagnosis).toMatchObject({
      confidence: "confirmed",
      diagnosticState: {
        state: "confirmed",
        hypotheses: expect.arrayContaining([
          expect.objectContaining({ id: "browser-session", status: "confirmed" }),
          expect.objectContaining({ id: "frontend-loading", status: "ruled-out" }),
        ]),
      },
    });
  });
});
