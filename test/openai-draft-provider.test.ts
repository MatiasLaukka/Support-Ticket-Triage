import { describe, expect, it } from "vitest";
import {
  createCustomerResponseDraftProviderFromEnv,
  draftCustomerResponseWithFallback,
  OpenAiTimeoutError,
  OpenAiCustomerResponseDraftProvider,
  UnavailableOpenAiError,
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
                        missingInfoSuggestions: [
                          "Share the ecommerce platform.",
                          "Share the flow ID and event ID.",
                        ],
                        investigationSteps: [
                          "Compare the storefront event with the profile timeline.",
                          "Review flow filters before recommending a setup change.",
                        ],
                        tone: "empathetic",
                        recommendedTone: "empathetic",
                        toneReason:
                          "Requester is a non-technical marketing coordinator reporting flow impact.",
                        audience: "merchant-admin",
                      }),
                    },
                  ],
                },
              ],
              usage: { input_tokens: 80, output_tokens: 30, total_tokens: 110 },
            }),
        };
      },
    });

    const draft = await provider.draft({
      ticket,
      outcome,
      knowledgeArticles: [article],
      deterministicDraft: "Fallback draft.",
      responseStyle: "auto",
      actor: "approval-desk",
      companyName: "Northstar Marketing Support",
    });

    expect(draft).toMatchObject({
      source: "openai",
      response:
        "We are checking the storefront event and flow setup.\n\nKind regards,\nSupport Team\nNorthstar Marketing Support",
      assist: {
        source: "openai",
        missingInfoSuggestions: [
          "Share the ecommerce platform.",
          "Share the flow ID and event ID.",
        ],
        investigationSteps: [
          "Compare the storefront event with the profile timeline.",
          "Review flow filters before recommending a setup change.",
        ],
        tone: "empathetic",
        recommendedTone: "empathetic",
        selectedTone: "empathetic",
        toneReason:
          "Requester is a non-technical marketing coordinator reporting flow impact.",
        audience: "merchant-admin",
        checks: [],
      },
    });
    expect(draft.telemetry).toEqual({
      model: "gpt-5.6-luna",
      latencyMs: expect.any(Number),
      usage: { inputTokens: 80, outputTokens: 30, totalTokens: 110 },
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
    expect(requests[0]!.init.body).toContain("Marketing Coordinator");
    expect(JSON.parse(requests[0]!.init.body).instructions).toContain(
      "recommend the best support tone",
    );
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
                        missingInfoSuggestions: [
                          "Share the affected account or store.",
                        ],
                        investigationSteps: [
                          "Confirm impact and owner before the next update.",
                        ],
                        tone: "executive-update",
                        recommendedTone: "empathetic",
                        toneReason:
                          "Manual reviewer override selected executive update.",
                        audience: "executive",
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
      actor: "approval-desk",
      companyName: "Northstar Marketing Support",
    });

    expect(JSON.parse(requests[0]!.init.body).instructions).toContain(
      "executive update",
    );
    expect(JSON.parse(requests[0]!.init.body).instructions).toContain(
      "manual override",
    );
  });

  it("includes customer-service drafting policy and trusted diagnosis context", async () => {
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
                          "We found the likely campaign editor loading cause.",
                        missingInfoSuggestions: ["No customer evidence needed."],
                        investigationSteps: ["Apply mitigation."],
                        tone: "balanced",
                        recommendedTone: "balanced",
                        toneReason: "Diagnosis update.",
                        audience: "merchant-admin",
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
      responseStyle: "auto",
      actor: "approval-desk",
      companyName: "Northstar Marketing Support",
      diagnosisContext: {
        status: "completed",
        causeType: "performance",
        customerSafeSummary:
          "The campaign editor blank page is likely caused by a frontend loading issue.",
        evidenceUsed: ["campaign name", "browser/session details"],
        confidence: "likely",
        owner: "engineering",
        recommendedNextAction: "Apply mitigation and ask the customer to retry.",
        doNotSay: ["Do not claim the issue is fixed yet."],
      },
    });

    const requestBody = JSON.parse(requests[0]!.init.body);
    expect(requestBody.instructions).toContain("Customer service drafting skill");
    expect(requestBody.instructions).toContain("Do not invent a diagnosis");
    expect(requestBody.instructions).toContain(
      "A likely diagnosis is not a finished diagnosis",
    );
    expect(requestBody.input).toContain("diagnosisContext");
    expect(requestBody.input).toContain('"stage": "diagnostic-narrowing"');
    expect(requestBody.input).toContain('"finalForCustomer": false');
    expect(requestBody.input).toContain("campaign editor blank page");
  });

  it("adds the reviewer and company sign-off to provider drafts", async () => {
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
                        missingInfoSuggestions: ["Share the flow ID."],
                        investigationSteps: ["Compare the flow setup."],
                        tone: "empathetic",
                        recommendedTone: "empathetic",
                        toneReason: "Requester is non-technical.",
                        audience: "merchant-admin",
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
      responseStyle: "auto",
      actor: "Matias Laukka",
      companyName: "Northstar Marketing Support",
    });

    expect(JSON.parse(requests[0]!.init.body).instructions).toContain(
      "Kind regards",
    );
    expect(draft.response).toContain("Kind regards,");
    expect(draft.response).toContain("Matias Laukka");
    expect(draft.response).toContain("Northstar Marketing Support");
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
        actor: "approval-desk",
        companyName: "Northstar Marketing Support",
      }),
    ).rejects.toThrow("OpenAI is not configured.");
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
        actor: "approval-desk",
        companyName: "Northstar Marketing Support",
      }),
    ).rejects.toThrow("OpenAI request failed.");
  });

  it("times out slow OpenAI drafting requests", async () => {
    const provider = new OpenAiCustomerResponseDraftProvider({
      apiKey: "sk-test-secret",
      model: "gpt-5.6-luna",
      timeoutMs: 10,
      fetch: async () => new Promise(() => undefined),
    } as any);

    const result = await Promise.race([
      provider
        .draft({
          ticket,
          outcome,
          knowledgeArticles: [],
          deterministicDraft: "Fallback draft.",
          responseStyle: "balanced",
          actor: "approval-desk",
          companyName: "Northstar Marketing Support",
        })
        .then(
          () => "resolved",
          (error: unknown) =>
            error instanceof Error ? error.message : String(error),
        ),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve("test timed out waiting for provider"), 50),
      ),
    ]);

    expect(result).toBe("OpenAI request timed out.");
  });

  it.each([
    ["not-configured", new UnavailableOpenAiError()],
    ["timeout", new OpenAiTimeoutError()],
    ["invalid-schema", new SyntaxError("raw provider payload")],
    ["provider-error", new Error("sk-secret at C:\\private\\trace")],
  ] as const)("maps %s failures to sanitized fallback metadata", async (category, error) => {
    const result = await draftCustomerResponseWithFallback({
      provider: { draft: async () => { throw error; } },
      draftInput: {
        ticket,
        outcome,
        knowledgeArticles: [],
        deterministicDraft: "Fallback draft.",
        responseStyle: "balanced",
        actor: "approval-desk",
        companyName: "Northstar Marketing Support",
      },
    });

    expect(result.fallback?.category).toBe(category);
    expect(result.fallback?.message).not.toContain("sk-secret");
    expect(result.fallback?.message).not.toContain("C:\\private");
    expect(result.candidateChecks).toEqual([]);
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
  requester: {
    name: "Avery Brooks",
    role: "Marketing Coordinator",
    department: "Marketing",
    technicalLevel: "non-technical",
    seniority: "individual-contributor",
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
