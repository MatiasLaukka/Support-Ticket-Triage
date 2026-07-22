# Codex Skill AI Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Codex support-ticket Skill optional, auditable GPT classification and drafting, backend-owned next-step guidance, and a repeatable diagnosis-to-closure showcase.

**Architecture:** Introduce strict AI trace contracts and a shared `evaluateTicketWithAi` orchestrator used by both Approval Desk HTTP and MCP. Keep GPT classification advisory and GPT drafting guarded, persist both stage traces with each recommendation, derive operator guidance from persisted workflow state, and exercise the whole contract through an isolated TKT-1010 showcase.

**Tech Stack:** TypeScript 6, Node.js 20.19+/22.12+/24+, Zod 4, MCP TypeScript SDK, Vitest 4, OpenAI Responses API, local JSON/Markdown fixture repositories.

## Global Constraints

- `aiPreference` values are exactly `auto`, `gpt-preferred`, and `deterministic`; the backward-compatible default is `auto`.
- GPT classification remains capped advisory evidence. Deterministic classification, escalation, lifecycle, approval, diagnosis, fix, and closure rules remain authoritative.
- GPT drafting receives only trusted structured context and always passes deterministic validation before storage.
- Missing credentials, timeout, provider error, invalid schema, or guardrail rejection must return a safe deterministic recommendation rather than aborting evaluation.
- Persist only sanitized fallback categories: `not-configured`, `timeout`, `provider-error`, `invalid-schema`, and `guardrail-rejected`.
- Never persist or return raw prompts, API keys, authorization headers, raw provider payloads, stack traces, filesystem paths, or unsanitized provider errors.
- Maximum customer-response lengths are: concise 140 words, balanced 240, empathetic 280, technical 340, executive-update 200.
- Automated tests and the default showcase make no live OpenAI requests.
- Every customer response and ticket mutation still requires explicit approval of named fields.
- Reuse `record_diagnosis`, `mark_fix_available`, and `close_ticket`; do not add replacement lifecycle tools.

---

## Planned File Structure

- Create `src/approval-desk/classification-reasoning-provider.ts` for the OpenAI classification-reasoning adapter and environment factory.
- Create `src/approval-desk/ai-evaluation.ts` for shared deterministic + optional GPT orchestration.
- Create `src/approval-desk/draft-quality-guardrails.ts` for word limits and relevant-request validation.
- Create `src/approval-desk/workflow-guidance.ts` for pure lifecycle preconditions and operator guidance.
- Create `scripts/demo-skill-showcase.ts` for the isolated MCP journey and sanitized report.
- Create `test/classification-reasoning-provider.test.ts`, `test/ai-evaluation.test.ts`, `test/draft-quality-guardrails.test.ts`, `test/workflow-guidance.test.ts`, and `test/demo-skill-showcase.test.ts` for focused coverage.
- Create `.agents/skills/triaging-support-tickets/references/ai-workflow.md` for trace interpretation and next-step presentation rules.
- Modify `src/domain.ts` and `src/triage-service.ts` only for persisted AI trace contracts.
- Modify `src/approval-desk/draft-response-provider.ts` to return sanitized execution metadata and consume shared quality checks.
- Modify `src/approval-desk/http.ts` and `src/server.ts` to call shared orchestration and expose the Skill contract.
- Modify `src/approval-desk/workflow-read-model.ts` to include backend-owned guidance.
- Modify `.agents/skills/triaging-support-tickets/SKILL.md`, its `agents/openai.yaml`, README, and evaluation docs for the portfolio workflow.

---

### Task 1: Persist Strict Dual-Stage AI Trace Contracts

**Files:**
- Modify: `src/domain.ts`
- Modify: `src/triage-service.ts`
- Modify: `test/triage-service.test.ts`
- Test: `test/domain.test.ts`

**Interfaces:**
- Produces: `AiPreferenceSchema`, `AiFallbackCategorySchema`, `AiExecutionTraceSchema`, and inferred public types.
- Produces: optional `aiExecutionTrace?: AiExecutionTrace` on `TriageRecommendation` and `SubmitRecommendationInput`.
- Consumes: existing category, team, priority, classification signal, response source, and response style schemas.

- [ ] **Step 1: Add failing domain and persistence tests**

Add this case to `test/domain.test.ts`:

```ts
it("accepts a sanitized dual-stage AI execution trace", () => {
  const trace = AiExecutionTraceSchema.parse({
    preference: "gpt-preferred",
    classification: {
      status: "used",
      model: "gpt-5.6-luna",
      latencyMs: 125,
      usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160 },
      candidate: {
        issueType: "campaign-editor",
        category: "performance",
        team: "product",
        priority: "P2",
        knowledgeArticleIds: ["campaign-send-failures"],
        confidence: 0.9,
        explanation: "The editor content area does not finish loading.",
      },
      acceptedSignals: [{
        ruleId: "gpt-advisory-campaign-editor-category",
        target: "category:performance",
        weight: 4,
        reason: "The editor content area does not finish loading.",
      }],
      rejectedAdvice: [],
      deterministicOverrides: [],
      finalOutcome: {
        category: "performance",
        team: "product",
        priority: "P2",
        knowledgeArticleIds: ["campaign-send-failures"],
        confidence: 0.86,
        escalationReasons: [],
      },
    },
    drafting: {
      status: "used",
      source: "openai",
      model: "gpt-5.6-luna",
      requestedStyle: "auto",
      recommendedStyle: "empathetic",
      selectedStyle: "empathetic",
      checks: [{
        id: "style-word-limit",
        label: "Style word limit",
        status: "pass",
        message: "Draft is within the 280 word empathetic limit.",
      }],
    },
  });

  expect(trace.classification.status).toBe("used");
  expect(trace.drafting.source).toBe("openai");
});

it("rejects raw provider details and inconsistent token usage", () => {
  expect(() => AiExecutionTraceSchema.parse({
    preference: "gpt-preferred",
    classification: {
      status: "fallback",
      fallback: {
        category: "provider-error",
        message: "Request failed at C:\\private\\token.json with sk-secret",
      },
      acceptedSignals: [],
      rejectedAdvice: [],
      deterministicOverrides: [],
      finalOutcome: {
        category: "other",
        team: "support",
        priority: "P3",
        knowledgeArticleIds: [],
        confidence: 0.5,
        escalationReasons: ["low-confidence"],
      },
    },
    drafting: {
      status: "skipped",
      source: "deterministic",
      requestedStyle: "auto",
      recommendedStyle: "balanced",
      selectedStyle: "balanced",
      checks: [],
    },
  })).toThrow();
});
```

Import `AiExecutionTraceSchema` from `../src/domain.js`.

In `test/triage-service.test.ts`, extend the existing metadata-preservation submission test with:

```ts
const aiExecutionTrace = makeAiExecutionTrace();
const recommendation = await harness.service.submit(
  makeSubmitInput({ aiExecutionTrace }),
);
expect(recommendation.aiExecutionTrace).toEqual(aiExecutionTrace);
expect(harness.recommendations.values[0]?.aiExecutionTrace).toEqual(
  aiExecutionTrace,
);
```

Add a local `makeAiExecutionTrace()` helper using the valid object from the domain test.

- [ ] **Step 2: Run the focused tests and verify the red state**

Run:

```powershell
npm test -- --run test/domain.test.ts test/triage-service.test.ts
```

Expected: FAIL because `AiExecutionTraceSchema` and the submission property do not exist.

- [ ] **Step 3: Add the domain schemas and exported types**

Add to `src/domain.ts` after `ClassificationSignalSchema`:

