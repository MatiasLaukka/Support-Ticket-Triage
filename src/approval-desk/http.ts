import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import {
  ApprovedFieldSchema,
  AiPreferenceSchema,
  AuditEventSchema,
  CategorySchema,
  DraftCustomerResponseStyleInputSchema,
  DraftCustomerResponseStyleSchema,
  PrioritySchema,
  TeamSchema,
  TicketIdSchema,
  TicketStatusSchema,
} from "../domain.js";
import type {
  AuditEvent,
  Ticket,
  TriageRecommendation,
} from "../domain.js";
import { DomainError } from "../errors.js";
import { calculateQueueMetrics } from "../metrics.js";
import type { RuntimeDependencies } from "../runtime.js";
import type { DiagnosisContext, FixContext } from "../triage-service.js";
import {
  loadExpectedOutcomes,
} from "./recommendation-builder.js";
import {
  createCustomerResponseDraftProviderFromEnv,
  type CustomerResponseDraftProvider,
} from "./draft-response-provider.js";
import {
  createClassificationReasoningProviderFromEnv,
  type ClassificationReasoningProvider,
} from "./classification-reasoning-provider.js";
import { evaluateTicketWithAi } from "./ai-evaluation.js";
import { buildAutomationEvidenceReport } from "./evidence-report.js";
import { approvalDeskHtml } from "./ui.js";
import {
  buildConversationHistory,
  buildConversationTimeline,
} from "./conversation-history.js";
import { diagnoseFromPlaybook } from "./diagnostic-playbooks.js";
import { getKnownCause } from "./known-cause-catalog.js";
import { automaticReplyForTicket } from "./automatic-customer-replies.js";

const JSON_BODY_LIMIT_BYTES = 65_536;
const UNEXPECTED_ERROR_TEXT = "Unexpected local approval desk error.";
const markSentOperations = new Map<string, Promise<void>>();

const TicketListQuerySchema = z
  .object({
    status: TicketStatusSchema.optional(),
    category: CategorySchema.optional(),
    priority: PrioritySchema.optional(),
    team: TeamSchema.optional(),
    offset: z.coerce.number().int().nonnegative().default(0),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

const RecommendationIdSchema = z.uuid();
const CustomerReplyBodySchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    createdAt: z.iso.datetime(),
    body: z.string().trim().min(1).max(4_000),
  })
  .strict();
const SubmitBodySchema = z
  .object({
    actor: z.string().trim().min(1).default("approval-desk"),
    responseStyle: DraftCustomerResponseStyleInputSchema.default("auto"),
    aiPreference: AiPreferenceSchema.default("auto"),
    customerReplies: z.array(CustomerReplyBodySchema).max(8).default([]),
  })
  .strict();
const ApprovalBodySchema = z
  .object({
    ticketId: TicketIdSchema,
    expectedRevision: z.number().int().nonnegative(),
    approvedFields: z
      .array(ApprovedFieldSchema)
      .min(1)
      .refine((fields) => new Set(fields).size === fields.length, {
        message: "Approved fields must be unique.",
      }),
    fieldOverrides: z
      .object({
        category: CategorySchema.optional(),
        priority: PrioritySchema.optional(),
        team: TeamSchema.optional(),
        assignee: z.string().trim().min(1).nullable().optional(),
        status: TicketStatusSchema.optional(),
        tags: z.array(z.string().trim().min(1)).optional(),
      })
      .strict()
      .optional(),
    editedCustomerResponse: z.string().trim().min(1).optional(),
    actor: z.string().trim().min(1),
    confirm: z.literal(true),
  })
  .strict()
  .refine(
    (approval) =>
      approval.editedCustomerResponse === undefined ||
      approval.approvedFields.includes("customerResponse"),
    {
      message:
        "editedCustomerResponse requires customerResponse to be approved.",
      path: ["editedCustomerResponse"],
    },
  )
  .refine(
    (approval) =>
      !approval.approvedFields.includes("customerResponse") ||
      approval.editedCustomerResponse !== undefined,
    {
      message:
        "editedCustomerResponse is required when customerResponse is approved.",
      path: ["editedCustomerResponse"],
    },
  )
  .refine(
    (approval) =>
      approval.fieldOverrides === undefined ||
      Object.keys(approval.fieldOverrides).every((field) =>
        approval.approvedFields.includes(
          field as (typeof approval.approvedFields)[number],
        ),
      ),
    {
      message: "Field overrides require the matching field to be approved.",
      path: ["fieldOverrides"],
    },
  );
const RejectBodySchema = z
  .object({
    ticketId: TicketIdSchema,
    actor: z.string().trim().min(1),
    feedback: z.string().trim().min(1),
  })
  .strict();
const CancelApprovalBodySchema = z
  .object({
    ticketId: TicketIdSchema,
    actor: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  })
  .strict();
const CustomerReplyRouteBodySchema = z
  .object({
    actor: z.string().trim().min(1),
    body: z.string().trim().min(1).max(4_000),
    source: z.string().trim().min(1).optional(),
  })
  .strict();
