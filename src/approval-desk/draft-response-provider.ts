import { z } from "zod";
import {
  DraftCustomerResponseStyleInputSchema,
  DraftCustomerResponseStyleSchema,
} from "../domain.js";
import type {
  DraftCustomerResponseCheck,
  DraftCustomerResponseSource,
  ExpectedOutcome,
  GptAssist,
  KnowledgeArticle,
  Ticket,
  DraftCustomerResponseStyle,
  DraftCustomerResponseStyleInput,
} from "../domain.js";
import type { TicketClassification } from "./classifier.js";
import type { ConversationContext } from "./conversation-context.js";
import { GptAssistAudienceSchema } from "../domain.js";
import type { EvidenceReadiness } from "./evidence-readiness.js";
import { extractAccountFacts } from "./account-facts.js";
import type { DiagnosisContext, FixContext } from "../triage-service.js";
import {
  buildCustomerServiceDraftingInstructions,
  buildCustomerServiceSkillContext,
} from "./customer-service-drafting-skill.js";

const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";
const DEFAULT_OPENAI_DRAFT_TIMEOUT_MS = 20_000;
export const DEFAULT_SUPPORT_COMPANY_NAME = "Northstar Marketing Support";
const DEFAULT_SUPPORT_ACTOR = "Support Team";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DraftProviderSchema = z.enum(["deterministic", "openai"]);
const OpenAiDraftResponseSchema = z
  .object({
    draftCustomerResponse: z.string().trim().min(1),
    missingInfoSuggestions: z.array(z.string().trim().min(1)).min(1),
    investigationSteps: z.array(z.string().trim().min(1)).min(1),
    tone: DraftCustomerResponseStyleSchema,
    recommendedTone: DraftCustomerResponseStyleSchema,
    toneReason: z.string().trim().min(1),
    audience: GptAssistAudienceSchema,
  })
  .strict();

export interface CustomerResponseDraftInput {
  ticket: Ticket;
  outcome: ExpectedOutcome;
  knowledgeArticles: readonly KnowledgeArticle[];
  deterministicDraft: string;
  responseStyle: DraftCustomerResponseStyleInput;
  actor: string;
  companyName: string;
  evidenceReadiness?: EvidenceReadiness;
  conversationContext?: CustomerResponseConversationContext;
  diagnosisContext?: DiagnosisContext;
  fixContext?: FixContext;
}

export interface CustomerResponseConversationContext {
  turnType:
    | "first-contact"
    | "vague-follow-up"
    | "partial-follow-up"
    | "all-evidence"
    | "status-follow-up"
    | "explanation-request"
    | "customer-confirmed";
  hasCustomerReply: boolean;
  recognizedEvidenceProgress: boolean;
  latestCustomerReply?: {
    createdAt: string;
    body: string;
  };
  previousSupportResponse?: {
    sentAt: string;
    body: string;
  };
}

export interface CustomerResponseDraft {
  source: DraftCustomerResponseSource;
  response: string;
  assist: GptAssist;
}

export interface CustomerResponseDraftProvider {
  draft(input: CustomerResponseDraftInput): Promise<CustomerResponseDraft>;
}

export interface GptClassificationReasoning {
  issueType: string;
  candidateCategory?: string;
  candidateTeam?: string;
  candidatePriority?: string;
  knowledgeArticleIds: string[];
  confidence: number;
  evidence: string[];
  missingEvidenceThatWouldChangeClassification: string[];
  explanation: string;
}

export interface GptClassificationReasoningInput {
  ticket: Ticket;
  conversationContext: ConversationContext;
  deterministicClassification: TicketClassification;
}

export interface GptClassificationReasoningProvider {
  reason(
    input: GptClassificationReasoningInput,
  ): Promise<GptClassificationReasoning>;
}

export interface ValidatedCustomerResponseDraft {
  source: DraftCustomerResponseSource;
  response: string;
  checks: DraftCustomerResponseCheck[];
  assist: GptAssist;
}