```ts
export const AiPreferenceSchema = z.enum([
  "auto",
  "gpt-preferred",
  "deterministic",
]);

export const AiFallbackCategorySchema = z.enum([
  "not-configured",
  "timeout",
  "provider-error",
  "invalid-schema",
  "guardrail-rejected",
]);

const SanitizedAiMessageSchema = NonBlankStringSchema
  .max(240)
  .refine(
    (message) =>
      !/sk-[A-Za-z0-9_-]+|(?:[A-Za-z]:\\|\/home\/|\/Users\/)|authorization|bearer\s+/i.test(message),
    "AI trace messages must not contain credentials or machine paths.",
  );

export const AiUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
}).strict().refine(
  (usage) => usage.totalTokens === usage.inputTokens + usage.outputTokens,
  { message: "totalTokens must equal inputTokens plus outputTokens." },
);

export const AiGuardrailCheckSchema = z.object({
  id: SlugSchema,
  label: NonBlankStringSchema,
  status: z.enum(["pass", "warn", "fail"]),
  message: SanitizedAiMessageSchema,
}).strict();

const AiFallbackSchema = z.object({
  category: AiFallbackCategorySchema,
  message: SanitizedAiMessageSchema,
}).strict();

const AiClassificationCandidateSchema = z.object({
  issueType: NonBlankStringSchema,
  category: CategorySchema.optional(),
  team: TeamSchema.optional(),
  priority: PrioritySchema.optional(),
  knowledgeArticleIds: z.array(SlugSchema),
  confidence: z.number().min(0).max(1),
  explanation: SanitizedAiMessageSchema,
}).strict();

const AiFinalClassificationSchema = z.object({
  category: CategorySchema,
  team: TeamSchema,
  priority: PrioritySchema,
  knowledgeArticleIds: z.array(SlugSchema),
  confidence: z.number().min(0).max(1),
  escalationReasons: z.array(RequiredEscalationSchema),
}).strict();

export const AiExecutionTraceSchema = z.object({
  preference: AiPreferenceSchema,
  classification: z.object({
    status: z.enum(["skipped", "used", "fallback"]),
    model: NonBlankStringSchema.optional(),
    latencyMs: z.number().int().nonnegative().optional(),
    usage: AiUsageSchema.optional(),
    fallback: AiFallbackSchema.optional(),
    candidate: AiClassificationCandidateSchema.optional(),
    acceptedSignals: z.array(ClassificationSignalSchema),
    rejectedAdvice: z.array(z.object({
      target: NonBlankStringSchema,
      reason: SanitizedAiMessageSchema,
    }).strict()),
    deterministicOverrides: z.array(SanitizedAiMessageSchema),
    finalOutcome: AiFinalClassificationSchema,
  }).strict(),
  drafting: z.object({
    status: z.enum(["skipped", "used", "fallback"]),
    source: DraftCustomerResponseSourceSchema,
    model: NonBlankStringSchema.optional(),
    latencyMs: z.number().int().nonnegative().optional(),
    usage: AiUsageSchema.optional(),
    fallback: AiFallbackSchema.optional(),
    requestedStyle: DraftCustomerResponseStyleInputSchema,
    recommendedStyle: DraftCustomerResponseStyleSchema,
    selectedStyle: DraftCustomerResponseStyleSchema,
    checks: z.array(AiGuardrailCheckSchema),
  }).strict(),
}).strict();
```

Add `aiExecutionTrace: AiExecutionTraceSchema.optional()` to `TriageRecommendationSchema` immediately after `gptAssist`, then export:

```ts
export type AiPreference = z.infer<typeof AiPreferenceSchema>;
export type AiFallbackCategory = z.infer<typeof AiFallbackCategorySchema>;
export type AiUsage = z.infer<typeof AiUsageSchema>;
export type AiGuardrailCheck = z.infer<typeof AiGuardrailCheckSchema>;
export type AiExecutionTrace = z.infer<typeof AiExecutionTraceSchema>;
```

- [ ] **Step 4: Preserve the trace through submission**

In `src/triage-service.ts`:

```ts
import {
  AiExecutionTraceSchema,
  type AiExecutionTrace,
} from "./domain.js";
```

Add `aiExecutionTrace: AiExecutionTraceSchema.optional()` to `SubmitRecommendationInputSchema`, add `aiExecutionTrace?: AiExecutionTrace` to `SubmitRecommendationInput`, and add this property to the parsed recommendation object:

```ts
...(parsed.aiExecutionTrace === undefined
  ? {}
  : { aiExecutionTrace: parsed.aiExecutionTrace }),
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm test -- --run test/domain.test.ts test/triage-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the trace contracts**

```powershell
git add -- src/domain.ts src/triage-service.ts test/domain.test.ts test/triage-service.test.ts
git commit -m "feat: add auditable AI execution traces"
```

---

### Task 2: Add an OpenAI Classification-Reasoning Provider and Sanitized Telemetry

**Files:**
- Create: `src/approval-desk/classification-reasoning-provider.ts`
- Create: `test/classification-reasoning-provider.test.ts`
- Modify: `src/approval-desk/draft-response-provider.ts`
- Modify: `test/openai-draft-provider.test.ts`

**Interfaces:**
- Consumes: `GptClassificationReasoningInput` and existing Responses API configuration.
- Produces: `ClassificationReasoningExecution`, `OpenAiClassificationReasoningProvider`, and `createClassificationReasoningProviderFromEnv(env, { preferOpenAi })`.
- Produces: optional `telemetry` on `CustomerResponseDraft` and sanitized `fallback` metadata on `ValidatedCustomerResponseDraft`.

- [ ] **Step 1: Write provider red tests**

Create `test/classification-reasoning-provider.test.ts` with these cases:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  OpenAiClassificationReasoningProvider,
  createClassificationReasoningProviderFromEnv,
} from "../src/approval-desk/classification-reasoning-provider.js";
import { classifyTicketFromContext } from "../src/approval-desk/classifier.js";
import { buildConversationContextForTicket } from "../src/approval-desk/conversation-context.js";
import { TicketSchema } from "../src/domain.js";

const ticket = TicketSchema.parse({
  id: "TKT-1010",
  createdAt: "2026-06-10T09:00:00.000Z",
  updatedAt: "2026-06-10T09:00:00.000Z",
  customer: { name: "Acorn Services", plan: "Growth", region: "EU", vip: false },
  requester: {
    name: "Maya Chen",
    role: "Marketing Manager",
    department: "Marketing",
    technicalLevel: "non-technical",
    seniority: "manager",
  },
  subject: "Problem",
  description: "It does not work.",
  status: "new",
  tags: [],
  sla: { responseDueAt: "2026-06-10T13:00:00.000Z", breached: false },
  relatedTicketIds: [],
  revision: 0,
});

function providerInput() {
  const conversationContext = buildConversationContextForTicket({
    ticket,
    customerReplies: [{
      id: "reply-1",
      ticketId: ticket.id,
      createdAt: "2026-06-10T09:05:00.000Z",
      body: "The campaign editor content area never finishes loading.",
    }],
    previousSupportResponses: [],
  });
  return {
    ticket,
    conversationContext,
    deterministicClassification: classifyTicketFromContext(conversationContext),
  };
}

it("returns strict reasoning with model, latency, and token usage", async () => {
  const fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      output: [{ content: [{
        type: "output_text",
        text: JSON.stringify({
          issueType: "campaign-editor",
          candidateCategory: "performance",
          candidateTeam: "product",
          candidatePriority: "P2",
          knowledgeArticleIds: ["campaign-send-failures"],
          confidence: 0.9,
          evidence: ["content area never finishes loading"],
          missingEvidenceThatWouldChangeClassification: ["browser comparison"],
          explanation: "The reply describes editor loading failure.",
        }),
      }] }],
      usage: { input_tokens: 120, output_tokens: 40, total_tokens: 160 },
    }),
  }));
  const provider = new OpenAiClassificationReasoningProvider({
    apiKey: "sk-test",
    model: "gpt-5.6-luna",
    now: (() => {
      const values = [1000, 1125];
      return () => values.shift()!;
    })(),
    fetch,
  });

  const execution = await provider.reason(providerInput());

  expect(execution.reasoning).toMatchObject({
    issueType: "campaign-editor",
    candidateCategory: "performance",
    candidateTeam: "product",
  });
  expect(execution.telemetry).toEqual({
    model: "gpt-5.6-luna",
    latencyMs: 125,
    usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160 },
  });
  expect(JSON.parse(fetch.mock.calls[0]![1]!.body)).toMatchObject({ store: false });
});

it("uses no provider in deterministic mode and reports unavailable GPT preference", () => {
  expect(createClassificationReasoningProviderFromEnv({}, { preferOpenAi: false }))
    .toBeUndefined();
  expect(createClassificationReasoningProviderFromEnv({}, { preferOpenAi: true }))
    .toMatchObject({ unavailableReason: "OpenAI is not configured." });
});
```

In `test/openai-draft-provider.test.ts`, extend the successful response fixture with a `usage` object and assert:

