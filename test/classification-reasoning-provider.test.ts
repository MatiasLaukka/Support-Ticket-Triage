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

describe("OpenAiClassificationReasoningProvider", () => {
  it("returns strict reasoning with model, latency, and token usage", async () => {
    const fetch = vi.fn(async (_url: string, _init: unknown) => ({
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
    const firstRequest = fetch.mock.calls[0]![1] as { body: string };
    expect(JSON.parse(firstRequest.body)).toMatchObject({ store: false });
  });

  it("uses no provider in deterministic mode and reports unavailable GPT preference", () => {
    expect(createClassificationReasoningProviderFromEnv({}, { preferOpenAi: false }))
      .toBeUndefined();
    expect(createClassificationReasoningProviderFromEnv({}, { preferOpenAi: true }))
      .toMatchObject({ unavailableReason: "OpenAI is not configured." });
  });
});
