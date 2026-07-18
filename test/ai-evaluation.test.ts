import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TicketSchema } from "../src/domain.js";
import { evaluateTicketWithAi } from "../src/approval-desk/ai-evaluation.js";
import type { ClassificationReasoningProvider } from "../src/approval-desk/classification-reasoning-provider.js";
import type { CustomerResponseDraftProvider } from "../src/approval-desk/draft-response-provider.js";
import { KnowledgeRepository } from "../src/knowledge-repository.js";

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