```ts
expect(draft.telemetry).toEqual({
  model: "gpt-5.6-luna",
  latencyMs: expect.any(Number),
  usage: { inputTokens: 80, outputTokens: 30, totalTokens: 110 },
});
```

Add tests that an unavailable provider maps to `not-configured`, a timeout maps to `timeout`, a Zod/JSON parse failure maps to `invalid-schema`, and an HTTP failure maps to `provider-error`, with no raw error text in the returned fallback.

- [ ] **Step 2: Run focused provider tests**

Run:

```powershell
npm test -- --run test/classification-reasoning-provider.test.ts test/openai-draft-provider.test.ts
```

Expected: FAIL because the classification provider and telemetry do not exist.

- [ ] **Step 3: Implement the strict classification provider**

Create `src/approval-desk/classification-reasoning-provider.ts` with this public contract:

```ts
import { z } from "zod";
import {
  CategorySchema,
  PrioritySchema,
  TeamSchema,
  type AiUsage,
} from "../domain.js";
import type {
  FetchLike,
  GptClassificationReasoning,
  GptClassificationReasoningInput,
} from "./draft-response-provider.js";

const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_TIMEOUT_MS = 20_000;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const ReasoningSchema = z.object({
  issueType: z.string().trim().min(1),
  candidateCategory: CategorySchema.optional(),
  candidateTeam: TeamSchema.optional(),
  candidatePriority: PrioritySchema.optional(),
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
  implements ClassificationReasoningProvider {
  readonly unavailableReason = "OpenAI is not configured.";
  async reason(): Promise<never> {
    throw new Error(this.unavailableReason);
  }
}

export class OpenAiClassificationReasoningProvider
  implements ClassificationReasoningProvider {
  constructor(private readonly options: {
    apiKey: string;
    model?: string;
    timeoutMs?: number;
    fetch?: FetchLike;
    now?: () => number;
  }) {}

  async reason(input: GptClassificationReasoningInput): Promise<ClassificationReasoningExecution> {
    const model = this.options.model ?? DEFAULT_MODEL;
    const startedAt = (this.options.now ?? Date.now)();
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
        latencyMs: Math.max(0, (this.options.now ?? Date.now)() - startedAt),
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
```

Implement private `requestReasoning` using the same Responses API envelope pattern as `OpenAiCustomerResponseDraftProvider`: `store: false`, strict JSON schema, abort timeout, `output_text` extraction, and optional `usage` mapping. The request input must include only ticket ID/customer/requester/subject/description/tags, combined conversation text, and deterministic category/team/priority/knowledge/confidence; it must not include audit internals or credentials.

- [ ] **Step 4: Add draft telemetry and sanitized fallback classification**

In `src/approval-desk/draft-response-provider.ts`, import `AiFallbackCategory`, `AiUsage`, and `AiGuardrailCheck`. Extend:

```ts
export interface CustomerResponseDraft {
  source: DraftCustomerResponseSource;
  response: string;
  assist: GptAssist;
  telemetry?: {
    model: string;
    latencyMs: number;
    usage?: AiUsage;
  };
}

export interface ValidatedCustomerResponseDraft {
  source: DraftCustomerResponseSource;
  response: string;
  checks: DraftCustomerResponseCheck[];
  assist: GptAssist;
  telemetry?: CustomerResponseDraft["telemetry"];
  fallback?: {
    category: AiFallbackCategory;
    message: string;
  };
  candidateChecks: AiGuardrailCheck[];
}
```

Extend the environment factory without changing its default behavior:

```ts
export function createCustomerResponseDraftProviderFromEnv(
  env: NodeJS.ProcessEnv,
  options: {
    responseStyle?: DraftCustomerResponseStyleInput;
    preferOpenAi?: boolean;
  } = {},
): CustomerResponseDraftProvider | undefined {
  const configured = options.preferOpenAi === true
    ? "openai"
    : DraftProviderSchema.default("deterministic").parse(
        env.APPROVAL_DRAFT_PROVIDER,
      );
  if (configured === "deterministic") return undefined;
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return new UnavailableOpenAiDraftProvider();
  return new OpenAiCustomerResponseDraftProvider({
    apiKey,
    model: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
    timeoutMs: parseOpenAiDraftTimeoutMs(env.APPROVAL_DRAFT_TIMEOUT_MS),
    responseStyle: options.responseStyle ??
      DraftCustomerResponseStyleInputSchema.default("auto").parse(
        env.APPROVAL_RESPONSE_STYLE,
      ),
  });
}
```

Remove the old `GptClassificationReasoningProvider` interface from
`draft-response-provider.ts`; HTTP and MCP must import
`ClassificationReasoningProvider` from the new classification provider file.

Record model/latency/usage in `OpenAiCustomerResponseDraftProvider`. Replace raw-error fallback messages with:

```ts
export function classifyAiFailure(error: unknown): {
  category: AiFallbackCategory;
  message: string;
} {
  if (error instanceof UnavailableOpenAiError) {
    return { category: "not-configured", message: "OpenAI is not configured; deterministic output was used." };
  }
  if (error instanceof OpenAiTimeoutError) {
    return { category: "timeout", message: "OpenAI timed out; deterministic output was used." };
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return { category: "invalid-schema", message: "OpenAI returned invalid structured output; deterministic output was used." };
  }
  return { category: "provider-error", message: "OpenAI was unavailable; deterministic output was used." };
}
```

Use typed `UnavailableOpenAiError` and `OpenAiTimeoutError` classes instead of matching raw error strings. Return `candidateChecks: []` until Task 3 adds quality checks.

- [ ] **Step 5: Run provider tests**

Run:

```powershell
npm test -- --run test/classification-reasoning-provider.test.ts test/openai-draft-provider.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit provider support**

```powershell
git add -- src/approval-desk/classification-reasoning-provider.ts src/approval-desk/draft-response-provider.ts test/classification-reasoning-provider.test.ts test/openai-draft-provider.test.ts
git commit -m "feat: add bounded GPT classification provider"
```

---

### Task 3: Enforce Style Length and Relevant Information Requests

**Files:**
- Create: `src/approval-desk/draft-quality-guardrails.ts`
- Create: `test/draft-quality-guardrails.test.ts`
- Modify: `src/approval-desk/draft-response-provider.ts`
- Modify: `test/approval-desk-recommendation.test.ts`

**Interfaces:**
- Consumes: response text, resolved response style, evidence readiness, diagnosis context, and fix context.
- Produces: `validateDraftQuality(input): { checks: AiGuardrailCheck[]; blockingMessages: string[] }`.
- Produces: candidate `fail` checks in AI trace while persisted final draft checks remain `pass`/`warn` compatible.

- [ ] **Step 1: Add failing guardrail tests**

Create `test/draft-quality-guardrails.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateDraftQuality } from "../src/approval-desk/draft-quality-guardrails.js";

const evidenceReadiness = {
  supportState: "needs-information" as const,
  knownCause: null,
  requiredEvidence: [],
  providedEvidence: [],
  missingEvidence: [{
    id: "browser-version",
    label: "Browser version",
    customerQuestion: "Which browser and version are affected?",
    aliases: ["browser", "browser version"],
    source: "knowledge" as const,
  }],
  nextInvestigationSteps: ["Compare browser behavior."],
};

it("enforces the selected style word limit", () => {
  const result = validateDraftQuality({
    response: Array.from({ length: 141 }, () => "word").join(" "),
    style: "concise",
    evidenceReadiness,
  });
  expect(result.checks).toContainEqual(expect.objectContaining({
    id: "style-word-limit",
    status: "fail",
  }));
  expect(result.blockingMessages).toContain("The concise draft exceeds 140 words.");
});

it("allows questions for currently missing evidence", () => {
  const result = validateDraftQuality({
    response: "Please share the affected browser and browser version.",
    style: "balanced",
    evidenceReadiness,
  });
  expect(result.checks).toContainEqual(expect.objectContaining({
    id: "relevant-information-requests",
    status: "pass",
  }));
});

it("blocks a clear irrelevant information request", () => {
  const result = validateDraftQuality({
    response: "Please share your latest invoice number and billing address.",
    style: "balanced",
    evidenceReadiness,
  });
  expect(result.checks).toContainEqual(expect.objectContaining({
    id: "relevant-information-requests",
    status: "fail",
  }));
});

