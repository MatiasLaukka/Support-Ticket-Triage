import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatWorkflowTrail,
  main,
  parseSkillShowcaseArgs,
  providersForMode,
  runSkillShowcase,
  showcaseApprovalFields,
  type SkillShowcaseMode,
  type SkillShowcaseReport,
} from "../scripts/demo-skill-showcase.js";
import { OpenAiClassificationReasoningProvider } from "../src/approval-desk/classification-reasoning-provider.js";
import { OpenAiCustomerResponseDraftProvider } from "../src/approval-desk/draft-response-provider.js";
import { RecommendationRepository } from "../src/recommendation-repository.js";

const roots: string[] = [];
const SHOWCASE_TEST_TIMEOUT_MS = 15_000;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("replays TKT-1010 through guidance, approval, diagnosis, fix, verification, and closure", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "skill-showcase-"));
  roots.push(dataRoot);
  const { report, fetchCalls } = await runOfflineShowcase("controlled", dataRoot);

  expect(fetchCalls).toBe(0);
  expect(report.mode).toBe("controlled");
  expect(report.serialized).toContain("- Mode: controlled");
  expect(report.providerProvenance).toEqual({
    classification: "controlled-local-simulation",
    drafting: "controlled-local-simulation",
    networkPolicy: "disabled",
  });
  expect(report.serialized).toContain(
    "- Provider provenance: classification=controlled-local-simulation; drafting=controlled-local-simulation; network=disabled.",
  );
  expect(report.serialized).toContain(
    "- Human approval: scripted portfolio-reviewer simulation; no interactive pause.",
  );
  expect(report.toolCalls).toEqual(
    expect.arrayContaining([
      "get_ticket_workflow",
      "evaluate_ticket",
      "mark_response_done",
      "record_diagnosis",
      "mark_fix_available",
      "close_ticket",
    ]),
  );
  expect(report.aiStages.length).toBeGreaterThan(0);
  expect(report.aiStages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        preference: "gpt-preferred",
        classification: expect.objectContaining({ status: "used" }),
        drafting: expect.objectContaining({ status: "used" }),
      }),
    ]),
  );
  expect(report.aiStages.every((trace) =>
    trace.drafting.status === "used" && trace.drafting.source === "deterministic"
  )).toBe(true);
  expect(report.aiStages.every((trace) => trace.drafting.fallback === undefined))
    .toBe(true);
  const persistedTraces = (await new RecommendationRepository(
    join(dataRoot, "recommendations"),
  ).list()).map((recommendation) => recommendation.aiExecutionTrace);
  expect(report.aiStages).toEqual(persistedTraces);
  expect(report.workflowStages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ stage: "review", nextAction: "review-recommendation" }),
      expect.objectContaining({ stage: "diagnosis-ready", nextAction: "record-diagnosis" }),
      expect.objectContaining({ stage: "fix-ready", nextAction: "mark-fix-available" }),
      expect.objectContaining({ stage: "verification", nextAction: "evaluate-ticket" }),
      expect.objectContaining({ stage: "ready-for-close", nextAction: "close-ticket" }),
      expect.objectContaining({ stage: "closed", nextAction: "none" }),
    ]),
  );
  expect(report.toolCalls.filter((name) => name === "get_ticket_workflow")).toHaveLength(
    report.workflowStages.length,
  );
  expect(report.approvals).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        required: true,
        fields: expect.arrayContaining(["customerResponse"]),
        actor: "portfolio-reviewer",
      }),
    ]),
  );
  expect(report.finalTicketStatus).toBe("resolved");
  expect(report.auditEvents).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "diagnosis-completed",
        actor: "product-support",
        timestamp: expect.any(String),
      }),
    ]),
  );
  expect(report.auditEvents.every((event) =>
    Object.keys(event).every((key) => ["type", "actor", "timestamp"].includes(key)),
  )).toBe(true);
  expect(report.serialized).not.toMatch(
    /sk-[A-Za-z0-9_-]+|authorization|raw prompt|[A-Za-z]:\\|customer body omitted|recorded [a-z-]+/i,
  );
  expect(JSON.stringify(report)).not.toMatch(
    /OpenAI output|live OpenAI (?:call|adapter)|"source":"openai"/i,
  );
}, SHOWCASE_TEST_TIMEOUT_MS);

