import { z } from "zod";
import {
  CategorySchema,
  PrioritySchema,
  TeamSchema,
  AiUsageSchema,
  type AiUsage,
} from "../domain.js";
import type {
  FetchLike,
  GptClassificationReasoning,
  GptClassificationReasoningInput,
} from "./draft-response-provider.js";
import {
  OpenAiTimeoutError,
  UnavailableOpenAiError,
} from "./draft-response-provider.js";

const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_TIMEOUT_MS = 20_000;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

function nullableOptional<T>(schema: z.ZodType<T>) {
  return schema.nullable().transform((value) => value ?? undefined).optional();
}

const ReasoningSchema = z.object({
  issueType: z.string().trim().min(1),
  candidateCategory: nullableOptional(CategorySchema),
  candidateTeam: nullableOptional(TeamSchema),
  candidatePriority: nullableOptional(PrioritySchema),
  knowledgeArticleIds: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().trim().min(1)),
  missingEvidenceThatWouldChangeClassification: z.array(z.string().trim().min(1)),
  explanation: z.string().trim().min(1).max(240),
}).strict();

export interface AiProviderTelemetry {
  model: string;
  latencyMs: number;
  usage?: AiUsage;
}

export interface ClassificationReasoningExecution {
  reasoning: GptClassificationReasoning;
  telemetry: AiProviderTelemetry;
}

export interface ClassificationReasoningProvider {
  reason(input: GptClassificationReasoningInput): Promise<ClassificationReasoningExecution>;
}

export class UnavailableClassificationReasoningProvider
  implements ClassificationReasoningProvider
{
  readonly unavailableReason = "OpenAI is not configured.";

  async reason(): Promise<never> {
    throw new UnavailableOpenAiError();
  }
}

export class OpenAiClassificationReasoningProvider
  implements ClassificationReasoningProvider
{
  constructor(private readonly options: {
    apiKey: string;
    model?: string;
    timeoutMs?: number;
    fetch?: FetchLike;
    now?: () => number;
  }) {}

  async reason(input: GptClassificationReasoningInput): Promise<ClassificationReasoningExecution> {
    const model = this.options.model ?? DEFAULT_MODEL;
    const now = this.options.now ?? Date.now;
    const startedAt = now();
    const envelope = await requestReasoning({
      apiKey: this.options.apiKey,
      model,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fetch: this.options.fetch ?? fetch,
      input,
    });
    return {
      reasoning: ReasoningSchema.parse(JSON.parse(envelope.outputText)),
      telemetry: {
        model,
        latencyMs: Math.max(0, now() - startedAt),
        ...(envelope.usage === undefined ? {} : { usage: envelope.usage }),
      },
    };
  }
}

export function createClassificationReasoningProviderFromEnv(
  env: NodeJS.ProcessEnv,
  options: { preferOpenAi: boolean },
): ClassificationReasoningProvider | undefined {
  if (!options.preferOpenAi) return undefined;
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return new UnavailableClassificationReasoningProvider();
  return new OpenAiClassificationReasoningProvider({
    apiKey,
    model: env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
  });
}

async function requestReasoning(input: {
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetch: FetchLike;
  input: GptClassificationReasoningInput;
}): Promise<{ outputText: string; usage?: AiUsage }> {
  const abortController = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const response = await Promise.race([
    input.fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`,
      },
      signal: abortController.signal,
      body: JSON.stringify({
        model: input.model,
        instructions: "Classify the support ticket using only the provided context. Return structured advisory reasoning without operational actions.",
        input: buildReasoningInput(input.input),
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "classification_reasoning",
            strict: true,
            schema: reasoningJsonSchema,
          },
        },
      }),
    }),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        abortController.abort();
        reject(new OpenAiTimeoutError());
      }, input.timeoutMs);
    }),
  ]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
  const raw = await response.text();
  if (!response.ok) throw new Error("OpenAI classification request failed.");
  const parsed = z.object({
    output: z.array(z.object({
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
    })),
    usage: z.object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
      total_tokens: z.number().int().nonnegative(),
    }).optional(),
  }).passthrough().parse(JSON.parse(raw));
  const outputText = parsed.output
    .flatMap((item) => item.content)
    .find((content) => content.type === "output_text")?.text;
  if (outputText === undefined) throw new Error("OpenAI classification response did not include output text.");
  const usage = parsed.usage === undefined ? undefined : AiUsageSchema.parse({
    inputTokens: parsed.usage.input_tokens,
    outputTokens: parsed.usage.output_tokens,
    totalTokens: parsed.usage.total_tokens,
  });
  return { outputText, ...(usage === undefined ? {} : { usage }) };
}

function buildReasoningInput(input: GptClassificationReasoningInput): string {
  return JSON.stringify({
    ticket: {
      id: input.ticket.id,
      customer: input.ticket.customer,
      requester: input.ticket.requester,
      subject: input.ticket.subject,
      description: input.ticket.description,
      tags: input.ticket.tags,
    },
    conversationText: input.conversationContext.combinedText,
    deterministicClassification: {
      category: input.deterministicClassification.category,
      team: input.deterministicClassification.team,
      priority: input.deterministicClassification.priority,
      knowledgeArticleIds: input.deterministicClassification.knowledgeArticleIds,
      confidence: input.deterministicClassification.confidence,
    },
  });
}

const reasoningJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    issueType: { type: "string" },
    candidateCategory: { type: ["string", "null"] },
    candidateTeam: { type: ["string", "null"] },
    candidatePriority: { type: ["string", "null"] },
    knowledgeArticleIds: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
    evidence: { type: "array", items: { type: "string" } },
    missingEvidenceThatWouldChangeClassification: { type: "array", items: { type: "string" } },
    explanation: { type: "string" },
  },
  required: [
    "issueType",
    "candidateCategory",
    "candidateTeam",
    "candidatePriority",
    "knowledgeArticleIds",
    "confidence",
    "evidence",
    "missingEvidenceThatWouldChangeClassification",
    "explanation",
  ],
};
