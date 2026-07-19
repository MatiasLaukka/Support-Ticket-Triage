import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  AiExecutionTraceSchema,
  TicketSchema,
  TriageRecommendationSchema,
  type AiExecutionTrace,
  type ApprovedField,
  type AuditEvent,
  type Ticket,
} from "../src/domain.js";
import {
  createClassificationReasoningProviderFromEnv,
  type ClassificationReasoningProvider,
} from "../src/approval-desk/classification-reasoning-provider.js";
import {
  buildDeterministicGptAssist,
  createCustomerResponseDraftProviderFromEnv,
  ensureDraftSignOff,
  type CustomerResponseDraftProvider,
} from "../src/approval-desk/draft-response-provider.js";
import {
  OperatorGuidanceSchema,
  type OperatorGuidance,
} from "../src/approval-desk/workflow-guidance.js";
import { createRuntimeDependencies } from "../src/runtime.js";
import {
  createTriageServer,
  type TriageServerDependencies,
} from "../src/server.js";

const TICKET_ID = "TKT-1010" as const;
const ACTOR = "portfolio-reviewer";
const MAX_TRANSITIONS = 20;
const SHOWCASE_START = Date.parse("2026-06-10T10:00:00.000Z");

export type SkillShowcaseMode = "controlled" | "deterministic" | "live";

export interface SkillShowcaseReport {
  toolCalls: string[];
  aiStages: AiExecutionTrace[];
  workflowStages: Array<{
    stage: OperatorGuidance["stage"];
    nextAction: OperatorGuidance["nextAction"];
  }>;
  approvals: Array<{
    required: true;
    fields: ApprovedField[];
    actor: string;
  }>;
  finalTicketStatus: Ticket["status"];
  auditEvents: Array<{
    type: AuditEvent["action"];
    actor: string;
    timestamp: string;
  }>;
  serialized: string;
}

interface WorkflowSnapshot {
  ticket: Ticket;
  latestRecommendation?: z.infer<typeof TriageRecommendationSchema>;
  operatorGuidance: OperatorGuidance;
}

const WorkflowSnapshotSchema = z
  .object({
    ticket: TicketSchema,
    latestRecommendation: TriageRecommendationSchema.optional(),
    operatorGuidance: OperatorGuidanceSchema,
  })
  .passthrough();

export async function runSkillShowcase(options: {
  root: string;
  dataRoot: string;
  mode: SkillShowcaseMode;
}): Promise<SkillShowcaseReport> {
  if (options.mode === "live" && !process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is required for live showcase mode.");
  }

  let clockTick = 0;
  const deps = await createRuntimeDependencies({
    cwd: options.root,
    now: () => new Date(SHOWCASE_START + clockTick++ * 1_000),
    env: {
      TRIAGE_DATA_ROOT: options.dataRoot,
      TRIAGE_SEED_FILE: resolve(options.root, "data/seed/tickets.json"),
      TRIAGE_KNOWLEDGE_ROOT: resolve(options.root, "data/knowledge"),
    },
  });
  const providers = providersForMode(options.mode);
  const client = await connectInMemory(
    createTriageServer({
      ...deps,
      ...providers,
      env: options.mode === "live" ? process.env : {},
    }),
  );

  try {
    return await replayTkt1010({ client, deps, mode: options.mode });
  } finally {
    await client.close();
  }
}

export function providersForMode(
  mode: SkillShowcaseMode,
): Pick<
  TriageServerDependencies,
  "classificationReasoningProvider" | "draftProvider"
> {
  if (mode === "deterministic") return {};
  if (mode === "live") {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      throw new Error("OPENAI_API_KEY is required for live showcase mode.");
    }
    return {
      classificationReasoningProvider:
        createClassificationReasoningProviderFromEnv(process.env, {
          preferOpenAi: true,
        }),
      draftProvider: createCustomerResponseDraftProviderFromEnv(process.env, {
        responseStyle: "auto",
        preferOpenAi: true,
      }),
    };
  }
  return controlledProviders();
}