export type FetchLike = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export class DeterministicCustomerResponseDraftProvider
  implements CustomerResponseDraftProvider
{
  async draft(input: CustomerResponseDraftInput): Promise<CustomerResponseDraft> {
    return {
      source: "deterministic",
      response: ensureDraftSignOff(input.deterministicDraft, input),
      assist: buildDeterministicGptAssist(input, "deterministic", [
        {
          id: "deterministic-local-assist",
          label: "Deterministic local assist",
          status: "pass",
          message: "Built from local rules without an external model call.",
        },
      ]),
    };
  }
}

export class UnavailableOpenAiDraftProvider
  implements CustomerResponseDraftProvider
{
  async draft(): Promise<CustomerResponseDraft> {
    throw new Error(
      "OpenAI drafting is enabled but OPENAI_API_KEY is not set.",
    );
  }
}

export class OpenAiCustomerResponseDraftProvider
  implements CustomerResponseDraftProvider
{
  constructor(
    private readonly options: {
      apiKey: string;
      model?: string;
      responseStyle?: DraftCustomerResponseStyleInput;
      timeoutMs?: number;
      fetch?: FetchLike;
    },
  ) {}

  async draft(input: CustomerResponseDraftInput): Promise<CustomerResponseDraft> {
    const fetchImpl = this.options.fetch ?? fetch;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_OPENAI_DRAFT_TIMEOUT_MS;
    const abortController = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const response = await Promise.race([
      fetchImpl(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.apiKey}`,
        },
        signal: abortController.signal,
        body: JSON.stringify({
          model: this.options.model ?? DEFAULT_OPENAI_MODEL,
          instructions: buildDraftInstructions(
            input.responseStyle ?? this.options.responseStyle ?? "balanced",
            formatDraftSignOff(input),
          ),
          input: buildDraftInput(input),
          store: false,
          text: {
            format: {
              type: "json_schema",
              name: "customer_response_draft",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  draftCustomerResponse: {
                    type: "string",
                    description:
                      "Customer-facing support response ready for human review.",
                  },
                  missingInfoSuggestions: {
                    type: "array",
                    minItems: 1,
                    items: { type: "string" },
                    description:
                      "Customer-safe details the reviewer may ask for.",
                  },
                  investigationSteps: {
                    type: "array",
                    minItems: 1,
                    items: { type: "string" },
                    description:
                      "Reviewer-facing checks to perform before the next update.",
                  },
                  tone: {
                    type: "string",
                    enum: [
                      "balanced",
                      "concise",
                      "empathetic",
                      "technical",
                      "executive-update",
                    ],
                    description: "Tone used for the draft response.",
                  },
                  recommendedTone: {
                    type: "string",
                    enum: [
                      "balanced",
                      "concise",
                      "empathetic",
                      "technical",
                      "executive-update",
                    ],
                    description:
                      "Best support tone for the requester and ticket context.",
                  },
                  toneReason: {
                    type: "string",
                    description:
                      "Brief reason for the recommended tone using trusted context.",
                  },
                  audience: {
                    type: "string",
                    enum: ["merchant-admin", "developer", "executive"],
                    description: "Likely reviewer/customer audience.",
                  },
                },
                required: [
                  "draftCustomerResponse",
                  "missingInfoSuggestions",
                  "investigationSteps",
                  "tone",
                  "recommendedTone",
                  "toneReason",
                  "audience",
                ],
              },
            },
          },
        }),
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          abortController.abort();
          reject(
            new Error(
              `OpenAI drafting request timed out after ${timeoutMs} ms.`,
            ),
          );
        }, timeoutMs);
      }),
    ]).finally(() => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(
        `OpenAI drafting request failed with ${response.status}${formatOpenAiErrorDetail(
          raw,
        )}.`,
      );
    }

    const parsed = OpenAiDraftResponseSchema.parse(
      JSON.parse(extractResponseText(JSON.parse(raw))),
    );
    const selectedTone =
      input.responseStyle === "auto" ? parsed.recommendedTone : input.responseStyle;
    return {
      source: "openai",
      response: ensureDraftSignOff(parsed.draftCustomerResponse, input),
      assist: {
        source: "openai",
        missingInfoSuggestions: parsed.missingInfoSuggestions,
        investigationSteps: parsed.investigationSteps,
        tone: selectedTone,
        recommendedTone: parsed.recommendedTone,
        selectedTone,
        toneReason: parsed.toneReason,
        audience: parsed.audience,
        checks: [],
      },
    };
  }
}

export function createCustomerResponseDraftProviderFromEnv(
  env: NodeJS.ProcessEnv,
  options: { responseStyle?: DraftCustomerResponseStyleInput } = {},
): CustomerResponseDraftProvider | undefined {
  const configured = DraftProviderSchema.default("deterministic").parse(
    env.APPROVAL_DRAFT_PROVIDER,
  );
  if (configured === "deterministic") {
    return undefined;
  }

  const apiKey = env.OPENAI_API_KEY?.trim();
  if (apiKey === undefined || apiKey === "") {
    return new UnavailableOpenAiDraftProvider();
  }

    return new OpenAiCustomerResponseDraftProvider({
    apiKey,
    model: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
    timeoutMs: parseOpenAiDraftTimeoutMs(env.APPROVAL_DRAFT_TIMEOUT_MS),
    responseStyle:
      options.responseStyle ??
      DraftCustomerResponseStyleInputSchema.default("auto").parse(
        env.APPROVAL_RESPONSE_STYLE,
      ),
  });
}

function parseOpenAiDraftTimeoutMs(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_OPENAI_DRAFT_TIMEOUT_MS;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed)
    : DEFAULT_OPENAI_DRAFT_TIMEOUT_MS;
}

export async function draftCustomerResponseWithFallback(input: {
  provider?: CustomerResponseDraftProvider;
  draftInput: CustomerResponseDraftInput;
}): Promise<ValidatedCustomerResponseDraft> {
  const deterministic = new DeterministicCustomerResponseDraftProvider();
  const provider = input.provider ?? deterministic;
  try {
    const candidate = await provider.draft(input.draftInput);
    const response = ensureDraftSignOff(candidate.response, input.draftInput);
    const validation = validateCustomerResponseDraft({
      response,
      assist: candidate.assist,
      knowledgeArticleIds: input.draftInput.outcome.knowledgeArticleIds,
      evidenceReadiness: input.draftInput.evidenceReadiness,
      conversationContext: input.draftInput.conversationContext,
    });
    if (validation.blockingMessages.length === 0) {
      return {
        source: candidate.source,
        response,
        checks: validation.checks,
        assist: {
          ...candidate.assist,
          checks: validation.checks,
        },
      };
    }

    return fallbackDraft({
      draftInput: input.draftInput,
      reason: `Provider draft rejected: ${validation.blockingMessages.join(
        " ",
      )}`,
    });
  } catch (error) {
    return fallbackDraft({
      draftInput: input.draftInput,
      reason:
        error instanceof Error
          ? error.message
          : "Draft provider failed before returning a response.",
    });
  }
}

function fallbackDraft(input: {
  draftInput: CustomerResponseDraftInput;
  reason: string;
}): ValidatedCustomerResponseDraft {
  const fallbackAssist = buildDeterministicGptAssist(
    input.draftInput,
    "fallback",
    [],
  );
  const validation = validateCustomerResponseDraft({
    response: ensureDraftSignOff(
      input.draftInput.deterministicDraft,
      input.draftInput,
    ),
    assist: fallbackAssist,
    knowledgeArticleIds: input.draftInput.outcome.knowledgeArticleIds,
    evidenceReadiness: input.draftInput.evidenceReadiness,
    conversationContext: input.draftInput.conversationContext,
  });
  const checks: DraftCustomerResponseCheck[] = [
    {
      id: "fallback-used",
      label: "Fallback used",
      status: "warn",
      message: sanitizeValidationMessage(input.reason),
    },
    ...validation.checks,
  ];
  return {
    source: "fallback",
    response: ensureDraftSignOff(
      input.draftInput.deterministicDraft,
      input.draftInput,
    ),
    checks,
    assist: {
      ...fallbackAssist,
      checks,
    },
  };
}

function validateCustomerResponseDraft(input: {
  response: string;
  assist: GptAssist;
  knowledgeArticleIds: readonly string[];
  evidenceReadiness?: EvidenceReadiness;
  conversationContext?: CustomerResponseConversationContext;
}): { checks: DraftCustomerResponseCheck[]; blockingMessages: string[] } {
  const response = input.response.trim();
  const checks: DraftCustomerResponseCheck[] = [];
  const blockingMessages: string[] = [];
  const assistText = [
    ...input.assist.missingInfoSuggestions,
    ...input.assist.investigationSteps,
  ].join(" ");

  pushCheck({
    checks,
    blockingMessages,
    id: "non-empty-response",
    label: "Non-empty response",
    passed: response.length > 0,
    failMessage: "The draft response was empty.",
  });

  pushCheck({
    checks,
    blockingMessages,
    id: "no-internal-article-ids",
    label: "No internal article IDs",
    passed: !input.knowledgeArticleIds.some((id) =>
      response.toLowerCase().includes(id.toLowerCase()),
    ) &&
      !input.knowledgeArticleIds.some((id) =>
        assistText.toLowerCase().includes(id.toLowerCase()),
      ),
    failMessage: "The draft exposed internal knowledge article IDs.",
  });

  pushCheck({
    checks,
    blockingMessages,
    id: "no-approval-bypass",
    label: "No approval bypass",
    passed:
      !/\b(approved|approval|skip approval|skip review|close the ticket|closed the ticket|mark resolved|marked resolved)\b/i.test(
        response,
      ) &&
      !/\b(approved|approval|skip approval|skip review|close the ticket|closed the ticket|mark resolved|marked resolved)\b/i.test(
        assistText,
      ),
    failMessage: "The draft implied approval, closure, or review bypass.",
  });

  pushCheck({
    checks,
    blockingMessages,
    id: "no-unsafe-resolution-promise",
    label: "No unsafe resolution promise",
    passed:
      !/\b(guarantee|guaranteed|fixed|resolved|sent successfully|will be fixed)\b/i.test(
        response,
      ) &&
      !/\b(guarantee|guaranteed|fixed|resolved|sent successfully|will be fixed)\b/i.test(
        assistText,
      ),
    failMessage: "The draft promised a resolution that has not been verified.",
  });

  pushCheck({
    checks,
    blockingMessages,
    id: "no-secret-requests",
    label: "No secret requests",
    passed:
      !/\b(api secret|secret key|private key|password|token|access token|signing secret value)\b/i.test(
        `${response} ${assistText}`,
      ),
    failMessage: "The draft asked for secrets or sensitive credentials.",
  });

  pushCheck({
    checks,
    blockingMessages,
    id: "customer-addressed-directly",
    label: "Customer addressed directly",
    passed: !/\bthe customer(?:'s|s)?\b/i.test(response),
    failMessage:
      "The draft referred to the recipient as the customer instead of addressing them directly.",
  });

  pushCheck({
    checks,
    blockingMessages,
    id: "platform-lifecycle-consistency",
    label: "Platform lifecycle consistency",
    passed:
      input.evidenceReadiness?.supportState !== "waiting-on-platform-fix" ||
      !containsPlatformFixSecretTroubleshooting(`${response} ${assistText}`),
    failMessage:
      "The draft gave signing-secret guidance that conflicts with the platform-fix lifecycle state.",
  });

  pushCheck({
    checks,
    blockingMessages,
    id: "status-follow-up-does-not-repeat-diagnostics",
    label: "Status follow-up does not repeat diagnostics",
    passed:
      input.conversationContext?.turnType !== "status-follow-up" ||
      !containsDiagnosticEvidenceAsk({
        text: `${response} ${assistText}`,
        evidenceReadiness: input.evidenceReadiness,
      }),
    failMessage:
      "The draft repeated a diagnostic evidence request instead of answering the customer's status follow-up.",
  });

  pushCheck({
    checks,
    blockingMessages,
    id: "explanation-request-does-not-repeat-diagnostics",
    label: "Explanation request does not repeat diagnostics",
    passed:
      input.conversationContext?.turnType !== "explanation-request" ||
      !containsDiagnosticEvidenceAsk({
        text: `${response} ${assistText}`,
        evidenceReadiness: input.evidenceReadiness,
      }),
    failMessage:
      "The draft repeated a diagnostic evidence request instead of explaining the current suspected problem.",
  });

  return { checks, blockingMessages };
}

function containsPlatformFixSecretTroubleshooting(text: string): boolean {
  const secretGuidance =
    /\b(?:current|active)\s+(?:webhook\s+)?(?:signing\s+)?secret\b|\b(?:webhook\s+)?(?:signing\s+)?secret\s+(?:that\s+is\s+)?(?:currently\s+)?active\b|\b(?:webhook|signing)\s+secret\b|\bsecret\s+rotation\b/i;
  const action = /\b(?:confirm|verify|ensure|check|use|uses|using|configure|update|validat(?:e|es|ing))\b/i;
  const context = /\b(?:secret|signature(?:s)?|webhook)\b/i;
  const actionNearContext = new RegExp(
    `${action.source}.{0,48}${context.source}|${context.source}.{0,48}${action.source}`,
    "i",
  );

  return secretGuidance.test(text) || actionNearContext.test(text);
}

function containsDiagnosticEvidenceAsk(input: {
  text: string;
  evidenceReadiness?: EvidenceReadiness;
}): boolean {
  const text = input.text.toLowerCase();
  if (
    /\b(?:please share|to move (?:this )?forward|we still need|still need|share the|send (?:us )?the|provide (?:the )?)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  return (input.evidenceReadiness?.missingEvidence ?? []).some((requirement) => {
    const candidates = [
      requirement.label,
      requirement.customerQuestion,
      ...requirement.aliases,
    ].map((value) => value.toLowerCase());
    return candidates.some(
      (candidate) => candidate.length >= 6 && text.includes(candidate),
    );
  });
}

export function buildDeterministicGptAssist(
  input: CustomerResponseDraftInput,
  source: DraftCustomerResponseSource,
  checks: DraftCustomerResponseCheck[],
): GptAssist {
  const tone = recommendTone(input);
  return {
    source,
    missingInfoSuggestions: buildMissingInfoSuggestions(input),
    investigationSteps: buildInvestigationSteps(input),
    tone: tone.selectedTone,
    recommendedTone: tone.recommendedTone,
    selectedTone: tone.selectedTone,
    toneReason: tone.toneReason,
    audience: tone.audience,
    checks,
  };
}

function recommendTone(input: CustomerResponseDraftInput): {
  recommendedTone: DraftCustomerResponseStyle;
  selectedTone: DraftCustomerResponseStyle;
  toneReason: string;
  audience: GptAssist["audience"];
} {
  const requester = input.ticket.requester;
  const audience = classifyAssistAudience(input);
  let recommendedTone: DraftCustomerResponseStyle = "balanced";
  let toneReason = "Balanced tone fits the available requester and ticket context.";

  if (requester?.seniority === "executive") {
    recommendedTone = "executive-update";
    toneReason = `${requester.role} requester needs a concise business-impact update.`;
  } else if (requester?.technicalLevel === "developer") {
    recommendedTone = "technical";
    toneReason = `${requester.role} requester can use precise technical evidence and investigation steps.`;
  } else if (requester?.technicalLevel === "non-technical") {
    recommendedTone = "empathetic";
    toneReason = `${requester.role} requester is likely non-technical, so use plain language and acknowledge impact.`;
  } else if (input.outcome.requiredEscalations.includes("outage")) {
    recommendedTone = "concise";
    toneReason = "Potential incident context benefits from a concise status update.";
  }

  return {
    recommendedTone,
    selectedTone:
      input.responseStyle === "auto" ? recommendedTone : input.responseStyle,
    toneReason,
    audience,
  };
}

function buildMissingInfoSuggestions(
  input: CustomerResponseDraftInput,
): string[] {
  const knowledgeIds = input.outcome.knowledgeArticleIds;
  if (input.evidenceReadiness !== undefined) {
    if (input.evidenceReadiness.missingEvidence.length === 0) {
      return ["No additional customer evidence is needed before the next update."];
    }
    return input.evidenceReadiness.missingEvidence.map(
      (requirement) => `Share ${requirement.customerQuestion}.`,
    );
  }
  if (
    knowledgeIds.includes("flow-trigger-troubleshooting") &&
    knowledgeIds.includes("event-tracking-debugging")
  ) {
    return [
      "Share the ecommerce platform such as Shopify, Magento, WooCommerce, or custom.",
      "Share the flow ID, event ID or event time, and one affected customer email.",
    ];
  }

  if (knowledgeIds.includes("webhook-signature-validation")) {
    return [
      "Share the delivery ID, endpoint URL, and failure timestamp.",
      "Confirm whether signing secret rotation or raw body handling changed recently.",
    ];
  }

  if (knowledgeIds.includes("sms-compliance")) {
    return [
      "Share the campaign or flow name and scheduled send time.",
      "Share the recipient region and the compliance banner shown in the dashboard.",
    ];
  }

  const fromRecommendation = input.deterministicDraft
    .split("Please share ")
    .at(1)
    ?.split(".")[0]
    ?.trim();
  return [
    fromRecommendation === undefined || fromRecommendation === ""
      ? `Share one affected example for ${input.ticket.id}.`
      : `Share ${fromRecommendation}.`,
  ];
}

function buildInvestigationSteps(input: CustomerResponseDraftInput): string[] {
  const knowledgeIds = input.outcome.knowledgeArticleIds;
  if (input.evidenceReadiness !== undefined) {
    return input.evidenceReadiness.nextInvestigationSteps;
  }
  if (
    knowledgeIds.includes("flow-trigger-troubleshooting") &&
    knowledgeIds.includes("event-tracking-debugging")
  ) {
    return [
      "Compare the storefront event with the flow setup and profile timeline.",
      "Check event eligibility, flow filters, and customer qualification before recommending a setup change.",
    ];
  }

  if (knowledgeIds.includes("webhook-signature-validation")) {
    return [
      "Compare the signed payload, delivery headers, endpoint response, and retry history.",
    ];
  }

  if (input.outcome.requiredEscalations.includes("outage")) {
    return [
      "Correlate event timing, affected region, ingestion delay, and profile timeline updates.",
    ];
  }

  return [
    "Review the ticket details against retrieved knowledge before recommending the next update.",
  ];
}

function classifyAssistAudience(
  input: CustomerResponseDraftInput,
): GptAssist["audience"] {
  if (
    input.responseStyle === "executive-update" ||
    input.ticket.requester?.seniority === "executive"
  ) {
    return "executive";
  }
  if (input.ticket.requester?.technicalLevel === "developer") {
    return "developer";
  }
  if (input.ticket.requester?.technicalLevel === "non-technical") {
    return "merchant-admin";
  }
  const text = [
    input.ticket.subject,
    input.ticket.description,
    ...input.ticket.tags,
    ...input.knowledgeArticles.flatMap((article) => article.tags),
  ]
    .join(" ")
    .toLowerCase();
  return /\b(api|payload|webhook|endpoint|request id|logs|hmac|signature)\b/.test(
    text,
  )
    ? "developer"
    : "merchant-admin";
}

function pushCheck(input: {
  checks: DraftCustomerResponseCheck[];
  blockingMessages: string[];
  id: string;
  label: string;
  passed: boolean;
  failMessage: string;
}): void {
  input.checks.push({
    id: input.id,
    label: input.label,
    status: input.passed ? "pass" : "warn",
    message: input.passed ? "Passed." : input.failMessage,
  });
  if (!input.passed) {
    input.blockingMessages.push(input.failMessage);
  }
}

export function formatDraftSignOff(input: {
  actor?: string;
  companyName?: string;
}): string {
  const actor = displayActor(input.actor);
  const company = input.companyName?.trim() || DEFAULT_SUPPORT_COMPANY_NAME;
  return `Kind regards,\n${actor}\n${company}`;
}

export function ensureDraftSignOff(
  response: string,
  input: { actor?: string; companyName?: string },
): string {
  const trimmed = response.trim();
  const signOff = formatDraftSignOff(input);
  return trimmed.includes(signOff) ? trimmed : `${trimmed}\n\n${signOff}`;
}

function displayActor(actor: string | undefined): string {
  const trimmed = actor?.trim();
  if (trimmed === undefined || trimmed === "" || trimmed === "approval-desk") {
    return DEFAULT_SUPPORT_ACTOR;
  }
  return trimmed;
}

function buildDraftInstructions(
  style: DraftCustomerResponseStyleInput,
  signOff: string,
): string {
  return buildCustomerServiceDraftingInstructions({
    responseStyle: style,
    signOff,
  });
}

function buildDraftInput(input: CustomerResponseDraftInput): string {
  return JSON.stringify(
    {
      ticket: {
        id: input.ticket.id,
        customer: input.ticket.customer,
        requester: input.ticket.requester,
        subject: input.ticket.subject,
        description: input.ticket.description,
        tags: input.ticket.tags,
      },
      accountFacts: extractAccountFacts(input.ticket),
      requestedResponseStyle: input.responseStyle,
      conversationContext: input.conversationContext,
      expectedOutcome: {
        category: input.outcome.category,
        priority: input.outcome.acceptablePriorities[0],
        team: input.outcome.team,
        requiredEscalations: input.outcome.requiredEscalations,
      },
      evidenceReadiness: input.evidenceReadiness === undefined
        ? undefined
        : {
            supportState: input.evidenceReadiness.supportState,
            knownCause: input.evidenceReadiness.knownCause,
            missingEvidence: input.evidenceReadiness.missingEvidence.map(
              (requirement) => ({
                id: requirement.id,
                label: requirement.label,
                customerQuestion: requirement.customerQuestion,
              }),
            ),
            nextInvestigationSteps: input.evidenceReadiness.nextInvestigationSteps,
          },
      diagnosisContext: input.diagnosisContext,
      fixContext: input.fixContext,
      customerServiceSkill: buildCustomerServiceSkillContext({
        diagnosisContext: input.diagnosisContext,
        fixContext: input.fixContext,
        customerConfirmed:
          input.conversationContext?.turnType === "customer-confirmed",
      }),
      knowledgeArticles: input.knowledgeArticles.map((article) => ({
        title: article.title,
        tags: article.tags,
        body: article.body,
      })),
    },
    null,
    2,
  );
}

function extractResponseText(response: unknown): string {
  const parsed = z
    .object({
      output: z.array(
        z.object({
          content: z.array(
            z.object({
              type: z.string(),
              text: z.string().optional(),
            }),
          ),
        }),
      ),
    })
    .passthrough()
    .parse(response);

  const text = parsed.output
    .flatMap((item) => item.content)
    .find((content) => content.type === "output_text")?.text;
  if (text === undefined) {
    throw new Error("OpenAI drafting response did not include output text.");
  }
  return text;
}

function sanitizeValidationMessage(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-api-key]");
}

function formatOpenAiErrorDetail(raw: string): string {
  if (raw.trim() === "") {
    return "";
  }

  const parsed = z
    .object({
      error: z
        .object({
          message: z.string().trim().min(1).optional(),
          type: z.string().trim().min(1).optional(),
          code: z.union([z.string().trim().min(1), z.number()]).optional(),
        })
        .optional(),
    })
    .safeParse(safeJson(raw));
  if (!parsed.success || parsed.data.error === undefined) {
    return "";
  }

  const error = parsed.data.error;
  const label = error.code ?? error.type;
  const message = error.message;
  const labelText = label === undefined ? "" : ` (${String(label)})`;
  const messageText =
    message === undefined ? "" : `: ${sanitizeValidationMessage(message)}`;
  return `${labelText}${messageText}`;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