it("allows a trusted fix verification request", () => {
  const result = validateDraftQuality({
    response: "Please retry the campaign editor and confirm whether it loads.",
    style: "balanced",
    evidenceReadiness: { ...evidenceReadiness, missingEvidence: [] },
    fixContext: {
      status: "available",
      customerSafeSummary: "A frontend loading fix is available.",
      customerAction: "Retry the campaign editor.",
      verificationRequest: "Confirm whether the campaign editor loads.",
    },
  });
  expect(result.blockingMessages).toEqual([]);
});
```

In `test/approval-desk-recommendation.test.ts`, add a provider case returning an over-limit concise response and assert `draftCustomerResponseSource === "fallback"`, the candidate trace contains `style-word-limit: fail`, and the stored response is the deterministic draft.

- [ ] **Step 2: Run the guardrail tests**

Run:

```powershell
npm test -- --run test/draft-quality-guardrails.test.ts test/approval-desk-recommendation.test.ts
```

Expected: FAIL because `validateDraftQuality` and the new trace checks do not exist.

- [ ] **Step 3: Implement focused quality validation**

Create `src/approval-desk/draft-quality-guardrails.ts`:

```ts
import type {
  AiGuardrailCheck,
  DraftCustomerResponseStyle,
} from "../domain.js";
import type { DiagnosisContext, FixContext } from "../triage-service.js";
import type { EvidenceReadiness } from "./evidence-readiness.js";

const WORD_LIMITS: Record<DraftCustomerResponseStyle, number> = {
  concise: 140,
  balanced: 240,
  empathetic: 280,
  technical: 340,
  "executive-update": 200,
};

export function validateDraftQuality(input: {
  response: string;
  style: DraftCustomerResponseStyle;
  evidenceReadiness?: EvidenceReadiness;
  diagnosisContext?: DiagnosisContext;
  fixContext?: FixContext;
}): { checks: AiGuardrailCheck[]; blockingMessages: string[] } {
  const wordCount = input.response.trim().split(/\s+/).filter(Boolean).length;
  const limit = WORD_LIMITS[input.style];
  const lengthPassed = wordCount <= limit;
  const requestResult = classifyInformationRequests(input);
  const checks: AiGuardrailCheck[] = [
    {
      id: "style-word-limit",
      label: "Style word limit",
      status: lengthPassed ? "pass" : "fail",
      message: lengthPassed
        ? `Draft is within the ${limit} word ${input.style} limit.`
        : `The ${input.style} draft exceeds ${limit} words.`,
    },
    {
      id: "relevant-information-requests",
      label: "Relevant information requests",
      status: requestResult.status,
      message: requestResult.message,
    },
  ];
  return {
    checks,
    blockingMessages: checks
      .filter((check) => check.status === "fail")
      .map((check) => check.message),
  };
}
```

Implement `classifyInformationRequests` in the same file with explicit phrase extraction for `please share`, `please send`, `please provide`, `we need`, and `confirm whether`. Build allowed normalized phrases from missing-evidence ID/label/question/aliases, diagnosis `recommendedNextAction`, and fix `customerAction`/`verificationRequest`. Return `pass` for no request or an allowed match, `fail` for high-confidence billing/credential/account requests with no allowed match, and `warn` for an unmatched request that cannot be classified confidently. Do not classify greetings, acknowledgements, explanations, support-owned next actions, or sign-offs as requests.

- [ ] **Step 4: Integrate quality checks with provider fallback**

Pass `responseStyle`, `diagnosisContext`, and `fixContext` into `validateCustomerResponseDraft`. Merge `validateDraftQuality(...).checks` into `candidateChecks`. If any quality check is `fail`, return deterministic fallback with:

```ts
fallback: {
  category: "guardrail-rejected",
  message: "OpenAI output did not pass response guardrails; deterministic output was used.",
}
```

Map accepted `pass`/`warn` quality checks to the existing `DraftCustomerResponseCheck` shape for the final stored response. Validate deterministic drafts with the same quality function and keep any deterministic warning visible.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
npm test -- --run test/draft-quality-guardrails.test.ts test/approval-desk-recommendation.test.ts test/openai-draft-provider.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit drafting guardrails**

```powershell
git add -- src/approval-desk/draft-quality-guardrails.ts src/approval-desk/draft-response-provider.ts test/draft-quality-guardrails.test.ts test/approval-desk-recommendation.test.ts test/openai-draft-provider.test.ts
git commit -m "feat: guard GPT response quality"
```

---

### Task 4: Build the Shared AI Evaluation Orchestrator

**Files:**
- Create: `src/approval-desk/ai-evaluation.ts`
- Create: `test/ai-evaluation.test.ts`
- Modify: `src/approval-desk/recommendation-builder.ts`

**Interfaces:**
- Consumes: Task 1 trace schemas, Task 2 provider executions, Task 3 draft quality results, all local knowledge articles, and conversation/diagnosis/fix context.
- Produces: `evaluateTicketWithAi(input): Promise<Omit<SubmitRecommendationInput, "submittedAt">>`.
- Produces: a recommendation input containing final deterministic fields and `aiExecutionTrace`.

- [ ] **Step 1: Add red tests for both AI stages and independent fallback**

Create `test/ai-evaluation.test.ts` with fixture helpers loading TKT-1010 and local knowledge, then add:

```ts
it("uses GPT advice and drafting while preserving deterministic final authority", async () => {
  const input = await evaluateTicketWithAi({
    ticket: await loadSeedTicket("TKT-1010"),
    actor: "skill-showcase",
    allKnowledgeArticles: await loadKnowledgeArticles(),
    customerReplies: [campaignEditorReply],
    aiPreference: "gpt-preferred",
    responseStyle: "auto",
    classificationProvider: {
      async reason() {
        return {
          reasoning: {
            issueType: "campaign-editor",
            candidateCategory: "performance",
            candidateTeam: "product",
            candidatePriority: "P2",
            knowledgeArticleIds: ["campaign-send-failures"],
            confidence: 0.9,
            evidence: ["editor never finishes loading"],
            missingEvidenceThatWouldChangeClassification: [],
            explanation: "The reply describes a campaign editor loading failure.",
          },
          telemetry: { model: "gpt-stub", latencyMs: 1 },
        };
      },
    },
    draftProvider: acceptedDraftProvider,
  });

  expect(input).toMatchObject({
    category: "performance",
    team: "product",
    draftCustomerResponseSource: "openai",
    aiExecutionTrace: {
      preference: "gpt-preferred",
      classification: { status: "used", model: "gpt-stub" },
      drafting: { status: "used", source: "openai" },
    },
  });
  expect(input.classificationSignals).toEqual(expect.arrayContaining([
    expect.objectContaining({ target: "category:performance" }),
  ]));
});

it("keeps deterministic security routing when GPT suggests performance", async () => {
  const input = await evaluateTicketWithAi({
    ticket: securityTicket,
    actor: "skill-showcase",
    allKnowledgeArticles: await loadKnowledgeArticles(),
    customerReplies: [],
    aiPreference: "gpt-preferred",
    responseStyle: "auto",
    classificationProvider: misleadingPerformanceProvider,
    draftProvider: acceptedDraftProvider,
  });
  expect(input).toMatchObject({ category: "security", team: "security" });
  expect(input.aiExecutionTrace?.classification.deterministicOverrides)
    .toContain("Deterministic security policy retained security routing.");
});