const MarkSentBodySchema = z
  .object({
    ticketId: TicketIdSchema,
    actor: z.string().trim().min(1),
  })
  .strict();
const WorkflowActionBodySchema = z
  .object({
    actor: z.string().trim().min(1),
  })
  .strict();

export interface ApprovalDeskHttpOptions {
  expectedOutcomesPath?: string;
  draftProvider?: CustomerResponseDraftProvider;
  classificationReasoningProvider?: ClassificationReasoningProvider;
}

export function createApprovalDeskHttpServer(
  deps: RuntimeDependencies,
  options: ApprovalDeskHttpOptions = {},
) {
  return createServer((request, response) => {
    void routeRequest(request, response, deps, options);
  });
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: RuntimeDependencies,
  options: ApprovalDeskHttpOptions,
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://approval-desk.local");
    if (request.method === "GET" && url.pathname === "/") {
      text(response, 200, approvalDeskHtml);
      return;
    }

    const route = matchRoute(request.method ?? "", url.pathname);
    if (route === undefined) {
      json(response, 404, {
        error: { code: "NOT_FOUND", message: "Route not found." },
      });
      return;
    }

    const result = await route.handle({ deps, options, request, url });
    json(response, route.status, result);
  } catch (error) {
    handleError(response, error);
  }
}

function matchRoute(
  method: string,
  pathname: string,
):
  | {
      status: number;
      handle(context: RouteContext): Promise<unknown>;
    }
  | undefined {
  if (method === "GET" && pathname === "/api/tickets") {
    return { status: 200, handle: listTickets };
  }

  const ticketRecommendation = /^\/api\/tickets\/([^/]+)\/recommendations$/.exec(
    pathname,
  );
  if (method === "POST" && ticketRecommendation !== null) {
    return {
      status: 201,
      handle: (context) =>
        createRecommendation(context, ticketRecommendation[1]!),
    };
  }

  const customerReply = /^\/api\/tickets\/([^/]+)\/customer-replies$/.exec(
    pathname,
  );
  if (method === "POST" && customerReply !== null) {
    return {
      status: 201,
      handle: (context) => addCustomerReply(context, customerReply[1]!),
    };
  }

  const diagnosis = /^\/api\/tickets\/([^/]+)\/diagnosis$/.exec(pathname);
  if (method === "POST" && diagnosis !== null) {
    return {
      status: 201,
      handle: (context) => recordDiagnosis(context, diagnosis[1]!),
    };
  }

  const fix = /^\/api\/tickets\/([^/]+)\/fix$/.exec(pathname);
  if (method === "POST" && fix !== null) {
    return {
      status: 201,
      handle: (context) => recordFix(context, fix[1]!),
    };
  }

  const close = /^\/api\/tickets\/([^/]+)\/close$/.exec(pathname);
  if (method === "POST" && close !== null) {
    return {
      status: 200,
      handle: (context) => closeTicket(context, close[1]!),
    };
  }

  const ticketDetail = /^\/api\/tickets\/([^/]+)$/.exec(pathname);
  if (method === "GET" && ticketDetail !== null) {
    return {
      status: 200,
      handle: (context) => getTicketDetail(context, ticketDetail[1]!),
    };
  }

  const recommendationDetail = /^\/api\/recommendations\/([^/]+)$/.exec(
    pathname,
  );
  if (method === "GET" && recommendationDetail !== null) {
    return {
      status: 200,
      handle: (context) =>
        getRecommendation(context, recommendationDetail[1]!),
    };
  }

  const approval = /^\/api\/recommendations\/([^/]+)\/approve$/.exec(pathname);
  if (method === "POST" && approval !== null) {
    return {
      status: 200,
      handle: (context) => approveRecommendation(context, approval[1]!),
    };
  }

  const sent = /^\/api\/recommendations\/([^/]+)\/mark-sent$/.exec(pathname);
  if (method === "POST" && sent !== null) {
    return {
      status: 200,
      handle: (context) => markRecommendationSent(context, sent[1]!),
    };
  }

  const rejection = /^\/api\/recommendations\/([^/]+)\/reject$/.exec(pathname);
  if (method === "POST" && rejection !== null) {
    return {
      status: 200,
      handle: (context) => rejectRecommendation(context, rejection[1]!),
    };
  }

  const approvalCancellation =
    /^\/api\/recommendations\/([^/]+)\/cancel-approval$/.exec(pathname);
  if (method === "POST" && approvalCancellation !== null) {
    return {
      status: 200,
      handle: (context) =>
        cancelApproval(context, approvalCancellation[1]!),
    };
  }

  if (method === "GET" && pathname === "/api/metrics") {
    return { status: 200, handle: getMetrics };
  }

  if (method === "GET" && pathname === "/api/evidence") {
    return { status: 200, handle: getEvidence };
  }

  return undefined;
}

interface RouteContext {
  deps: RuntimeDependencies;
  options: ApprovalDeskHttpOptions;
  request: IncomingMessage;
  url: URL;
}

