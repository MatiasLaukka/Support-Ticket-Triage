import { describe, expect, it } from "vitest";
import {
  createCustomerResponseDraftProviderFromEnv,
  OpenAiCustomerResponseDraftProvider,
} from "../src/approval-desk/draft-response-provider.js";
import type { ExpectedOutcome, KnowledgeArticle, Ticket } from "../src/domain.js";

describe("OpenAiCustomerResponseDraftProvider", () => {
  it("posts a structured Responses API request and extracts the draft", async () => {
    const requests: Array<{ url: string; init: any }> = [];
    const provider = new OpenAiCustomerResponseDraftProvider({
      apiKey: "sk-test-secret",
      model: "gpt-5.6-luna",
      fetch: async (url, init) => {
        requests.push({ url, init });
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              output: [
                {
                  content: [
                    {
                      type: "output_text",
                      text: JSON.stringify({
                        draftCustomerResponse:
                          "We are checking the storefront event and flow setup.",
                      }),
                    },
                  ],
                },
              ],
            }),
        };
      },
    });

    const draft = await provider.draft({
      ticket,
      outcome,
      knowledgeArticles: [article],
      deterministicDraft: "Fallback draft.",
      responseStyle: "balanced",
    });

    expect(draft).toEqual({
      source: "openai",
      response: "We are checking the storefront event and flow setup.",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://api.openai.com/v1/responses");
    expect(requests[0]!.init.headers.authorization).toBe(
      "Bearer sk-test-secret",
    );
    expect(JSON.parse(requests[0]!.init.body)).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "customer_response_draft",
        },
      },
    });
    expect(requests[0]!.init.body).toContain(article.body);
  });

  it("includes the selected response style in the drafting instructions", async () => {
    const requests: Array<{ url: string; init: any }> = [];
    const provider = new OpenAiCustomerResponseDraftProvider({
      apiKey: "sk-test-secret",
      model: "gpt-5.6-luna",
      responseStyle: "executive-update",
      fetch: async (url, init) => {
        requests.push({ url, init });
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              output: [
                {
                  content: [
                    {
                      type: "output_text",
                      text: JSON.stringify({
                        draftCustomerResponse:
                          "We are treating this as a priority investigation.",
                      }),
                    },
                  ],
                },
              ],
            }),
        };
      },
    });

    await provider.draft({
      ticket,
      outcome,
      knowledgeArticles: [article],
      deterministicDraft: "Fallback draft.",
      responseStyle: "executive-update",
    });

    expect(JSON.parse(requests[0]!.init.body).instructions).toContain(
      "executive update",
    );
  });

  it("returns an unavailable OpenAI provider when enabled without an API key", async () => {
    const provider = createCustomerResponseDraftProviderFromEnv({
      APPROVAL_DRAFT_PROVIDER: "openai",
    });

    await expect(
      provider!.draft({
        ticket,
        outcome,
        knowledgeArticles: [],
        deterministicDraft: "Fallback draft.",
        responseStyle: "balanced",
      }),
    ).rejects.toThrow("OPENAI_API_KEY is not set");
  });

  it("surfaces sanitized OpenAI error details for rate and quota failures", async () => {
    const provider = new OpenAiCustomerResponseDraftProvider({
      apiKey: "sk-test-secret",
      model: "gpt-5.6-luna",
      fetch: async () => ({
        ok: false,
        status: 429,
        text: async () =>
          JSON.stringify({
            error: {
              message:
                "You exceeded your current quota for sk-test-secret, please check your plan and billing details.",
              type: "insufficient_quota",
              code: "insufficient_quota",
            },
          }),
      }),
    });

    await expect(
      provider.draft({
        ticket,
        outcome,
        knowledgeArticles: [],
        deterministicDraft: "Fallback draft.",
        responseStyle: "balanced",
      }),
    ).rejects.toThrow(
      "OpenAI drafting request failed with 429 (insufficient_quota): You exceeded your current quota for [redacted-api-key], please check your plan and billing details.",
    );
  });
});

const ticket: Ticket = {
  id: "TKT-1005",
  createdAt: "2026-06-10T08:00:00.000Z",
  updatedAt: "2026-06-10T08:00:00.000Z",
  customer: {
    name: "Alpine Home Goods",
    plan: "enterprise",
    region: "eu-west",
    vip: true,
  },
  subject: "Browse Abandonment flow not starting",
  description: "Viewed Product events are visible but the flow does not start.",
  status: "triage",
  tags: ["flows"],
  sla: {
    responseDueAt: "2026-06-10T10:00:00.000Z",
    breached: false,
  },
  relatedTicketIds: [],
  revision: 0,
};

const outcome: ExpectedOutcome = {
  ticketId: "TKT-1005",
  category: "integration",
  acceptablePriorities: ["P2"],
  team: "integrations",
  requiredEscalations: [],
  knowledgeArticleIds: [
    "flow-trigger-troubleshooting",
    "event-tracking-debugging",
  ],
};

const article: KnowledgeArticle = {
  id: "flow-trigger-troubleshooting",
  title: "Flow trigger troubleshooting",
  tags: ["flows"],
  body: "Ask for the ecommerce platform, flow ID, event ID, and affected profile before recommending a flow change.",
};
