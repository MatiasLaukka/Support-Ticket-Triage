import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import {
  ApprovedFieldSchema,
  CategorySchema,
  DraftCustomerResponseStyleInputSchema,
  DraftCustomerResponseStyleSchema,
  PrioritySchema,
  TeamSchema,
  TicketIdSchema,
  TicketStatusSchema,
} from "../domain.js";
import type { AuditEvent, Ticket, TriageRecommendation } from "../domain.js";
import { DomainError } from "../errors.js";
import { calculateQueueMetrics } from "../metrics.js";
import type { RuntimeDependencies } from "../runtime.js";
import {
  advisorySignalsFromGptReasoning,
  buildApprovalDeskRecommendationInput,
  buildApprovalDeskRecommendationInputWithDrafting,
  loadExpectedOutcomes,
} from "./recommendation-builder.js";
import {
  createCustomerResponseDraftProviderFromEnv,
  type CustomerResponseDraftProvider,
  type GptClassificationReasoningProvider,
} from "./draft-response-provider.js";
import { classifyTicketFromContext } from "./classifier.js";
import { buildConversationContextForTicket } from "./conversation-context.js";
import { buildAutomationEvidenceReport } from "./evidence-report.js";
import { approvalDeskHtml } from "./ui.js";
import {
  buildConversationHistory,
  buildConversationTimeline,
} from "./conversation-history.js";

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

export interface ApprovalDeskHttpOptions {
  expectedOutcomesPath?: string;
  draftProvider?: CustomerResponseDraftProvider;
  classificationReasoningProvider?: GptClassificationReasoningProvider;
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
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id),
    );
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

async function supersedePendingRecommendationsWithNewerReply(input: {
  deps: RuntimeDependencies;
  ticketId: string;
  actor: string;
  recommendations: readonly TriageRecommendation[];
  persistedCustomerReplies: readonly { createdAt: string }[];
}): Promise<void> {
  const latestReplyAt = input.persistedCustomerReplies
    .map((reply) => reply.createdAt)
    .sort((left, right) => right.localeCompare(left))[0];
  if (latestReplyAt === undefined) {
    return;
  }

  const supersededAt = input.deps.now().toISOString();
  const pendingRecommendations = input.recommendations.filter(
    (recommendation) =>
      recommendation.ticketId === input.ticketId &&
      recommendation.resolution === "pending" &&
      latestReplyAt > recommendation.createdAt,
  );
  for (const recommendation of pendingRecommendations) {
    await input.deps.service.supersedeRecommendation({
      recommendationId: recommendation.id,
      ticketId: input.ticketId,
      actor: input.actor,
      supersededAt,
      reason: "A newer customer reply requires a fresh recommendation.",
    });
  }
}

async function createRecommendation(
  { deps, options, request }: RouteContext,
  id: string,
): Promise<unknown> {
  const ticketId = TicketIdSchema.parse(id);
  const body = SubmitBodySchema.parse(await readJsonBody(request));
  const [ticket, audits, recommendations] = await Promise.all([
    deps.tickets.get(ticketId),
    deps.audits.list(ticketId),
    deps.recommendations.list(),
  ]);
  const persistedCustomerReplies = customerRepliesFromAudits(ticketId, audits);
  const previousSupportResponse = latestSupportResponseFromAudits(
    ticketId,
    audits,
  );
  const customerReplies = [...persistedCustomerReplies, ...body.customerReplies.map((reply) => ({
    ...reply,
    ticketId,
  }))];
  const outcomes =
    options.expectedOutcomesPath === undefined
      ? undefined
      : await loadExpectedOutcomes(options.expectedOutcomesPath);
  const outcome = outcomes?.get(ticket.id);
  const conversationContextForClassification = buildConversationContextForTicket({
    ticket,
    customerReplies,
    previousSupportResponses:
      previousSupportResponse === undefined ? [] : [previousSupportResponse],
  });
  const deterministicClassification = classifyTicketFromContext(
    conversationContextForClassification,
  );
  const gptReasoning =
    options.classificationReasoningProvider === undefined || outcome !== undefined
      ? undefined
      : await options.classificationReasoningProvider.reason({
          ticket,
          conversationContext: conversationContextForClassification,
          deterministicClassification,
        });
  const advisoryClassificationSignals =
    gptReasoning === undefined
      ? undefined
      : advisorySignalsFromGptReasoning(gptReasoning);
  const deterministicInput = buildApprovalDeskRecommendationInput({
    ticket,
    outcome,
    actor: body.actor,
    customerReplies,
    previousSupportResponse,
    advisoryClassificationSignals,
  });
  const knowledgeArticles = await Promise.all(
    deterministicInput.knowledgeArticleIds.map((articleId) =>
      deps.knowledge.get(articleId),
    ),
  );
  const input = await buildApprovalDeskRecommendationInputWithDrafting({
    ticket,
    outcome,
    actor: body.actor,
    knowledgeArticles,
    responseStyle: body.responseStyle,
    customerReplies,
    previousSupportResponse,
    advisoryClassificationSignals,
    draftProvider:
      options.draftProvider ??
      createCustomerResponseDraftProviderFromEnv(process.env, {
        responseStyle: body.responseStyle,
      }),
  });
  const recommendation = await deps.service.submit({
      ...input,
      submittedAt: deps.now().toISOString(),
  });
  await supersedePendingRecommendationsWithNewerReply({
    deps,
    ticketId,
    actor: body.actor,
    recommendations,
    persistedCustomerReplies,
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
    return {
      auditEvent: await deps.service.markResponseSent({
        ...body,
        recommendationId,
        sentAt,
        customerResponse,
      }),
    };
  });
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
