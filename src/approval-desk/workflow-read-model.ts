import type { AuditEvent, Ticket, TriageRecommendation } from "../domain.js";
import {
  buildConversationHistory,
  buildConversationTimeline,
} from "./conversation-history.js";
import { buildOperatorGuidance } from "./workflow-guidance.js";

export type RecommendationWorkflowState =
  | "active"
  | "draft-ready"
  | "waiting"
  | "customer-replied"
  | "resolved";

export interface CustomerReplyContext {
  id: string;
  ticketId: string;
  createdAt: string;
  body: string;
}

export interface PreviousSupportResponseContext {
  sentAt: string;
  body: string;
}

export function buildTicketWorkflowReadModel(input: {
  ticket: Ticket;
  recommendations: readonly TriageRecommendation[];
  audits: readonly AuditEvent[];
}) {
  const recommendation = summarizeRecommendationsForTicket(
    input.ticket,
    input.recommendations,
    input.audits,
  );
  return {
    ticket: input.ticket,
    conversationHistory: buildConversationHistory(input.audits),
    conversationTimeline: buildConversationTimeline({
      ticket: input.ticket,
      audits: input.audits,
      recommendations: recommendation.history,
    }),
    recommendationHistory: recommendation.history,
    recommendationSummary: recommendation.summary,
    latestRecommendation: recommendation.latest,
    operatorGuidance: buildOperatorGuidance(input),
  };
}

export function summarizeRecommendationsForTicket(
  ticket: Ticket,
  recommendations: readonly TriageRecommendation[],
  audits: readonly AuditEvent[],
): {
  summary: {
    latestRecommendationId?: string;
    latestResolution?: TriageRecommendation["resolution"];
    hasPendingRecommendation: boolean;
    hasApprovedRecommendation: boolean;
    workflowState: RecommendationWorkflowState;
    outageRisk?: TriageRecommendation["outageRisk"];
    securityRisk?: TriageRecommendation["securityRisk"];
    slaRisk?: TriageRecommendation["slaRisk"];
    priority?: TriageRecommendation["priority"];
    hasSentResponse: boolean;
    hasCustomerReply: boolean;
    latestSentAt?: string;
    latestCustomerReplyAt?: string;
  };
  latest?: TriageRecommendation;
  history: TriageRecommendation[];
} {
  const related = recommendations
    .filter((recommendation) => recommendation.ticketId === ticket.id)
    .sort(compareRecommendationsNewestFirst(audits));
  const currentRelated = related.filter((recommendation) =>
    ["pending", "approved"].includes(recommendation.resolution),
  );
  const latest = currentRelated[0];
  const ticketAudits = audits.filter((event) => event.ticketId === ticket.id);
  const latestSentAt = latestAuditTimestamp(
    ticketAudits,
    "customer-response-sent",
  );
  const latestCustomerReplyAt = latestAuditTimestamp(
    ticketAudits,
    "customer-reply-received",
  );

  return {
    summary: {
      latestRecommendationId: latest?.id,
      latestResolution: latest?.resolution,
      hasPendingRecommendation: currentRelated.some(
        (recommendation) => recommendation.resolution === "pending",
      ),
      hasApprovedRecommendation: currentRelated.some(
        (recommendation) => recommendation.resolution === "approved",
      ),
      workflowState: conversationWorkflowState({
        ticket,
        latest,
        latestSentAt,
        latestCustomerReplyAt,
      }),
      outageRisk: latest?.outageRisk,
      securityRisk: latest?.securityRisk,
      slaRisk: latest?.slaRisk,
      priority: latest?.priority,
      hasSentResponse: latestSentAt !== undefined,
      hasCustomerReply: latestCustomerReplyAt !== undefined,
      latestSentAt,
      latestCustomerReplyAt,
    },
    latest,
    history: related,
  };
}

export function customerRepliesFromAudits(
  ticketId: string,
  audits: readonly AuditEvent[],
): CustomerReplyContext[] {
  return audits
    .filter(
      (event) =>
        event.ticketId === ticketId &&
        event.action === "customer-reply-received" &&
        typeof event.after.body === "string",
    )
    .map((event) => ({
      id: event.id,
      ticketId,
      createdAt: event.timestamp,
      body: event.after.body as string,
    }));
}

export function latestSupportResponseFromAudits(
  ticketId: string,
  audits: readonly AuditEvent[],
): PreviousSupportResponseContext | undefined {
  return audits
    .filter(
      (event) =>
        event.ticketId === ticketId &&
        event.action === "customer-response-sent" &&
        typeof event.after.customerResponse === "string",
    )
    .map((event) => ({
      sentAt:
        typeof event.after.sentAt === "string"
          ? event.after.sentAt
          : event.timestamp,
      body: event.after.customerResponse as string,
    }))
    .sort((left, right) => right.sentAt.localeCompare(left.sentAt))[0];
}

export function latestSentAtForRecommendation(
  audits: readonly AuditEvent[],
  recommendationId: string,
): string | undefined {
  return audits
    .filter(
      (event) =>
        event.action === "customer-response-sent" &&
        event.recommendationId === recommendationId,
    )
    .map((event) =>
      typeof event.after.sentAt === "string" ? event.after.sentAt : event.timestamp,
    )
    .sort((left, right) => right.localeCompare(left))[0];
}

function latestAuditTimestamp(
  audits: readonly AuditEvent[],
  action: AuditEvent["action"],
): string | undefined {
  return audits
    .filter((event) => event.action === action)
    .map((event) =>
      action === "customer-response-sent" && typeof event.after.sentAt === "string"
        ? event.after.sentAt
        : event.timestamp,
    )
    .sort((left, right) => right.localeCompare(left))[0];
}

function compareRecommendationsNewestFirst(
  audits: readonly AuditEvent[],
): (left: TriageRecommendation, right: TriageRecommendation) => number {
  const submittedOrder = submittedAuditIndexByRecommendation(audits);
  return (left, right) =>
    right.createdAt.localeCompare(left.createdAt) ||
    (submittedOrder.get(right.id) ?? -1) - (submittedOrder.get(left.id) ?? -1) ||
    right.id.localeCompare(left.id);
}

function submittedAuditIndexByRecommendation(
  audits: readonly AuditEvent[],
): Map<string, number> {
  const indexes = new Map<string, number>();
  audits.forEach((event, index) => {
    if (
      event.action === "recommendation-submitted" &&
      event.recommendationId !== undefined
    ) {
      indexes.set(event.recommendationId, index);
    }
  });
  return indexes;
}

function conversationWorkflowState(input: {
  ticket: Ticket;
  latest?: TriageRecommendation;
  latestSentAt?: string;
  latestCustomerReplyAt?: string;
}): RecommendationWorkflowState {
  if (input.ticket.status === "resolved") {
    return "resolved";
  }

  if (
    input.latest?.resolution === "approved" &&
    input.latestSentAt !== undefined &&
    input.latestSentAt >= input.latest.createdAt
  ) {
    return input.latestCustomerReplyAt !== undefined &&
      input.latestCustomerReplyAt > input.latestSentAt
      ? "customer-replied"
      : "waiting";
  }

  if (input.latest !== undefined) {
    return input.latestCustomerReplyAt !== undefined &&
      input.latestCustomerReplyAt > input.latest.createdAt
      ? "customer-replied"
      : "draft-ready";
  }

  if (
    input.latestCustomerReplyAt !== undefined &&
    (input.latestSentAt === undefined ||
      input.latestCustomerReplyAt > input.latestSentAt)
  ) {
    return "customer-replied";
  }

  return input.latestSentAt === undefined ? "active" : "waiting";
}