export async function connectInMemory(server: McpServer): Promise<Client> {
  const client = new Client({
    name: "skill-showcase",
    version: "1.0.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

async function replayTkt1010(input: {
  client: Client;
  deps: Awaited<ReturnType<typeof createRuntimeDependencies>>;
  mode: SkillShowcaseMode;
}): Promise<SkillShowcaseReport> {
  const toolCalls: string[] = [];
  const aiStages: SkillShowcaseReport["aiStages"] = [];
  const workflowStages: SkillShowcaseReport["workflowStages"] = [];
  const approvals: SkillShowcaseReport["approvals"] = [];

  let workflow = await readWorkflow(input.client, toolCalls);
  workflowStages.push(sanitizeGuidance(workflow.operatorGuidance));

  for (let transition = 0; transition < MAX_TRANSITIONS; transition += 1) {
    const action = workflow.operatorGuidance.nextAction;
    if (action === "none") {
      const auditEvents = sanitizeAuditEvents(
        await input.deps.audits.list(TICKET_ID),
      );
      const report = {
        toolCalls,
        aiStages,
        workflowStages,
        approvals,
        finalTicketStatus: workflow.ticket.status,
        auditEvents,
      };
      return { ...report, serialized: serializeReport(report) };
    }

    switch (action) {
      case "evaluate-ticket": {
        const evaluated = await callTool(input.client, toolCalls, "evaluate_ticket", {
          ticketId: TICKET_ID,
          actor: "skill-showcase",
          responseStyle: "auto",
          aiPreference:
            input.mode === "deterministic" ? "deterministic" : "gpt-preferred",
        });
        const recommendation = TriageRecommendationSchema.parse(
          evaluated.recommendation,
        );
        const trace = recommendation.aiExecutionTrace;
        if (trace === undefined) {
          throw new Error("evaluate_ticket did not return the required AI trace.");
        }
        aiStages.push(AiExecutionTraceSchema.parse(trace));
        break;
      }
      case "review-recommendation": {
        const recommendation = workflow.latestRecommendation;
        if (recommendation === undefined) {
          throw new Error("Review guidance did not include a recommendation.");
        }
        const fields = [...workflow.operatorGuidance.approval.fields];
        await callTool(input.client, toolCalls, "mark_response_done", {
          recommendationId: recommendation.id,
          ticketId: TICKET_ID,
          expectedRevision: workflow.ticket.revision,
          approvedFields: fields,
          editedCustomerResponse: recommendation.draftCustomerResponse,
          actor: ACTOR,
          confirm: true,
        });
        approvals.push({
          required: true,
          fields,
          actor: ACTOR,
        });
        break;
      }
      case "record-diagnosis":
        await callTool(input.client, toolCalls, "record_diagnosis", {
          ticketId: TICKET_ID,
          actor: "product-support",
        });
        break;
      case "mark-fix-available":
        await callTool(input.client, toolCalls, "mark_fix_available", {
          ticketId: TICKET_ID,
          actor: "product-support",
        });
        break;
      case "close-ticket":
        await callTool(input.client, toolCalls, "close_ticket", {
          ticketId: TICKET_ID,
          actor: ACTOR,
        });
        break;
      case "wait-for-customer":
        throw new Error(
          `Showcase fixture stopped while waiting for a customer reply. Stages: ${workflowStages.join(" -> ")}. Blockers: ${workflow.operatorGuidance.blockers.join(" | ")}`,
        );
    }

    workflow = await readWorkflow(input.client, toolCalls);
    workflowStages.push(sanitizeGuidance(workflow.operatorGuidance));
  }

  throw new Error("Showcase exceeded the bounded transition limit.");
}

function controlledProviders(): {
  classificationReasoningProvider: ClassificationReasoningProvider;
  draftProvider: CustomerResponseDraftProvider;
} {
  return {
    classificationReasoningProvider: {
      async reason(input) {
        const baseline = input.deterministicClassification;
        return {
          reasoning: {
            issueType: "campaign-editor-loading",
            candidateCategory: baseline.category,
            candidateTeam: baseline.team,
            candidatePriority: baseline.priority,
            knowledgeArticleIds: [...baseline.knowledgeArticleIds],
            confidence: baseline.confidence,
            evidence: [
              "Campaign editor loading evidence is consistent with the local classification.",
            ],
            missingEvidenceThatWouldChangeClassification: [],
            explanation:
              "Controlled local reasoning agrees with the governed deterministic result.",
          },
          telemetry: { model: "controlled-local", latencyMs: 0 },
        };
      },
    },
    draftProvider: {
      async draft(input) {
        return {
          source: "openai",
          response: ensureDraftSignOff(input.deterministicDraft, input),
          assist: buildDeterministicGptAssist(input, "openai", []),
          telemetry: { model: "controlled-local", latencyMs: 0 },
        };
      },
    },
  };
}

async function readWorkflow(
  client: Client,
  toolCalls: string[],
): Promise<WorkflowSnapshot> {
  const content = await callTool(client, toolCalls, "get_ticket_workflow", {
    id: TICKET_ID,
  });
  return WorkflowSnapshotSchema.parse(content);
}

async function callTool(
  client: Client,
  toolCalls: string[],
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  toolCalls.push(name);
  const result = (await client.callTool({
    name,
    arguments: args,
  })) as CallToolResult;
  if (result.isError === true || result.structuredContent === undefined) {
    throw new Error(`MCP tool ${name} failed.`);
  }
  return result.structuredContent;
}

function sanitizeAuditEvents(
  events: readonly AuditEvent[],
): SkillShowcaseReport["auditEvents"] {
  return events.map((event) => ({
    type: event.action,
    actor: event.actor,
    timestamp: event.timestamp,
  }));
}

function sanitizeGuidance(
  guidance: OperatorGuidance,
): SkillShowcaseReport["workflowStages"][number] {
  return { stage: guidance.stage, nextAction: guidance.nextAction };
}

function serializeReport(
  report: Omit<SkillShowcaseReport, "serialized">,
): string {
  const lines = [
    "# Codex Skill AI Showcase",
    "",
    `- Final ticket status: ${report.finalTicketStatus}`,
    "",
    "## Governed MCP tool calls",
    "",
    ...report.toolCalls.map((name, index) => `${index + 1}. \`${name}\``),
    "",
    "## AI execution traces",
    "",
    ...report.aiStages.map(
      (trace, index) => [
        `- Evaluation ${index + 1}: preference=${trace.preference}; classification=${trace.classification.status}; drafting=${trace.drafting.status}.`,
        ...(trace.classification.fallback === undefined
          ? []
          : [`  - Classification fallback: ${trace.classification.fallback.category}; ${trace.classification.fallback.message}`]),
        ...(trace.drafting.fallback === undefined
          ? []
          : [`  - Drafting fallback: ${trace.drafting.fallback.category}; ${trace.drafting.fallback.message}`]),
      ].join("\n"),
    ),
    "",
    "## Workflow stages",
    "",
    ...report.workflowStages.map(
      (stage) => `- ${stage.stage}: next guided action is \`${stage.nextAction}\`.`,
    ),
    "",
    "## Explicit approvals",
    "",
    ...report.approvals.map(
      (approval) =>
        `- Scripted portfolio-reviewer simulation: required=${approval.required}; fields=${approval.fields.join(",")}; actor=${approval.actor}.`,
    ),
    "",
    "## Parsed audit events",
    "",
    ...report.auditEvents.map(
      (event, index) =>
        `- ${index + 1}. type=${event.type}; actor=${event.actor}; timestamp=${event.timestamp}.`,
    ),
    "",
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const hasDeterministic = process.argv.includes("--deterministic");
  const hasLive = process.argv.includes("--live");
  if (hasDeterministic && hasLive) {
    throw new Error("Choose either --deterministic or --live, not both.");
  }
  const mode: SkillShowcaseMode = hasLive
    ? "live"
    : hasDeterministic
      ? "deterministic"
      : "controlled";
  const dataRoot = await mkdtemp(join(tmpdir(), "skill-showcase-"));
  try {
    const report = await runSkillShowcase({
      root: process.cwd(),
      dataRoot,
      mode,
    });
    process.stdout.write(`${report.serialized}\n`);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Showcase failed.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