it("falls back each AI stage independently", async () => {
  const input = await evaluateTicketWithAi({
    ticket: await loadSeedTicket("TKT-1010"),
    actor: "skill-showcase",
    allKnowledgeArticles: await loadKnowledgeArticles(),
    customerReplies: [campaignEditorReply],
    aiPreference: "gpt-preferred",
    responseStyle: "auto",
    classificationProvider: throwingClassificationProvider,
    draftProvider: acceptedDraftProvider,
  });
  expect(input.aiExecutionTrace).toMatchObject({
    classification: {
      status: "fallback",
      fallback: { category: "provider-error" },
    },
    drafting: { status: "used" },
  });
});
```

Add a deterministic preference case proving neither provider is called and both traces are `skipped`.

- [ ] **Step 2: Run the orchestrator tests**

Run:

```powershell
npm test -- --run test/ai-evaluation.test.ts
```

Expected: FAIL because `evaluateTicketWithAi` does not exist.

- [ ] **Step 3: Implement knowledge allowlisting and deterministic override reporting**

Create `src/approval-desk/ai-evaluation.ts` with:

```ts
export async function evaluateTicketWithAi(input: {
  ticket: Ticket;
  outcome?: ExpectedOutcome;
  actor: string;
  allKnowledgeArticles: readonly KnowledgeArticle[];
  customerReplies: readonly CustomerReply[];
  previousSupportResponse?: PreviousSupportResponse;
  diagnosisContext?: DiagnosisContext;
  fixContext?: FixContext;
  aiPreference: AiPreference;
  responseStyle: DraftCustomerResponseStyleInput;
  classificationProvider?: ClassificationReasoningProvider;
  draftProvider?: CustomerResponseDraftProvider;
}): Promise<Omit<SubmitRecommendationInput, "submittedAt">> {
  const conversationContext = buildConversationContextForTicket({
    ticket: input.ticket,
    customerReplies: input.customerReplies,
    previousSupportResponses: input.previousSupportResponse === undefined
      ? []
      : [input.previousSupportResponse],
  });
  const baseline = classifyTicketFromContext(conversationContext);
  const classificationExecution = await runClassificationStage({
    ...input,
    conversationContext,
    baseline,
  });
  const base = buildApprovalDeskRecommendationInput({
    ticket: input.ticket,
    outcome: input.outcome,
    actor: input.actor,
    customerReplies: input.customerReplies,
    previousSupportResponse: input.previousSupportResponse,
    advisoryClassificationSignals: classificationExecution.acceptedSignals,
    diagnosisContext: input.diagnosisContext,
    fixContext: input.fixContext,
  });
  const selectedKnowledge = input.allKnowledgeArticles.filter((article) =>
    base.knowledgeArticleIds.includes(article.id),
  );
  return buildApprovalDeskRecommendationInputWithDrafting({
    ticket: input.ticket,
    outcome: input.outcome,
    actor: input.actor,
    knowledgeArticles: selectedKnowledge,
    responseStyle: input.responseStyle,
    customerReplies: input.customerReplies,
    previousSupportResponse: input.previousSupportResponse,
    advisoryClassificationSignals: classificationExecution.acceptedSignals,
    diagnosisContext: input.diagnosisContext,
    fixContext: input.fixContext,
    draftProvider: input.aiPreference === "deterministic"
      ? undefined
      : input.draftProvider,
    aiPreference: input.aiPreference,
    classificationTrace: classificationExecution.trace,
  });
}
```

Implement `runClassificationStage` in the same file. Skip when preference is `deterministic`, when an expected outcome fixture is supplied, or when no provider exists in `auto`. For `gpt-preferred` with no usable provider, produce `not-configured` fallback. Allowlist proposed knowledge IDs against `allKnowledgeArticles`; put unknown targets in `rejectedAdvice`. Convert allowed reasoning through `advisorySignalsFromGptReasoning`, cap with the existing conversion, then compare the final deterministic result to the candidate to produce explicit override strings for security, outage, and other mismatches.

Use `classifyAiFailure` from Task 2 for sanitized classification fallback.

- [ ] **Step 4: Attach the drafting trace in the builder**

Extend `buildApprovalDeskRecommendationInputWithDrafting` input with:

```ts
aiPreference?: AiPreference;
classificationTrace?: AiExecutionTrace["classification"];
```

After `draftCustomerResponseWithFallback`, build:

```ts
const draftingTrace: AiExecutionTrace["drafting"] = {
  status: draft.source === "openai"
    ? "used"
    : draft.source === "fallback"
      ? "fallback"
      : "skipped",
  source: draft.source,
  ...(draft.telemetry ?? {}),
  ...(draft.fallback === undefined ? {} : { fallback: draft.fallback }),
  requestedStyle: input.responseStyle ?? "auto",
  recommendedStyle: draft.assist.recommendedTone,
  selectedStyle: draft.assist.selectedTone,
  checks: draft.candidateChecks,
};
```

Attach `aiExecutionTrace` only when `classificationTrace` is supplied:

```ts
aiExecutionTrace: {
  preference: input.aiPreference ?? "auto",
  classification: input.classificationTrace,
  drafting: draftingTrace,
},
```

- [ ] **Step 5: Run orchestrator and recommendation tests**

Run:

```powershell
npm test -- --run test/ai-evaluation.test.ts test/approval-desk-recommendation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit shared orchestration**

```powershell
git add -- src/approval-desk/ai-evaluation.ts src/approval-desk/recommendation-builder.ts test/ai-evaluation.test.ts test/approval-desk-recommendation.test.ts
git commit -m "feat: share governed AI ticket evaluation"
```

---

### Task 5: Give Approval Desk HTTP and MCP the Same AI Contract

**Files:**
- Modify: `src/approval-desk/http.ts`
- Modify: `src/approval-desk.ts`
- Modify: `src/server.ts`
- Modify: `src/index.ts`
- Modify: `test/approval-desk-http.test.ts`
- Modify: `test/server-actions.test.ts`
- Modify: `test/server-read.test.ts`

**Interfaces:**
- Consumes: `evaluateTicketWithAi`, provider factories, `AiPreferenceSchema`.
- Produces: `evaluate_ticket({ ticketId, actor, responseStyle, aiPreference })` with a persisted dual-stage trace.
- Produces: Approval Desk POST recommendation body parity with the same optional `aiPreference`.

- [ ] **Step 1: Add MCP and HTTP red tests**

In `test/server-actions.test.ts`, extend `connect` to accept partial AI providers and add:

```ts
it("runs both optional GPT stages through evaluate_ticket", async () => {
  const fixture = await createFixture();
  const client = await connect(fixture, {
    classificationReasoningProvider: campaignEditorClassificationProvider,
    draftProvider: acceptedDraftProvider,
  });
  await callTool(client, "add_customer_reply", {
    ticketId: "TKT-1001",
    actor: "Maya Chen",
    body: "The campaign editor content area never finishes loading.",
  });
  const evaluated = await callTool(client, "evaluate_ticket", {
    ticketId: "TKT-1001",
    actor: "skill-showcase",
    responseStyle: "auto",
    aiPreference: "gpt-preferred",
  });
  expect(evaluated.isError).not.toBe(true);
  expect(evaluated.structuredContent).toMatchObject({
    recommendation: {
      aiExecutionTrace: {
        preference: "gpt-preferred",
        classification: { status: "used" },
        drafting: { status: "used", source: "openai" },
      },
    },
  });
});

it("completes gpt-preferred evaluation without configured providers", async () => {
  const client = await connect(await createFixture(), {});
  const evaluated = await callTool(client, "evaluate_ticket", {
    ticketId: "TKT-1001",
    actor: "skill-showcase",
    aiPreference: "gpt-preferred",
  });
  expect(evaluated.isError).not.toBe(true);
  expect(evaluated.structuredContent).toMatchObject({
    recommendation: {
      aiExecutionTrace: {
        classification: { status: "fallback", fallback: { category: "not-configured" } },
        drafting: { status: "fallback", fallback: { category: "not-configured" } },
      },
    },
  });
});
```

Add strict invalid-input assertions for `aiPreference: "required"`.

In `test/approval-desk-http.test.ts`, add a test that identical injected providers and conversation input produce matching category/team/trace fields through HTTP and `evaluateTicketWithAi`.

- [ ] **Step 2: Run focused integration tests**

Run:

```powershell
npm test -- --run test/server-actions.test.ts test/server-read.test.ts test/approval-desk-http.test.ts
```

Expected: FAIL because the input schema and call sites do not use shared orchestration.

- [ ] **Step 3: Replace HTTP recommendation orchestration**

In `src/approval-desk/http.ts`, add `aiPreference: AiPreferenceSchema.default("auto")` to the recommendation body schema. Replace the local deterministic-classification/GPT-reasoning/builder block with:

```ts
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
```

Remove duplicated advisory-signal orchestration imports and code.

- [ ] **Step 4: Extend MCP dependencies and input**

In `src/server.ts`, import the shared orchestrator and provider types. Extend:

```ts
const EvaluateTicketInputSchema = z.object({
  ticketId: TicketIdSchema,
  actor: NonBlankStringSchema.default("approval-desk"),
  responseStyle: DraftCustomerResponseStyleInputSchema.default("auto"),
  aiPreference: AiPreferenceSchema.default("auto"),
}).strict();

export interface TriageServerDependencies {
  tickets: TicketRepository;
  knowledge: KnowledgeRepository;
  recommendations: RecommendationRepository;
  audits: AuditRepository;
  service: TriageService;
  now: () => Date;
  minutesPerAcceptedRecommendation?: number;
  classificationReasoningProvider?: ClassificationReasoningProvider;
  draftProvider?: CustomerResponseDraftProvider;
  env?: NodeJS.ProcessEnv;
}
```

