import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TicketSchema } from "../src/domain.js";
import { evaluateTicketWithAi } from "../src/approval-desk/ai-evaluation.js";
import type { ClassificationReasoningProvider } from "../src/approval-desk/classification-reasoning-provider.js";
import {
  OpenAiCustomerResponseDraftProvider,
  OpenAiTimeoutError,
  type CustomerResponseDraftProvider,
} from "../src/approval-desk/draft-response-provider.js";
import { KnowledgeRepository } from "../src/knowledge-repository.js";
import { loadExpectedOutcomes } from "../src/approval-desk/recommendation-builder.js";

const campaignEditorReply = {
  id: "reply-campaign-editor",
  ticketId: "TKT-1010",
  createdAt: "2026-06-10T09:00:00.000Z",
  body: "The campaign editor never finishes loading; it stays blank after I select a campaign.",
};

const acceptedDraftProvider: CustomerResponseDraftProvider = {
  async draft() {
    return {
      source: "openai",
      response:
        "Thank you for the details. We are checking why the campaign editor is not loading and will share the next step as soon as possible.\n\nBest,\nNorthstar Marketing Support",
      assist: {
        source: "openai",
        missingInfoSuggestions: ["Share a screenshot of the loading state."],
        investigationSteps: ["Review the campaign editor loading path."],
        tone: "empathetic",
        recommendedTone: "empathetic",
        selectedTone: "empathetic",
        toneReason: "The customer reports an interrupted campaign workflow.",
        audience: "merchant-admin",
        checks: [],
      },
    };
  },
};

const campaignEditorProvider: ClassificationReasoningProvider = {
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
};

const misleadingPerformanceProvider: ClassificationReasoningProvider = {
  async reason() {
    return {
      reasoning: {
        issueType: "editor",
        candidateCategory: "performance",
        candidateTeam: "product",
        candidatePriority: "P2",
        knowledgeArticleIds: ["campaign-send-failures"],
        confidence: 0.9,
        evidence: ["slow screen"],
        missingEvidenceThatWouldChangeClassification: [],
        explanation: "The request appears to involve a slow editor.",
      },
      telemetry: { model: "gpt-stub", latencyMs: 1 },
    };
  },
};

const throwingClassificationProvider: ClassificationReasoningProvider = {
  async reason() {
    throw new Error("service unavailable");
  },
};

