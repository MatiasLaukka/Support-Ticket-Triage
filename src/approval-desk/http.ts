import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { z } from "zod";
import {
  ApprovedFieldSchema,
  CategorySchema,
  PrioritySchema,
  TeamSchema,
  TicketIdSchema,
  TicketStatusSchema,
} from "../domain.js";
import { DomainError } from "../errors.js";
import { calculateQueueMetrics } from "../metrics.js";
import type { RuntimeDependencies } from "../runtime.js";
import {
  buildApprovalDeskRecommendationInput,
  loadExpectedOutcomes,
} from "./recommendation-builder.js";
import { approvalDeskHtml } from "./ui.js";

const DEFAULT_EXPECTED_OUTCOMES_PATH = resolve(
  "data/seed/expected-outcomes.json",
);
const JSON_BODY_LIMIT_BYTES = 65_536;
const UNEXPECTED_ERROR_TEXT = "Unexpected local approval desk error.";

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
const SubmitBodySchema = z
  .object({
    actor: z.string().trim().min(1).default("approval-desk"),
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
  );
const RejectBodySchema = z
  .object({
    ticketId: TicketIdSchema,
    actor: z.string().trim().min(1),
    feedback: z.string().trim().min(1),
  })
  .strict();

export interface ApprovalDeskHttpOptions {
  expectedOutcomesPath?: string;
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

  const rejection = /^\/api\/recommendations\/([^/]+)\/reject$/.exec(pathname);
  if (method === "POST" && rejection !== null) {
    return {
      status: 200,
      handle: (context) => rejectRecommendation(context, rejection[1]!),
    };
  }

  if (method === "GET" && pathname === "/api/metrics") {
    return { status: 200, handle: getMetrics };
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
  return deps.tickets.list(query);
}

async function getTicketDetail(
  { deps }: RouteContext,
  id: string,
): Promise<unknown> {
  const ticketId = TicketIdSchema.parse(id);
  const [ticket, audits] = await Promise.all([
    deps.tickets.get(ticketId),
    deps.audits.listPage({ ticketId, offset: 0, limit: 10 }),
  ]);
  return { ticket, audits };
}

async function createRecommendation(
  { deps, options, request }: RouteContext,
  id: string,
): Promise<unknown> {
  const ticketId = TicketIdSchema.parse(id);
  const body = SubmitBodySchema.parse(await readJsonBody(request));
  const [ticket, outcomes] = await Promise.all([
    deps.tickets.get(ticketId),
    loadExpectedOutcomes(
      options.expectedOutcomesPath ?? DEFAULT_EXPECTED_OUTCOMES_PATH,
    ),
  ]);
  const input = buildApprovalDeskRecommendationInput({
    ticket,
    outcome: outcomes.get(ticket.id),
    actor: body.actor,
  });
  return {
    recommendation: await deps.service.submit({
      ...input,
      submittedAt: deps.now().toISOString(),
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