Replace `evaluateTicket` recommendation construction with:

```ts
const recommendationInput = await evaluateTicketWithAi({
  ticket,
  actor: input.actor,
  allKnowledgeArticles: await deps.knowledge.list(),
  customerReplies,
  previousSupportResponse,
  diagnosisContext: latestDiagnosisContext(audits),
  fixContext: latestFixContext(audits),
  aiPreference: input.aiPreference,
  responseStyle: input.responseStyle,
  classificationProvider:
    deps.classificationReasoningProvider ??
    createClassificationReasoningProviderFromEnv(deps.env ?? process.env, {
      preferOpenAi: input.aiPreference === "gpt-preferred" ||
        (deps.env ?? process.env).APPROVAL_DRAFT_PROVIDER === "openai",
    }),
  draftProvider:
    deps.draftProvider ??
    createCustomerResponseDraftProviderFromEnv(deps.env ?? process.env, {
      responseStyle: input.responseStyle,
      preferOpenAi: input.aiPreference === "gpt-preferred",
    }),
});
```

Keep `submit_triage_recommendation` unchanged as the lower-level manual proposal tool.

- [ ] **Step 5: Run parity tests**

Run:

```powershell
npm test -- --run test/server-actions.test.ts test/server-read.test.ts test/approval-desk-http.test.ts test/ai-evaluation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit interface parity**

```powershell
git add -- src/approval-desk/http.ts src/approval-desk.ts src/server.ts src/index.ts test/approval-desk-http.test.ts test/server-actions.test.ts test/server-read.test.ts
git commit -m "feat: expose AI evaluation through MCP"
```

---

### Task 6: Return Backend-Owned Operator Guidance

**Files:**
- Create: `src/approval-desk/workflow-guidance.ts`
- Create: `test/workflow-guidance.test.ts`
- Modify: `src/approval-desk/workflow-read-model.ts`
- Modify: `src/server.ts`
- Modify: `test/server-actions.test.ts`
- Modify: `test/server-read.test.ts`

**Interfaces:**
- Produces: `OperatorGuidanceSchema`, `OperatorGuidance`, `buildOperatorGuidance(input)`, and shared diagnosis/fix/close blocker functions.
- Produces: `operatorGuidance` in `get_ticket_workflow` and `evaluate_ticket` outputs.
- Consumes: persisted ticket, recommendation history, audits, and existing service gates.

- [ ] **Step 1: Add red guidance tests for every stage**

Create `test/workflow-guidance.test.ts` with table-driven fixtures:

```ts
it.each([
  ["active", emptyWorkflow(), "evaluate-ticket", false],
  ["review", pendingRecommendationWorkflow(), "review-recommendation", true],
  ["customer-replied", repliedWorkflow(), "evaluate-ticket", false],
  ["diagnosis-ready", diagnosisReadyWorkflow(), "record-diagnosis", false],
  ["fix-ready", confirmedEngineeringDiagnosisWorkflow(), "mark-fix-available", false],
  ["verification", fixResponsePendingWorkflow(), "review-recommendation", true],
  ["ready-for-close", closingResponseSentWorkflow(), "close-ticket", false],
  ["closed", resolvedWorkflow(), "none", false],
] as const)("returns %s guidance", (_name, input, nextAction, approvalRequired) => {
  const guidance = buildOperatorGuidance(input);
  expect(guidance.nextAction).toBe(nextAction);
  expect(guidance.approval.required).toBe(approvalRequired);
  expect(guidance.reason).not.toBe("");
  expect(guidance.blockers).toEqual(expect.any(Array));
});

it("names exact fields awaiting approval", () => {
  const guidance = buildOperatorGuidance(pendingRecommendationWorkflow());
  expect(guidance.approval).toEqual({
    required: true,
    fields: ["category", "priority", "team", "customerResponse"],
  });
  expect(guidance.unlocksTool).toBe("mark_response_done");
});
```

In `test/server-actions.test.ts`, assert `evaluate_ticket` returns `operatorGuidance.nextAction === "review-recommendation"` and exact fields. In `test/server-read.test.ts`, assert `get_ticket_workflow` changes guidance after customer reply, diagnosis, fix, and closure fixtures.

- [ ] **Step 2: Run guidance tests**

Run:

```powershell
npm test -- --run test/workflow-guidance.test.ts test/server-actions.test.ts test/server-read.test.ts
```

Expected: FAIL because guidance is not returned.

- [ ] **Step 3: Implement pure preconditions and guidance**

Create `src/approval-desk/workflow-guidance.ts`:

```ts
export const OperatorGuidanceSchema = z.object({
  stage: z.enum([
    "active", "review", "waiting-customer", "customer-replied",
    "diagnosis-ready", "diagnosis-recorded", "fix-ready",
    "verification", "ready-for-close", "closed",
  ]),
  changed: z.string().trim().min(1),
  nextAction: z.enum([
    "evaluate-ticket", "review-recommendation", "wait-for-customer",
    "record-diagnosis", "mark-fix-available", "close-ticket", "none",
  ]),
  reason: z.string().trim().min(1),
  approval: z.object({
    required: z.boolean(),
    fields: z.array(ApprovedFieldSchema),
  }).strict(),
  unlocksTool: z.enum([
    "evaluate_ticket", "mark_response_done", "record_diagnosis",
    "mark_fix_available", "close_ticket",
  ]).optional(),
  blockers: z.array(z.string().trim().min(1)),
  customerNextStep: z.string().trim().min(1).optional(),
}).strict();

export type OperatorGuidance = z.infer<typeof OperatorGuidanceSchema>;

export function buildOperatorGuidance(input: {
  ticket: Ticket;
  recommendations: readonly TriageRecommendation[];
  audits: readonly AuditEvent[];
}): OperatorGuidance;
```

Implement the function with this precedence table; the first matching row wins:

| Condition | Stage | Next action | Approval | Unlocks |
| --- | --- | --- | --- | --- |
| ticket is resolved | `closed` | `none` | none | none |
| latest is `ready-for-close` and its response was sent | `ready-for-close` | `close-ticket` | none | `close_ticket` |
| latest recommendation is pending | `review` | `review-recommendation` | changed fields plus `customerResponse` | `mark_response_done` |
| latest customer reply is newer than latest recommendation | `customer-replied` | `evaluate-ticket` | none | `evaluate_ticket` |
| confirmed engineering/integration diagnosis has no newer fix | `fix-ready` | `mark-fix-available` | none | `mark_fix_available` |
| sent latest recommendation satisfies diagnosis preconditions | `diagnosis-ready` | `record-diagnosis` | none | `record_diagnosis` |
| latest response was sent and no newer reply exists | `waiting-customer` | `wait-for-customer` | none | none |
| otherwise | `active` | `evaluate-ticket` | none | `evaluate_ticket` |

Implement and export `diagnosisBlockers`, `fixBlockers`, and `closeBlockers` as pure functions in this file using the exact conditions currently enforced by the private MCP action functions. Replace those private condition blocks in `src/server.ts` with calls to the shared blocker functions so guidance and enforcement cannot drift. Map the first blocker to the existing `DomainError` messages and codes.

For pending recommendations, derive proposed approval fields by comparing category/priority/team/assignee/status/tags with the current ticket and always include `customerResponse`; do not ask approval for unchanged fields.

- [ ] **Step 4: Attach guidance to read and evaluate outputs**

In `buildTicketWorkflowReadModel`, append:

```ts
operatorGuidance: buildOperatorGuidance(input),
```

Add `OperatorGuidanceSchema` to `TicketWorkflowOutputSchema`. Create a distinct MCP schema:

```ts
const EvaluateTicketOutputSchema = z.object({
  recommendation: TriageRecommendationSchema,
  operatorGuidance: OperatorGuidanceSchema,
}).strict();
```

After submitting the recommendation, re-read ticket/audits/recommendations and return both the recommendation and `buildOperatorGuidance(...)`. Keep `submit_triage_recommendation` on its original output schema.

- [ ] **Step 5: Run guidance and lifecycle regression tests**

Run:

```powershell
npm test -- --run test/workflow-guidance.test.ts test/server-actions.test.ts test/server-read.test.ts test/approval-desk-http.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit backend guidance**