it("uses no providers in deterministic mode and preserves skipped local drafting traces", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "skill-showcase-"));
  roots.push(dataRoot);
  const { report, fetchCalls } = await runOfflineShowcase("deterministic", dataRoot);

  expect(fetchCalls).toBe(0);
  expect(report.mode).toBe("deterministic");
  expect(report.serialized).toContain("- Mode: deterministic");
  expect(report.providerProvenance).toEqual({
    classification: "not-configured",
    drafting: "not-configured",
    networkPolicy: "disabled",
  });
  expect(providersForMode("deterministic")).toEqual({});
  expect(report.aiStages.every((trace) => trace.preference === "deterministic")).toBe(true);
  expect(report.aiStages.every((trace) => trace.classification.status === "skipped")).toBe(true);
  expect(report.aiStages.every((trace) =>
    trace.drafting.status === "skipped" &&
    trace.drafting.source === "deterministic" &&
    trace.drafting.fallback === undefined
  )).toBe(true);
  expect(report.finalTicketStatus).toBe("resolved");
}, SHOWCASE_TEST_TIMEOUT_MS);

it("requires an explicit API key before constructing live providers", () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    expect(() => providersForMode("live")).toThrow(
      "OPENAI_API_KEY is required for live showcase mode.",
    );
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});

it("preserves live mode's real OpenAI adapters", () => {
  const providers = providersForMode("live", {
    OPENAI_API_KEY: "configured-only-for-construction-test",
  });

  expect(providers.classificationReasoningProvider).toBeInstanceOf(
    OpenAiClassificationReasoningProvider,
  );
  expect(providers.draftProvider).toBeInstanceOf(
    OpenAiCustomerResponseDraftProvider,
  );
});