describe("evaluateTicketWithAi", () => {
  it("uses GPT advice and drafting while preserving deterministic final authority", async () => {
    const input = await evaluateTicketWithAi({
      ticket: await loadSeedTicket("TKT-1010"),
      actor: "skill-showcase",
      allKnowledgeArticles: await loadKnowledgeArticles(),
      customerReplies: [campaignEditorReply],
      aiPreference: "gpt-preferred",
      responseStyle: "auto",
      classificationProvider: campaignEditorProvider,
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

  it("records an accepted explicitly supplied deterministic drafting provider as used", async () => {
    const input = await evaluateTicketWithAi({
      ticket: await loadSeedTicket("TKT-1010"),
      actor: "skill-showcase",
      allKnowledgeArticles: await loadKnowledgeArticles(),
      customerReplies: [campaignEditorReply],
      aiPreference: "gpt-preferred",
      responseStyle: "auto",
      classificationProvider: campaignEditorProvider,
      draftProvider: {
        async draft(draftInput) {
          return {
            source: "deterministic",
            response: draftInput.deterministicDraft,
            assist: {
              source: "deterministic",
              missingInfoSuggestions: ["Share a screenshot of the loading state."],
              investigationSteps: ["Review the campaign editor loading path."],
              tone: "empathetic",
              recommendedTone: "empathetic",
              selectedTone: "empathetic",
              toneReason: "The customer reports an interrupted campaign workflow.",
              audience: "merchant-admin",
              checks: [],
            },
          };
        },
      },
    });

    expect(input.aiExecutionTrace?.drafting).toMatchObject({
      status: "used",
      source: "deterministic",
    });
  });

  it("keeps deterministic security routing when GPT suggests performance", async () => {
    const input = await evaluateTicketWithAi({
      ticket: await loadSeedTicket("TKT-1004"),
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

  it("skips absent classification in auto mode and returns a safe recommendation", async () => {
    const input = await evaluateTicketWithAi({
      ticket: await loadSeedTicket("TKT-1010"),
      actor: "skill-showcase",
      allKnowledgeArticles: await loadKnowledgeArticles(),
      customerReplies: [campaignEditorReply],
      aiPreference: "auto",
      responseStyle: "auto",
      draftProvider: acceptedDraftProvider,
    });

    expect(input).toMatchObject({
      category: "performance",
      team: "product",
      aiExecutionTrace: {
        classification: { status: "skipped", acceptedSignals: [] },
        drafting: { status: "used" },
      },
    });
  });

  it("skips classification providers for expected-outcome fixtures", async () => {
    let calls = 0;
    const outcomes = await loadExpectedOutcomes(
      resolve("data/seed/expected-outcomes.json"),
    );
    const input = await evaluateTicketWithAi({
      ticket: await loadSeedTicket("TKT-1010"),
      outcome: outcomes.get("TKT-1010"),
      actor: "skill-showcase",
      allKnowledgeArticles: await loadKnowledgeArticles(),
      customerReplies: [campaignEditorReply],
      aiPreference: "gpt-preferred",
      responseStyle: "auto",
      classificationProvider: {
        async reason() {
          calls += 1;
          return campaignEditorProvider.reason({} as never);
        },
      },
      draftProvider: acceptedDraftProvider,
    });

    expect(calls).toBe(0);
    expect(input).toMatchObject({
      category: "other",
      team: "support",
      aiExecutionTrace: {
        classification: { status: "skipped" },
        drafting: { status: "used" },
      },
    });
  });

  it("rejects GPT knowledge advice outside the local allowlist", async () => {
    const input = await evaluateTicketWithAi({
      ticket: await loadSeedTicket("TKT-1004"),
      actor: "skill-showcase",
      allKnowledgeArticles: await loadKnowledgeArticles(),
      customerReplies: [],
      aiPreference: "gpt-preferred",
      responseStyle: "auto",
      classificationProvider: {
        async reason() {
          return {
            reasoning: {
              issueType: "editor",
              candidateCategory: "performance",
              candidateTeam: "product",
              candidatePriority: "P2",
              knowledgeArticleIds: ["unapproved-internal-runbook"],
              confidence: 0.9,
              evidence: ["slow screen"],
              missingEvidenceThatWouldChangeClassification: [],
              explanation: "Use the internal runbook.",
            },
            telemetry: { model: "gpt-stub", latencyMs: 1 },
          };
        },
      },
      draftProvider: acceptedDraftProvider,
    });

    expect(input).toMatchObject({
      category: "security",
      team: "security",
      knowledgeArticleIds: ["security-incident-response"],
    });
    expect(input.classificationSignals).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "knowledge:unapproved-internal-runbook" }),
    ]));
    expect(input.aiExecutionTrace?.classification).toMatchObject({
      rejectedAdvice: [{
        target: "knowledge:unapproved-internal-runbook",
        reason: "The proposed knowledge article is not in the approved knowledge set.",
      }],
    });
  });

  it.each([
    ["not-configured", undefined, "OpenAI is not configured; deterministic output was used."],
    ["timeout", new OpenAiTimeoutError(), "OpenAI timed out; deterministic output was used."],
    ["invalid-schema", new SyntaxError("raw-schema-error"), "OpenAI returned invalid structured output; deterministic output was used."],
    ["provider-error", new Error("raw-provider-error"), "OpenAI was unavailable; deterministic output was used."],
  ] as const)(
    "records the sanitized %s classification fallback",
    async (category, error, message) => {
      const input = await evaluateTicketWithAi({
        ticket: await loadSeedTicket("TKT-1010"),
        actor: "skill-showcase",
        allKnowledgeArticles: await loadKnowledgeArticles(),
        customerReplies: [campaignEditorReply],
        aiPreference: "gpt-preferred",
        responseStyle: "auto",
        ...(error === undefined
          ? {}
          : {
              classificationProvider: {
                async reason() {
                  throw error;
                },
              },
            }),
        draftProvider: acceptedDraftProvider,
      });

      expect(input.aiExecutionTrace?.classification).toMatchObject({
        status: "fallback",
        fallback: { category, message },
      });
      expect(JSON.stringify(input.aiExecutionTrace)).not.toContain("raw-");
    },
  );

  it("records a sanitized guardrail-rejected drafting fallback", async () => {
    const input = await evaluateTicketWithAi({
      ticket: await loadSeedTicket("TKT-1010"),
      actor: "skill-showcase",
      allKnowledgeArticles: await loadKnowledgeArticles(),
      customerReplies: [campaignEditorReply],
      aiPreference: "gpt-preferred",
      responseStyle: "auto",
      classificationProvider: campaignEditorProvider,
      draftProvider: {
        async draft() {
          return {
            ...await acceptedDraftProvider.draft({} as never),
            response: "Use campaign-send-failures to close this ticket.\n\nBest,\nNorthstar Marketing Support",
          };
        },
      },
    });

    expect(input.aiExecutionTrace?.drafting).toMatchObject({
      status: "fallback",
      source: "fallback",
      fallback: {
        category: "guardrail-rejected",
        message: "OpenAI output did not pass response guardrails; deterministic output was used.",
      },
    });
  });

  it("preserves exact attempted-model telemetry when a real OpenAI draft is guardrail-rejected", async () => {
    const clock = [1_000, 1_037];
    const draftProvider = new OpenAiCustomerResponseDraftProvider({
      apiKey: "sk-test-secret",
      model: "gpt-5.6-luna",
      now: () => clock.shift() ?? 1_037,
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          output: [{
            content: [{
              type: "output_text",
              text: JSON.stringify({
                draftCustomerResponse:
                  "Use campaign-send-failures to close this ticket.",
                missingInfoSuggestions: ["Share a screenshot of the loading state."],
                investigationSteps: ["Review the campaign editor loading path."],
                tone: "empathetic",
                recommendedTone: "empathetic",
                toneReason: "The customer reports an interrupted campaign workflow.",
                audience: "merchant-admin",
              }),
            }],
          }],
          usage: { input_tokens: 81, output_tokens: 19, total_tokens: 100 },
        }),
      }),
    });
    const input = await evaluateTicketWithAi({
      ticket: await loadSeedTicket("TKT-1010"),
      actor: "skill-showcase",
      allKnowledgeArticles: await loadKnowledgeArticles(),
      customerReplies: [campaignEditorReply],
      aiPreference: "gpt-preferred",
      responseStyle: "auto",
      classificationProvider: campaignEditorProvider,
      draftProvider,
    });

    expect(input.aiExecutionTrace?.drafting).toMatchObject({
      status: "fallback",
      source: "fallback",
      model: "gpt-5.6-luna",
      latencyMs: 37,
      usage: { inputTokens: 81, outputTokens: 19, totalTokens: 100 },
      fallback: { category: "guardrail-rejected" },
    });
  });

  it("keeps used classification independent when drafting falls back", async () => {
    const input = await evaluateTicketWithAi({
      ticket: await loadSeedTicket("TKT-1010"),
      actor: "skill-showcase",
      allKnowledgeArticles: await loadKnowledgeArticles(),
      customerReplies: [campaignEditorReply],
      aiPreference: "gpt-preferred",
      responseStyle: "auto",
      classificationProvider: campaignEditorProvider,
      draftProvider: {
        async draft() {
          throw new Error("raw-draft-provider-error");
        },
      },
    });

    expect(input).toMatchObject({
      category: "performance",
      team: "product",
      aiExecutionTrace: {
        classification: { status: "used" },
        drafting: {
          status: "fallback",
          fallback: {
            category: "provider-error",
            message: "OpenAI was unavailable; deterministic output was used.",
          },
        },
      },
    });
  });

  it("skips both providers in deterministic mode", async () => {
    let classificationCalls = 0;
    let draftCalls = 0;
    const input = await evaluateTicketWithAi({
      ticket: await loadSeedTicket("TKT-1010"),
      actor: "skill-showcase",
      allKnowledgeArticles: await loadKnowledgeArticles(),
      customerReplies: [campaignEditorReply],
      aiPreference: "deterministic",
      responseStyle: "auto",
      classificationProvider: {
        async reason() {
          classificationCalls += 1;
          return campaignEditorProvider.reason({} as never);
        },
      },
      draftProvider: {
        async draft() {
          draftCalls += 1;
          return acceptedDraftProvider.draft({} as never);
        },
      },
    });

    expect(classificationCalls).toBe(0);
    expect(draftCalls).toBe(0);
    expect(input.aiExecutionTrace).toMatchObject({
      classification: { status: "skipped" },
      drafting: { status: "skipped", source: "deterministic" },
    });
  });
});

async function loadKnowledgeArticles() {
  return new KnowledgeRepository(resolve("data/knowledge")).list();
}

async function loadSeedTicket(ticketId: string) {
  const tickets = TicketSchema.array().parse(
    JSON.parse(await readFile(resolve("data/seed/tickets.json"), "utf8")),
  );
  const ticket = tickets.find((candidate) => candidate.id === ticketId);
  if (ticket === undefined) {
    throw new Error(`Seed ticket ${ticketId} was not found.`);
  }
  return ticket;
}