```powershell
git add -- src/approval-desk/workflow-guidance.ts src/approval-desk/workflow-read-model.ts src/server.ts test/workflow-guidance.test.ts test/server-actions.test.ts test/server-read.test.ts
git commit -m "feat: guide each governed workflow step"
```

---

### Task 7: Update the Codex Skill for Dual AI Traces and Next Steps

**Required sub-skills for this task:** Read and follow `skill-creator` and `superpowers:writing-skills` before editing Skill files.

**Files:**
- Modify: `.agents/skills/triaging-support-tickets/SKILL.md`
- Create: `.agents/skills/triaging-support-tickets/references/ai-workflow.md`
- Modify: `.agents/skills/triaging-support-tickets/agents/openai.yaml`
- Modify: `test/skill.test.ts`
- Modify: `docs/skill-evaluation.md`

**Interfaces:**
- Consumes: `aiPreference: "gpt-preferred"`, `aiExecutionTrace`, and `operatorGuidance` from Tasks 1-6.
- Produces: concise Skill behavior that reports AI advice versus deterministic outcome and always presents Customer next step and Your next step.

- [ ] **Step 1: Add failing Skill structure tests**

In `test/skill.test.ts`, extend the main workflow test:

```ts
expect(body).toContain("aiPreference: gpt-preferred");
expect(body).toMatch(/classification trace/i);
expect(body).toMatch(/drafting trace/i);
expect(body).toMatch(/deterministic (?:decision|outcome).*GPT advice/is);
expect(body).toContain("Customer next step");
expect(body).toContain("Your next step");
expect(body).toContain("references/ai-workflow.md");
```

Add:

```ts
it("documents auditable AI fallback without weakening approval", () => {
  const reference = readRequired(resolve(skillRoot, "references", "ai-workflow.md"));
  expect(reference).toMatch(/gpt-preferred/i);
  expect(reference).toMatch(/not-configured.*timeout.*provider-error.*invalid-schema.*guardrail-rejected/is);
  expect(reference).toMatch(/GPT.*advisory.*deterministic.*final/is);
  expect(reference).toMatch(/never.*raw prompts.*API keys.*provider payloads/is);
  expect(reference).toMatch(/Customer next step.*Your next step/is);
});
```

Update the file-count assertion from three to four Skill files and include the new reference in the placeholder scan.

- [ ] **Step 2: Run the Skill tests**

Run:

```powershell
npm test -- --run test/skill.test.ts
```

Expected: FAIL because the Skill and AI reference do not contain the new contract.

- [ ] **Step 3: Update the concise Skill workflow**

Keep `SKILL.md` below 700 words. Replace its evaluation/presentation steps with this exact behavior:

```markdown
5. Evaluate the current timeline with `evaluate_ticket`, using `aiPreference: gpt-preferred` and `responseStyle: auto` unless the user requested a manual style. Do not hand-build recommendation JSON. GPT failure is not workflow failure: use and report the deterministic fallback returned by the tool.
6. Read the classification trace as advisory evidence: report GPT candidates, accepted signals, rejected advice, deterministic overrides, and the final deterministic category, priority, team, knowledge, confidence, and escalation result.
7. Read the drafting trace: report actual source, selected style, sanitized fallback category, and guardrail warnings. Present the customer response and proposed ticket fields.
8. End every workflow update with `Customer next step:` and `Your next step:` using backend `operatorGuidance`. Name exact fields awaiting approval. Stop at every human gate.
```

Link `references/ai-workflow.md` beside the existing policy reference. Preserve the existing hard stops and lifecycle tool conditions.

- [ ] **Step 4: Add the AI workflow reference and default prompt**

Create `references/ai-workflow.md` with these sections:

```markdown
# Auditable AI Workflow

## Two AI Stages
Classification advice is bounded evidence. The deterministic classifier owns the final stored outcome. Drafting may polish trusted content but must pass every response guardrail.

## Reporting Template
- Classification trace: attempted/skipped/fallback; GPT candidates; accepted/rejected advice; deterministic overrides; final outcome.
- Drafting trace: attempted/skipped/fallback; source; style; guardrail result.
- Customer next step: copy the backend-owned customer action in plain language.
- Your next step: copy the backend-owned operator action, approval fields, blockers, and unlocked tool.

## Safe Fallback
Report only `not-configured`, `timeout`, `provider-error`, `invalid-schema`, or `guardrail-rejected`. Never expose raw prompts, API keys, authorization data, provider payloads, internal paths, or raw provider errors.

## Human Gates
AI traces explain a recommendation; they never authorize approval, diagnosis, fix, sending, or closure. Stop whenever `operatorGuidance.approval.required` is true.
```

Update `agents/openai.yaml` default prompt to request an end-to-end governed evaluation with `gpt-preferred`, dual trace reporting, and a stop at the first approval gate.

- [ ] **Step 5: Update the evaluation document honestly**

Add a `Codex Skill AI Showcase Contract` section to `docs/skill-evaluation.md` that distinguishes structural tests, controlled MCP integration tests, the saved showcase replay, and a live Codex run. Retain existing historical RED/GREEN evidence; do not rewrite captured responses as live traces.

- [ ] **Step 6: Run Skill validation**

Run:

```powershell
npm test -- --run test/skill.test.ts
```

Then locate and run the installed official Skill `quick_validate.py` against `.agents/skills/triaging-support-tickets` using the workspace Python runtime. Expected: both checks PASS. If the official validator is unavailable, record its exact unavailability in `docs/skill-evaluation.md` and keep the TypeScript structural test result.

- [ ] **Step 7: Commit Skill behavior**

```powershell
git add -- .agents/skills/triaging-support-tickets/SKILL.md .agents/skills/triaging-support-tickets/references/ai-workflow.md .agents/skills/triaging-support-tickets/agents/openai.yaml test/skill.test.ts docs/skill-evaluation.md
git commit -m "feat: guide auditable AI ticket workflows"
```

---

### Task 8: Add the Resettable TKT-1010 Skill Showcase

**Files:**
- Create: `scripts/demo-skill-showcase.ts`
- Create: `test/demo-skill-showcase.test.ts`
- Create: `docs/skill-showcase-example.md`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/demo-script.md`
- Modify: `docs/demo-results.md`

**Interfaces:**
- Consumes: MCP `evaluate_ticket`, workflow tools, dual traces, and operator guidance.
- Produces: `runSkillShowcase(options): Promise<SkillShowcaseReport>` and `npm run demo:skill-showcase`.
- Produces: `providersForMode(mode): Pick<TriageServerDependencies, "classificationReasoningProvider" | "draftProvider">`, `connectInMemory(server): Promise<Client>`, and `replayTkt1010(input): Promise<SkillShowcaseReport>` private helpers.
- Produces: a deterministic controlled-provider report plus explicitly enabled optional live mode.

- [ ] **Step 1: Add failing showcase tests**

Create `test/demo-skill-showcase.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSkillShowcase } from "../scripts/demo-skill-showcase.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("replays TKT-1010 through diagnosis, fix, verification, and closure", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "skill-showcase-"));
  roots.push(dataRoot);
  const report = await runSkillShowcase({
    root: resolve(import.meta.dirname, ".."),
    dataRoot,
    mode: "controlled",
  });

  expect(report.ticketId).toBe("TKT-1010");
  expect(report.toolCalls).toEqual(expect.arrayContaining([
    "get_ticket_workflow",
    "evaluate_ticket",
    "mark_response_done",
    "record_diagnosis",
    "mark_fix_available",
    "close_ticket",
  ]));
  expect(report.aiStages).toEqual(expect.arrayContaining([
    expect.objectContaining({ classification: "used", drafting: "used" }),
  ]));
  expect(report.workflowStages).toEqual(expect.arrayContaining([
    "review", "diagnosis-ready", "fix-ready", "verification", "ready-for-close", "closed",
  ]));
  expect(report.finalTicket).toMatchObject({ status: "resolved" });
  expect(report.serialized).not.toMatch(/sk-[A-Za-z0-9_-]+|authorization|raw prompt|[A-Za-z]:\\/i);
});