describe("showcase CLI", () => {
  it.each([
    { args: [], expectedMode: "controlled" as const },
    { args: ["--deterministic"], expectedMode: "deterministic" as const },
  ])("selects $expectedMode and cleans temporary state", async ({ args, expectedMode }) => {
    const result = await invokeCli(args);

    expect(result.exitCode).toBe(0);
    expect(result.modes).toEqual([expectedMode]);
    expect(result.stdout).toContain(`- Mode: ${expectedMode}`);
    expect(result.createdRoots).toEqual(["isolated-showcase-root"]);
    expect(result.removedRoots).toEqual(result.createdRoots);
    expect(result.stderr).toBe("");
  });

  it("fails safely when live mode has no API key", async () => {
    const result = await invokeCli(["--live"], {});

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "OPENAI_API_KEY is required for live showcase mode.\n",
    );
    expect(result.modes).toEqual([]);
    expect(result.createdRoots).toEqual([]);
  });

  it("rejects conflicting mode flags", async () => {
    const result = await invokeCli(["--deterministic", "--live"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "Choose either --deterministic or --live, not both.\n",
    );
    expect(result.modes).toEqual([]);
  });

  it.each([["--deterministic"], ["--live"]])(
    "rejects duplicate %s flags",
    async (flag) => {
      const result = await invokeCli([flag, flag], {
        OPENAI_API_KEY: "configured-only-for-parser-test",
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe(
        "Showcase mode flags may be provided only once.\n",
      );
      expect(result.modes).toEqual([]);
    },
  );

  it("rejects unknown arguments without echoing their content", async () => {
    const secretLikeTypo = "--sk-sensitive-typo-value";
    const result = await invokeCli([secretLikeTypo]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "Unknown showcase argument. Use no flags, --deterministic, or --live.\n",
    );
    expect(result.stderr).not.toContain(secretLikeTypo);
    expect(result.modes).toEqual([]);
  });

  it("cleans temporary state and sanitizes unexpected failures", async () => {
    const result = await invokeCli([], {}, async () => {
      throw new Error("secret at C:\\private\\showcase-state");
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("Showcase failed.\n");
    expect(result.removedRoots).toEqual(result.createdRoots);
    expect(result.stderr).not.toMatch(/secret|[A-Za-z]:\\/i);
  });
});

it("parses only the three supported CLI modes", () => {
  expect(parseSkillShowcaseArgs([])).toBe("controlled");
  expect(parseSkillShowcaseArgs(["--deterministic"])).toBe("deterministic");
  expect(parseSkillShowcaseArgs(["--live"])).toBe("live");
});

it("requires approval guidance and returns its actual fields", () => {
  expect(() =>
    showcaseApprovalFields({ required: false, fields: [] }),
  ).toThrow("Review guidance did not require explicit approval.");
  expect(
    showcaseApprovalFields({ required: true, fields: ["customerResponse"] }),
  ).toEqual({ required: true, fields: ["customerResponse"] });
});

it("formats waiting diagnostics from safe workflow stage and next-action values", () => {
  expect(
    formatWorkflowTrail([
      { stage: "active", nextAction: "evaluate-ticket" },
      { stage: "waiting-customer", nextAction: "wait-for-customer" },
    ]),
  ).toBe("active/evaluate-ticket -> waiting-customer/wait-for-customer");
});

async function runOfflineShowcase(
  mode: "controlled" | "deterministic",
  dataRoot: string,
): Promise<{ report: SkillShowcaseReport; fetchCalls: number }> {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    throw new Error("Network access is forbidden in offline showcase modes.");
  }) as typeof fetch;
  try {
    const report = await runSkillShowcase({
      root: resolve(import.meta.dirname, ".."),
      dataRoot,
      mode,
    });
    return { report, fetchCalls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function invokeCli(
  args: string[],
  env: NodeJS.ProcessEnv = {},
  runShowcase: (options: {
    root: string;
    dataRoot: string;
    mode: SkillShowcaseMode;
    env?: NodeJS.ProcessEnv;
  }) => Promise<SkillShowcaseReport> = async ({ mode }) => fakeReport(mode),
) {
  let stdout = "";
  let stderr = "";
  const modes: SkillShowcaseMode[] = [];
  const createdRoots: string[] = [];
  const removedRoots: string[] = [];
  const exitCode = await main({
    args,
    cwd: "showcase-fixture-root",
    env,
    createTemporaryRoot: async () => {
      createdRoots.push("isolated-showcase-root");
      return "isolated-showcase-root";
    },
    removeTemporaryRoot: async (root) => {
      removedRoots.push(root);
    },
    runShowcase: async (options) => {
      modes.push(options.mode);
      return runShowcase(options);
    },
    writeStdout: (text) => {
      stdout += text;
    },
    writeStderr: (text) => {
      stderr += text;
    },
  });
  return { exitCode, stdout, stderr, modes, createdRoots, removedRoots };
}

function fakeReport(mode: SkillShowcaseMode): SkillShowcaseReport {
  return {
    mode,
    providerProvenance: mode === "controlled"
      ? {
          classification: "controlled-local-simulation",
          drafting: "controlled-local-simulation",
          networkPolicy: "disabled",
        }
      : mode === "deterministic"
        ? {
            classification: "not-configured",
            drafting: "not-configured",
            networkPolicy: "disabled",
          }
        : {
            classification: "live-openai-adapter",
            drafting: "live-openai-adapter",
            networkPolicy: "live-provider-allowed",
          },
    toolCalls: [],
    aiStages: [],
    workflowStages: [],
    approvals: [],
    finalTicketStatus: "resolved",
    auditEvents: [],
    serialized: `# Codex Skill AI Showcase\n\n- Mode: ${mode}`,
  };
}