async function listTickets({ deps, url }: RouteContext): Promise<unknown> {
  const query = TicketListQuerySchema.parse({
    status: optionalParam(url.searchParams, "status"),
    category: optionalParam(url.searchParams, "category"),
    priority: optionalParam(url.searchParams, "priority"),
    team: optionalParam(url.searchParams, "team"),
    offset: optionalParam(url.searchParams, "offset"),
    limit: optionalParam(url.searchParams, "limit"),
  });
  const [tickets, recommendations, audits] = await Promise.all([
    deps.tickets.list(query),
    deps.recommendations.list(),
    deps.audits.list(),
  ]);
  return {
    ...tickets,
    items: tickets.items.map((ticket) => ({
      ...ticket,
      recommendationSummary: summarizeRecommendationsForTicket(
        ticket,
        recommendations,
        audits,
      ).summary,
    })),
  };
}

async function getTicketDetail(
  { deps }: RouteContext,
  id: string,
): Promise<unknown> {
  const ticketId = TicketIdSchema.parse(id);
  const [ticket, auditPage, ticketAudits, recommendations] = await Promise.all([
    deps.tickets.get(ticketId),
    deps.audits.listPage({ ticketId, offset: 0, limit: 10 }),
    deps.audits.list(ticketId),
    deps.recommendations.list(),
  ]);
  const recommendation = summarizeRecommendationsForTicket(
    ticket,
    recommendations,
    ticketAudits,
  );
  return {
    ticket,
    audits: auditPage,
    conversationHistory: buildConversationHistory(ticketAudits),
    conversationTimeline: buildConversationTimeline({
      ticket,
      audits: ticketAudits,
      recommendations: recommendation.history,
    }),
    recommendationHistory: recommendation.history,
    recommendationSummary: recommendation.summary,
    latestRecommendation: recommendation.latest,
  };
}

type RecommendationWorkflowState =
  | "active"
  | "draft-ready"
  | "waiting"
  | "customer-replied"
  | "resolved";

function summarizeRecommendationsForTicket(
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
  const hasPendingRecommendation = currentRelated.some(
    (recommendation) => recommendation.resolution === "pending",
  );
  const hasApprovedRecommendation = currentRelated.some(
    (recommendation) => recommendation.resolution === "approved",
  );
  const ticketAudits = audits.filter((event) => event.ticketId === ticket.id);
  const latestSentAt = latestAuditTimestamp(
    ticketAudits,
    "customer-response-sent",
  );
  const latestCustomerReplyAt = latestAuditTimestamp(
    ticketAudits,
    "customer-reply-received",
  );
  const hasSentResponse = latestSentAt !== undefined;
  const hasCustomerReply = latestCustomerReplyAt !== undefined;
  const workflowState = conversationWorkflowState({
    ticket,
    latest,
    latestSentAt,
    latestCustomerReplyAt,
  });
  return {
    summary: {
      latestRecommendationId: latest?.id,
      latestResolution: latest?.resolution,
      hasPendingRecommendation,
      hasApprovedRecommendation,
      workflowState,
      outageRisk: latest?.outageRisk,
      securityRisk: latest?.securityRisk,
      slaRisk: latest?.slaRisk,
      priority: latest?.priority,
      hasSentResponse,
      hasCustomerReply,
      latestSentAt,
      latestCustomerReplyAt,
    },
    latest,
    history: related,
  };
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

function latestSentAtForRecommendation(
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

function latestCurrentRecommendation(
  ticketId: string,
  recommendations: readonly TriageRecommendation[],
  audits: readonly AuditEvent[],
): TriageRecommendation | undefined {
  return recommendations
    .filter(
      (recommendation) =>
        recommendation.ticketId === ticketId &&
        ["pending", "approved"].includes(recommendation.resolution),
    )
    .sort(compareRecommendationsNewestFirst(audits))[0];
}

function latestDiagnosisAudit(audits: readonly AuditEvent[]): AuditEvent | undefined {
  return audits
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) =>
        event.action === "diagnosis-completed" &&
        typeof event.after.diagnosis === "object" &&
        event.after.diagnosis !== null,
    )
    .sort(
      (left, right) =>
        right.event.timestamp.localeCompare(left.event.timestamp) ||
        right.index - left.index,
    )[0]?.event;
}

function latestDiagnosisContext(
  audits: readonly AuditEvent[],
): DiagnosisContext | undefined {
  const event = latestDiagnosisAudit(audits);
  if (
    event === undefined ||
    isSupersededByCustomerReply(audits, event, {
      preserveForQuestionReplies: true,
    })
  ) {
    return undefined;
  }
  return parseDiagnosisContext(event.after.diagnosis);
}

function latestFixContext(audits: readonly AuditEvent[]): FixContext | undefined {
  const event = latestFixAudit(audits);
  if (
    event === undefined ||
    isSupersededByCustomerReply(audits, event, {
      preserveForQuestionReplies: true,
    })
  ) {
    return undefined;
  }
  return parseFixContext(event?.after.fix);
}

function latestFixAudit(audits: readonly AuditEvent[]): AuditEvent | undefined {
  return audits
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) =>
        event.action === "fix-available" &&
        typeof event.after.fix === "object" &&
        event.after.fix !== null,
    )
    .sort(
      (left, right) =>
        right.event.timestamp.localeCompare(left.event.timestamp) ||
        right.index - left.index,
    )[0]?.event;
}