it("completes in deterministic mode with skipped AI traces", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "skill-showcase-"));
  roots.push(dataRoot);
  const report = await runSkillShowcase({
    root: resolve(import.meta.dirname, ".."),
    dataRoot,
    mode: "deterministic",
  });
  expect(report.aiStages.every((stage) =>
    stage.classification === "skipped" && stage.drafting === "skipped"
  )).toBe(true);
  expect(report.finalTicket.status).toBe("resolved");
});
```

- [ ] **Step 2: Run the showcase test**

Run:

```powershell
npm test -- --run test/demo-skill-showcase.test.ts
```

Expected: FAIL because the showcase module does not exist.

- [ ] **Step 3: Implement the isolated MCP showcase driver**

Create `scripts/demo-skill-showcase.ts` with exported types and entry point:

```ts
export interface SkillShowcaseReport {
  ticketId: "TKT-1010";
  mode: "controlled" | "deterministic" | "live";
  toolCalls: string[];
  aiStages: Array<{ classification: string; drafting: string }>;
  workflowStages: string[];
  approvals: Array<{ recommendationId: string; fields: string[]; actor: string }>;
  finalTicket: Ticket;
  auditEvents: AuditEvent[];
  serialized: string;
}

export async function runSkillShowcase(options: {
  root: string;
  dataRoot: string;
  mode: "controlled" | "deterministic" | "live";
}): Promise<SkillShowcaseReport> {
  const deps = await createRuntimeDependencies({
    cwd: options.root,
    env: {
      ...process.env,
      TRIAGE_DATA_ROOT: options.dataRoot,
      TRIAGE_SEED_FILE: resolve(options.root, "data/seed/tickets.json"),
      TRIAGE_KNOWLEDGE_ROOT: resolve(options.root, "data/knowledge"),
    },
  });
  const providers = providersForMode(options.mode);
  const client = await connectInMemory(createTriageServer({
    ...deps,
    ...providers,
    env: options.mode === "deterministic" ? {} : process.env,
  }));
  return replayTkt1010({ client, deps, mode: options.mode });
}
```

Implement `providersForMode("controlled")` with deterministic test doubles that return valid campaign-editor advice and compliant GPT drafts. `deterministic` passes no providers and calls `evaluate_ticket` with `aiPreference: "deterministic"`. `live` constructs providers from existing OpenAI environment configuration and refuses to start with a safe `OPENAI_API_KEY is required for live showcase mode.` message when the key is absent.

Implement `replayTkt1010` as a bounded state loop driven only by `operatorGuidance.nextAction`. For `review-recommendation`, record a synthetic portfolio reviewer decision and call `mark_response_done` with exactly `operatorGuidance.approval.fields`. For `record-diagnosis`, `mark-fix-available`, `evaluate-ticket`, and `close-ticket`, call the named MCP tool, then always call `get_ticket_workflow` again. Abort after 20 transitions with `Showcase exceeded the bounded transition limit.` so a regression cannot loop forever.

Serialize a report that includes only tool names, trace fields, approvals, stages, final ticket fields, and parsed audit events. Do not include MCP request payloads containing customer bodies or any provider request data.

- [ ] **Step 4: Add the package command and CLI output**

Add to `package.json`:

```json
"demo:skill-showcase": "node dist/scripts/demo-skill-showcase.js"
```

The script CLI defaults to controlled mode, accepts `--deterministic` or `--live`, creates a temporary data root, prints the sanitized Markdown report, and removes the temporary root in `finally`.

- [ ] **Step 5: Add saved evidence and documentation**

Run controlled mode once after building and save the exact sanitized report as `docs/skill-showcase-example.md`. Add README and `docs/demo-script.md` sections that show:

```powershell
npm run build
npm run demo:skill-showcase
```

and optional live mode:

```powershell
$env:OPENAI_API_KEY = 'set-in-the-shell-only'
npm run demo:skill-showcase -- --live
```

Explain the two GPT roles, deterministic overrides, fallback, human gates, and next-step guidance. Add the controlled report result and test command to `docs/demo-results.md`.

- [ ] **Step 6: Run showcase and documentation tests**

Run:

```powershell
npm test -- --run test/demo-skill-showcase.test.ts test/demo-approval-desk.test.ts test/skill.test.ts
npm run build
npm run demo:skill-showcase
```

Expected: tests PASS; the command exits 0 with TKT-1010 closed, both controlled AI stages reported, and no secret/path scan matches.

- [ ] **Step 7: Commit the showcase**

```powershell
git add -- scripts/demo-skill-showcase.ts test/demo-skill-showcase.test.ts docs/skill-showcase-example.md package.json README.md docs/demo-script.md docs/demo-results.md
git commit -m "feat: add Codex Skill AI showcase"
```

---

### Task 9: Full Verification, Security Scan, and Branch Hygiene

**Files:**
- Modify only when a failing check identifies a concrete defect in files changed by Tasks 1-8.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified build, typecheck,  full test suite, controlled showcase, deterministic showcase, clean secret scan, and clean worktree.

- [ ] **Step 1: Run focused AI and workflow tests**

```powershell
npm test -- --run test/domain.test.ts test/classification-reasoning-provider.test.ts test/openai-draft-provider.test.ts test/draft-quality-guardrails.test.ts test/ai-evaluation.test.ts test/workflow-guidance.test.ts test/server-actions.test.ts test/server-read.test.ts test/approval-desk-http.test.ts test/skill.test.ts test/demo-skill-showcase.test.ts
```

Expected: PASS with zero failed tests.

- [ ] **Step 2: Run the full build, typecheck, and test suite**

```powershell
npm test
```

Expected: build exits 0, typecheck exits 0, and every Vitest file passes.

- [ ] **Step 3: Run both offline showcase modes**

```powershell
npm run demo:skill-showcase
npm run demo:skill-showcase -- --deterministic
```

Expected: both exit 0 and finish TKT-1010 in `resolved`; controlled mode reports both AI stages `used`, deterministic mode reports both `skipped`.

- [ ] **Step 4: Scan tracked output for secret and machine-path leakage**

```powershell
rg -n "sk-[A-Za-z0-9_-]{8,}|authorization:|Bearer |[A-Za-z]:\\\\Users\\|/home/|raw prompt|raw provider" src scripts test docs .agents README.md
```

Expected: no credential, authorization, machine-path, raw-prompt, or raw-provider leakage. Test fixtures that intentionally assert redaction may match only inside test expectation patterns; inspect and document those lines before accepting them.

- [ ] **Step 5: Verify spec coverage explicitly**

Run:

```powershell
rg -n "aiPreference|aiExecutionTrace|classification.*trace|drafting.*trace|Customer next step|Your next step|record_diagnosis|mark_fix_available|close_ticket|style-word-limit|relevant-information-requests|demo:skill-showcase" src scripts test docs .agents README.md package.json
```

Expected: every acceptance-criteria term is present in implementation and tests, not only in the design or plan.

- [ ] **Step 6: Inspect worktree and recent commits**

```powershell
git status --short
git log --oneline --decorate -10
```

Expected: worktree is clean and commits correspond to Tasks 1-8.

- [ ] **Step 7: Commit verification fixes only when required**

If Steps 1-5 required a concrete code/test/documentation correction, stage only those corrected files and commit:

```powershell
git commit -m "fix: close Skill AI showcase verification gaps"
```

Do not create an empty verification commit.

---

## Self-Review

**Spec coverage:** Tasks 1-2 define auditable model preference, telemetry, fallback, and provider behavior. Tasks 3-5 add drafting quality, shared orchestration, GPT classification/drafting parity, and deterministic overrides. Task 6 adds backend-owned next steps. Task 7 updates the Codex Skill and honest evaluation evidence. Task 8 proves the full Diagnose/Fix/verification/closure journey. Task 9 verifies security, fallback, compatibility, and all acceptance criteria.

**Placeholder scan:** The plan contains no deferred implementation markers. Each code-changing task names exact files, public signatures, test code, commands, expected red/green results, and commit boundaries.

**Type consistency:** `AiPreference`, `AiExecutionTrace`, `ClassificationReasoningExecution`, `evaluateTicketWithAi`, `OperatorGuidance`, and `runSkillShowcase` use the same names and shapes in producer and consumer tasks. `evaluate_ticket` keeps `responseStyle` independent from `aiPreference`, and both HTTP and MCP consume the shared orchestrator.