function isSupersededByCustomerReply(
  audits: readonly AuditEvent[],
  event: AuditEvent,
  options: { preserveForQuestionReplies?: boolean } = {},
): boolean {
  const eventIndex = audits.indexOf(event);
  return audits.some(
    (candidate, index) => {
      if (candidate.action !== "customer-reply-received") {
        return false;
      }
      const isNewer =
        candidate.timestamp > event.timestamp ||
        (candidate.timestamp === event.timestamp && index > eventIndex);
      if (!isNewer) {
        return false;
      }
      if (
        options.preserveForQuestionReplies === true &&
        customerReplyCanUseExistingDiagnosis(candidate)
      ) {
        return false;
      }
      return true;
    },
  );
}

function customerReplyCanUseExistingDiagnosis(event: AuditEvent): boolean {
  const body =
    typeof event.after.body === "string" ? event.after.body : "";
  return isCustomerStatusFollowUp(body) || isCustomerExplanationRequest(body);
}

function isCustomerStatusFollowUp(value: string): boolean {
  return /\b(?:how long|eta|estimated time|when (?:will|can|should)|any update|status update|what'?s (?:the )?(?:current )?status|current status(?: of (?:the )?ticket)?|wait for (?:a )?fix|fix be ready|fixed|resolved)\b/i.test(
    value,
  );
}

function isCustomerExplanationRequest(value: string): boolean {
  return /\b(?:what'?s|what is|whats)\s+(?:the\s+)?(?:problem|issue|wrong|happening|going on|cause)|\bwhy\s+(?:is|are|did|does|do)\b.{0,80}\b(?:happening|broken|failing|delayed|missing|not working|not showing)|\bwhat happened\b|\bwhat caused\b|\broot cause\b/i.test(
    value,
  );
}

function parseDiagnosisContext(value: unknown): DiagnosisContext | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const context = value as Partial<DiagnosisContext>;
  if (
    context.status !== "completed" ||
    typeof context.causeType !== "string" ||
    typeof context.customerSafeSummary !== "string" ||
    !Array.isArray(context.evidenceUsed) ||
    typeof context.confidence !== "string" ||
    typeof context.owner !== "string" ||
    typeof context.recommendedNextAction !== "string" ||
    !Array.isArray(context.doNotSay)
  ) {
    return undefined;
  }
  return {
    status: "completed",
    causeType: context.causeType as DiagnosisContext["causeType"],
    customerSafeSummary: context.customerSafeSummary,
    evidenceUsed: context.evidenceUsed.filter(
      (item): item is string => typeof item === "string",
    ),
    confidence: context.confidence as DiagnosisContext["confidence"],
    owner: context.owner as DiagnosisContext["owner"],
    recommendedNextAction: context.recommendedNextAction,
    doNotSay: context.doNotSay.filter(
      (item): item is string => typeof item === "string",
    ),
  };
}

function parseFixContext(value: unknown): FixContext | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const context = value as Partial<FixContext>;
  if (
    context.status !== "available" ||
    typeof context.customerSafeSummary !== "string" ||
    typeof context.customerAction !== "string" ||
    typeof context.verificationRequest !== "string"
  ) {
    return undefined;
  }
  return {
    status: "available",
    customerSafeSummary: context.customerSafeSummary,
    customerAction: context.customerAction,
    verificationRequest: context.verificationRequest,
  };
}

function diagnosisContextForTicket(
  ticket: Ticket,
  recommendation: TriageRecommendation,
  audits: readonly AuditEvent[] = [],
): DiagnosisContext {
  const playbookDiagnosis = diagnoseFromPlaybook({
    ticket,
    recommendation,
    customerReplyText: customerReplyTextFromAudits(ticket.id, audits),
  });
  if (playbookDiagnosis !== undefined) {
    return playbookDiagnosis;
  }

  if (
    recommendation.supportState === "known-cause" &&
    recommendation.knownCause !== undefined &&
    recommendation.knownCause !== null
  ) {
    const knownCause = getKnownCause(recommendation.knownCause);
    if (knownCause !== undefined) {
      return {
        status: "completed",
        causeType: recommendation.category === "integration" ? "integration" : "configuration",
        customerSafeSummary: knownCause.problemSummary,
        evidenceUsed: providedEvidenceLabels(recommendation, knownCause.label),
        confidence: "confirmed",
        owner: recommendation.team === "integrations" ? "integration-partner" : "support",
        recommendedNextAction: knownCause.nextStep,
        doNotSay: [
          "Do not ask for unrelated diagnostics after a known cause is confirmed.",
        ],
      };
    }
  }

  if (recommendation.supportState === "waiting-on-platform-fix") {
    return {
      status: "completed",
      causeType: "platform-delay",
      customerSafeSummary:
        "The evidence points to a platform-side processing delay affecting checkout event processing and profile timeline updates.",
      evidenceUsed: providedEvidenceLabels(recommendation, "provided customer evidence"),
      confidence: "likely",
      owner: "engineering",
      recommendedNextAction:
        "Complete platform mitigation before asking the customer to verify the affected examples.",
      doNotSay: ["Do not claim a final root cause until mitigation is available."],
    };
  }

  return {
    status: "completed",
    causeType: recommendation.category === "security" ? "security" : "configuration",
    customerSafeSummary:
      "The support team has completed the investigation and identified the most likely cause from the provided evidence.",
    evidenceUsed: providedEvidenceLabels(
      recommendation,
      recommendation.knownCause === undefined || recommendation.knownCause === null
        ? "provided customer evidence"
        : "known cause match",
    ),
    confidence: "likely",
    owner: recommendation.category === "integration" ? "integration-partner" : "support",
    recommendedNextAction:
      "Share the diagnosis with the customer and explain the next safe action.",
    doNotSay: ["Do not claim a fix until a fix event is recorded."],
  };
}

function providedEvidenceLabels(
  recommendation: TriageRecommendation,
  fallback: string,
): string[] {
  const labels = recommendation.providedEvidence?.map((item) => item.label) ?? [];
  return labels.length > 0 ? labels : [fallback];
}

function customerReplyTextFromAudits(
  ticketId: string,
  audits: readonly AuditEvent[],
): string {
  return audits
    .filter(
      (event) =>
        event.ticketId === ticketId &&
        event.action === "customer-reply-received" &&
        typeof event.after.body === "string",
    )
    .map((event) => event.after.body as string)
    .join("\n\n");
}

function fixContextForTicket(
  ticket: Ticket,
  diagnosisEvent: AuditEvent,
): FixContext {
  if (ticket.id === "TKT-1010") {
    return {
      status: "available",
      customerSafeSummary:
        "The campaign editor loading mitigation has been applied for the affected campaign.",
      customerAction:
        "Please reopen the Summer Flash Sale campaign editor in Chrome and try editing the campaign again.",
      verificationRequest:
        "Let us know whether the editor now loads normally or if the blank page still appears.",
    };
  }

  if (
    typeof diagnosisEvent.after.diagnosis === "object" &&
    diagnosisEvent.after.diagnosis !== null &&
    "causeType" in diagnosisEvent.after.diagnosis &&
    diagnosisEvent.after.diagnosis.causeType === "platform-delay"
  ) {
    return {
      status: "available",
      customerSafeSummary:
        "The event-processing delay mitigation has been applied for the affected store events.",
      customerAction:
        "Please check the affected profile timelines again using the same store URL, profile, and event example you shared with us.",
      verificationRequest:
        "Let us know whether the delayed checkout events now appear correctly or if any examples are still missing.",
    };
  }

  const diagnosis =
    typeof diagnosisEvent.after.diagnosis === "object" &&
    diagnosisEvent.after.diagnosis !== null &&
    "customerSafeSummary" in diagnosisEvent.after.diagnosis &&
    typeof diagnosisEvent.after.diagnosis.customerSafeSummary === "string"
      ? diagnosisEvent.after.diagnosis.customerSafeSummary
      : "the diagnosed issue";

  return {
    status: "available",
    customerSafeSummary: `A fix or mitigation is now available for ${diagnosis}`,
    customerAction:
      "Please retry the affected workflow using the same example you shared with us.",
    verificationRequest:
      "Let us know whether the issue is resolved or if you still see the same behavior.",
  };
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

function customerRepliesFromAudits(
  ticketId: string,
  audits: readonly AuditEvent[],
): Array<{ id: string; ticketId: string; createdAt: string; body: string }> {
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

function latestSupportResponseFromAudits(
  ticketId: string,
  audits: readonly AuditEvent[],
): { sentAt: string; body: string } | undefined {
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

async function createRecommendation(
  { deps, options, request }: RouteContext,
  id: string,
): Promise<unknown> {
  const ticketId = TicketIdSchema.parse(id);
  const body = SubmitBodySchema.parse(await readJsonBody(request));
  const [ticket, audits] = await Promise.all([
    deps.tickets.get(ticketId),
    deps.audits.list(ticketId),
  ]);
  const persistedCustomerReplies = customerRepliesFromAudits(ticketId, audits);
  const previousSupportResponse = latestSupportResponseFromAudits(
    ticketId,
    audits,
  );
  const diagnosisContext = latestDiagnosisContext(audits);
  const fixContext = latestFixContext(audits);
  const customerReplies = [...persistedCustomerReplies, ...body.customerReplies.map((reply) => ({
    ...reply,
    ticketId,
  }))];
  const outcomes =
    options.expectedOutcomesPath === undefined
      ? undefined
      : await loadExpectedOutcomes(options.expectedOutcomesPath);
  const outcome = outcomes?.get(ticket.id);
  const input = await evaluateTicketWithAi({
    ticket,
    outcome,
    actor: body.actor,
    allKnowledgeArticles: await deps.knowledge.list(),
    customerReplies,
    previousSupportResponse,
    diagnosisContext,
    fixContext,
    aiPreference: body.aiPreference,
    responseStyle: body.responseStyle,
    classificationProvider:
      options.classificationReasoningProvider ??
      createClassificationReasoningProviderFromEnv(process.env, {
        preferOpenAi: body.aiPreference === "gpt-preferred" ||
          process.env.APPROVAL_DRAFT_PROVIDER === "openai",
      }),
    draftProvider:
      options.draftProvider ??
      createCustomerResponseDraftProviderFromEnv(process.env, {
        responseStyle: body.responseStyle,
        preferOpenAi: body.aiPreference === "gpt-preferred",
      }),
  });
  const { recommendation } = await deps.service.submitEvaluation({
    ...input,
    submittedAt: deps.now().toISOString(),
  });
  return { recommendation };
}

async function addCustomerReply(
  { deps, request }: RouteContext,
  id: string,
): Promise<unknown> {
  const ticketId = TicketIdSchema.parse(id);
  const body = CustomerReplyRouteBodySchema.parse(await readJsonBody(request));
  return {
    auditEvent: await deps.service.addCustomerReply({
      ...body,
      ticketId,
      receivedAt: deps.now().toISOString(),
    }),
  };
}

async function recordDiagnosis(
  { deps, request }: RouteContext,
  id: string,
): Promise<unknown> {
  const ticketId = TicketIdSchema.parse(id);
  const body = WorkflowActionBodySchema.parse(await readJsonBody(request));
  const [ticket, audits, recommendations] = await Promise.all([
    deps.tickets.get(ticketId),
    deps.audits.list(ticketId),
    deps.recommendations.list(),
  ]);
  const latest = latestCurrentRecommendation(ticketId, recommendations, audits);
  if (latest === undefined) {
    throw invalidRequest("A completed evaluation is required before diagnosis.");
  }
  const knownCauseReady = latest.supportState === "known-cause";
  if (!knownCauseReady && (latest.missingEvidence?.length ?? 0) > 0) {
    throw invalidRequest("Diagnosis requires all required evidence to be gathered.");
  }
  if (
    !knownCauseReady &&
    !["diagnosing", "waiting-on-platform-fix"].includes(latest.supportState ?? "")
  ) {
    throw invalidRequest("Diagnosis requires a diagnosis-ready ticket state.");
  }
  const sentAt = latestSentAtForRecommendation(audits, latest.id);
  if (sentAt === undefined) {
    throw invalidRequest("The evaluated response must be marked done before diagnosis.");
  }
  const latestReplyAt = latestAuditTimestamp(audits, "customer-reply-received");
  if (latestReplyAt !== undefined && latestReplyAt > sentAt) {
    throw invalidRequest("Evaluate the latest customer reply before diagnosis.");
  }
  const latestDiagnosisAt = latestAuditTimestamp(audits, "diagnosis-completed");
  if (
    latestDiagnosisAt !== undefined &&
    (latestReplyAt === undefined || latestDiagnosisAt > latestReplyAt)
  ) {
    throw invalidRequest("Diagnosis has already been recorded for the latest context.");
  }

  return {
    auditEvent: await deps.service.recordDiagnosis({
      ticketId,
      actor: body.actor,
      diagnosedAt: deps.now().toISOString(),
      diagnosis: diagnosisContextForTicket(ticket, latest, audits),
      knowledgeArticleIds: latest.knowledgeArticleIds.length > 0
        ? latest.knowledgeArticleIds
        : [latest.knownCause ?? "known-cause"],
    }),
  };
}

async function recordFix(
  { deps, request }: RouteContext,
  id: string,
): Promise<unknown> {
  const ticketId = TicketIdSchema.parse(id);
  const body = WorkflowActionBodySchema.parse(await readJsonBody(request));
  const [ticket, audits, recommendations] = await Promise.all([
    deps.tickets.get(ticketId),
    deps.audits.list(ticketId),
    deps.recommendations.list(),
  ]);
  const latestDiagnosis = latestDiagnosisAudit(audits);
  if (latestDiagnosis === undefined) {
    throw invalidRequest("A completed diagnosis is required before marking a fix available.");
  }
  const diagnosisContext = parseDiagnosisContext(latestDiagnosis.after.diagnosis);
  if (diagnosisContext?.confidence !== "confirmed") {
    throw invalidRequest("A confirmed diagnosis is required before marking a fix available.");
  }
  if (!["engineering", "integration-partner"].includes(diagnosisContext.owner)) {
    throw invalidRequest("This confirmed diagnosis does not require a platform fix.");
  }
  const latestFixAt = latestAuditTimestamp(audits, "fix-available");
  if (latestFixAt !== undefined && latestFixAt > latestDiagnosis.timestamp) {
    throw invalidRequest("A fix has already been recorded for the latest diagnosis.");
  }
  const sentAt = latestAuditTimestamp(audits, "customer-response-sent");
  if (sentAt === undefined || sentAt < latestDiagnosis.timestamp) {
    throw invalidRequest("Send the diagnosis response before marking a fix available.");
  }
  const latestReplyAt = latestAuditTimestamp(audits, "customer-reply-received");
  if (latestReplyAt !== undefined && latestReplyAt > sentAt) {
    throw invalidRequest("Evaluate the latest customer reply before marking a fix available.");
  }
  const latest = latestCurrentRecommendation(ticketId, recommendations, audits);

  return {
    auditEvent: await deps.service.recordFix({
      ticketId,
      actor: body.actor,
      fixedAt: deps.now().toISOString(),
      fix: fixContextForTicket(ticket, latestDiagnosis),
      knowledgeArticleIds: latest?.knowledgeArticleIds ?? [],
    }),
  };
}

async function closeTicket(
  { deps, request }: RouteContext,
  id: string,
): Promise<unknown> {
  const ticketId = TicketIdSchema.parse(id);
  const body = WorkflowActionBodySchema.parse(await readJsonBody(request));
  const [ticket, audits, recommendations] = await Promise.all([
    deps.tickets.get(ticketId),
    deps.audits.list(ticketId),
    deps.recommendations.list(),
  ]);
  if (ticket.status === "resolved") {
    throw invalidRequest("Ticket is already closed.");
  }

  const summary = summarizeRecommendationsForTicket(
    ticket,
    recommendations,
    audits,
  );
  const latest = summary.latest;
  if (latest?.supportState !== "ready-for-close") {
    throw invalidRequest(
      "Ticket must have a ready-to-close recommendation before it can be closed.",
    );
  }
  const sentAt = latestSentAtForRecommendation(audits, latest.id);
  if (sentAt === undefined) {
    throw invalidRequest(
      "The ready-to-close response must be marked done before the ticket can be closed.",
    );
  }

  const closedAt = deps.now().toISOString();
  const { ticket: updated, result: auditEvent } =
    await deps.tickets.updateWithCommit(
      ticketId,
      ticket.revision,
      (current) => ({
        ...current,
        status: "resolved",
        updatedAt: closedAt,
      }),
      async (updatedTicket, previousTicket) => {
        const event = AuditEventSchema.parse({
          id: randomUUID(),
          timestamp: closedAt,
          actor: body.actor,
          action: "ticket-updated",
          ticketId,
          recommendationId: latest.id,
          before: {
            status: previousTicket.status,
            revision: previousTicket.revision,
          },
          after: {
            status: updatedTicket.status,
            revision: updatedTicket.revision,
            closedAt,
          },
          rationale:
            "Ticket closed after the customer confirmed resolution and the closing response was sent.",
          knowledgeArticleIds: latest.knowledgeArticleIds,
          result: "success",
        });
        await deps.audits.append(event);
        return event;
      },
    );

  return { ticket: updated, auditEvent };
}

async function getRecommendation(
  { deps }: RouteContext,
  id: string,
): Promise<unknown> {
  const recommendationId = RecommendationIdSchema.parse(id);
  return { recommendation: await deps.recommendations.get(recommendationId) };
}

async function approveRecommendation(
  { deps, request }: RouteContext,
  id: string,
): Promise<unknown> {
  const recommendationId = RecommendationIdSchema.parse(id);
  const body = ApprovalBodySchema.parse(await readJsonBody(request));
  return deps.service.approve({
    ...body,
    recommendationId,
    approvedAt: deps.now().toISOString(),
  });
}

async function markRecommendationSent(
  { deps, request }: RouteContext,
  id: string,
): Promise<unknown> {
  const recommendationId = RecommendationIdSchema.parse(id);
  const body = MarkSentBodySchema.parse(await readJsonBody(request));
  return serializeMarkSent(recommendationId, async () => {
    const audits = await deps.audits.list(body.ticketId);
    const alreadySent = audits.some(
      (event) =>
        event.action === "customer-response-sent" &&
        event.recommendationId === recommendationId,
    );
    if (alreadySent) {
      throw invalidRequest("Customer response has already been marked sent.");
    }
    const approval = audits
      .filter(
        (event) =>
          event.action === "recommendation-approved" &&
          event.recommendationId === recommendationId,
      )
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0];
    if (approval === undefined) {
      throw invalidRequest("Approved recommendation audit was not found.");
    }
    const customerResponse =
      typeof approval.after.customerResponse === "string"
        ? approval.after.customerResponse
        : undefined;
    if (customerResponse === undefined) {
      throw invalidRequest(
        "Customer response must be approved before it can be marked sent.",
      );
    }
    const sentAt = deps.now().toISOString();
    const auditEvent = await deps.service.markResponseSent({
      ...body,
      recommendationId,
      sentAt,
      customerResponse,
    });
    const recommendation = await deps.recommendations.get(recommendationId);
    const automaticReply = await maybeAddAutomaticCustomerReplyAfterSent({
      deps,
      ticketId: body.ticketId,
      recommendation,
      auditsBeforeSent: audits,
      sentAt,
    });
    return {
      auditEvent,
      ...(automaticReply === undefined ? {} : { automaticReply }),
    };
  });
}

async function maybeAddAutomaticCustomerReplyAfterSent(input: {
  deps: RuntimeDependencies;
  ticketId: string;
  recommendation: TriageRecommendation;
  auditsBeforeSent: readonly AuditEvent[];
  sentAt: string;
}): Promise<AuditEvent | undefined> {
  const latestReplyAfterRecommendation = latestAuditTimestamp(
    input.auditsBeforeSent.filter(
      (event) => event.timestamp > input.recommendation.createdAt,
    ),
    "customer-reply-received",
  );
  if (latestReplyAfterRecommendation !== undefined) {
    return undefined;
  }
  const ticket = await input.deps.tickets.get(input.ticketId);
  const body = automaticReplyForTicket({
    ticket,
    recommendation: input.recommendation,
    auditsBeforeSent: input.auditsBeforeSent,
  });
  if (body === undefined) {
    return undefined;
  }
  return input.deps.service.addCustomerReply({
    ticketId: input.ticketId,
    actor: ticket.requester?.name ?? ticket.customer.name,
    body,
    receivedAt: plusMilliseconds(input.sentAt, 1),
    source: "demo-auto-reply",
  });
}

function plusMilliseconds(timestamp: string, milliseconds: number): string {
  return new Date(new Date(timestamp).getTime() + milliseconds).toISOString();
}

async function rejectRecommendation(
  { deps, request }: RouteContext,
  id: string,
): Promise<unknown> {
  const recommendationId = RecommendationIdSchema.parse(id);
  const body = RejectBodySchema.parse(await readJsonBody(request));
  return {
    auditEvent: await deps.service.reject({
      ...body,
      recommendationId,
      rejectedAt: deps.now().toISOString(),
    }),
  };
}

async function cancelApproval(
  { deps, request }: RouteContext,
  id: string,
): Promise<unknown> {
  const recommendationId = RecommendationIdSchema.parse(id);
  const body = CancelApprovalBodySchema.parse(await readJsonBody(request));
  return {
    auditEvent: await deps.service.cancelApproval({
      ...body,
      recommendationId,
      canceledAt: deps.now().toISOString(),
    }),
  };
}

async function getMetrics({ deps }: RouteContext): Promise<unknown> {
  const [tickets, recommendations] = await Promise.all([
    deps.tickets.snapshot(),
    deps.recommendations.list(),
  ]);
  return calculateQueueMetrics({
    tickets,
    recommendations,
    now: deps.now(),
    minutesPerAcceptedRecommendation: deps.minutesPerAcceptedRecommendation,
  });
}

async function getEvidence({ deps }: RouteContext): Promise<unknown> {
  const generatedAt = deps.now();
  const [tickets, recommendations, audits] = await Promise.all([
    deps.tickets.snapshot(),
    deps.recommendations.list(),
    deps.audits.list(),
  ]);
  const metrics = calculateQueueMetrics({
    tickets,
    recommendations,
    now: generatedAt,
    minutesPerAcceptedRecommendation: deps.minutesPerAcceptedRecommendation,
  });
  return buildAutomationEvidenceReport({
    metrics,
    audits,
    generatedAt: generatedAt.toISOString(),
  });
}

function optionalParam(
  searchParams: URLSearchParams,
  key: string,
): string | undefined {
  return searchParams.has(key) ? (searchParams.get(key) ?? "") : undefined;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > JSON_BODY_LIMIT_BYTES) {
      throw invalidRequest(
        `Request body must be ${JSON_BODY_LIMIT_BYTES} bytes or less.`,
      );
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw invalidRequest("Request body must be valid JSON.", raw);
  }
}

function invalidRequest(message: string, input?: unknown): z.ZodError {
  return new z.ZodError([
    {
      code: "custom",
      path: [],
      message,
      input,
    },
  ]);
}

async function serializeMarkSent<T>(
  recommendationId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous =
    markSentOperations.get(recommendationId) ?? Promise.resolve();
  let release = (): void => undefined;
  const current = new Promise<void>((resolveOperation) => {
    release = resolveOperation;
  });
  markSentOperations.set(recommendationId, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (markSentOperations.get(recommendationId) === current) {
      markSentOperations.delete(recommendationId);
    }
  }
}

function text(
  response: ServerResponse,
  status: number,
  body: string,
): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
  });
  response.end(body);
}

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function handleError(response: ServerResponse, error: unknown): void {
  if (error instanceof z.ZodError) {
    json(response, 400, {
      error: {
        code: "INVALID_REQUEST",
        message: error.issues[0]?.message ?? "Invalid request.",
      },
    });
    return;
  }
  if (error instanceof DomainError) {
    json(response, domainStatus(error), {
      error: { code: error.code, message: error.message },
    });
    return;
  }

  console.error(
    `${UNEXPECTED_ERROR_TEXT} ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }`,
  );
  json(response, 500, {
    error: {
      code: "APPROVAL_DESK_ERROR",
      message: UNEXPECTED_ERROR_TEXT,
    },
  });
}

function domainStatus(error: DomainError): number {
  switch (error.code) {
    case "STALE_APPROVAL":
      return 409;
    case "TICKET_NOT_FOUND":
    case "RECOMMENDATION_NOT_FOUND":
      return 404;
    default:
      return 400;
  }
}
