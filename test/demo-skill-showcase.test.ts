import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  providersForMode,
  runSkillShowcase,
} from "../scripts/demo-skill-showcase.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("replays TKT-1010 through guidance, approval, diagnosis, fix, verification, and closure", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "skill-showcase-"));
  roots.push(dataRoot);
  const report = await runSkillShowcase({
    root: resolve(import.meta.dirname, ".."),
    dataRoot,
    mode: "controlled",
  });

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
});

it("uses no providers in deterministic mode and preserves the backend fallback trace", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "skill-showcase-"));
  roots.push(dataRoot);
  const report = await runSkillShowcase({
    root: resolve(import.meta.dirname, ".."),
    dataRoot,
    mode: "deterministic",
  });

  expect(providersForMode("deterministic")).toEqual({});
  expect(report.aiStages.every((trace) => trace.preference === "deterministic")).toBe(true);
  expect(report.aiStages.every((trace) => trace.classification.status === "skipped")).toBe(true);
  expect(report.aiStages.slice(0, -1).every((trace) => trace.drafting.status === "skipped")).toBe(true);
  expect(report.aiStages.at(-1)?.drafting).toMatchObject({
    status: "fallback",
    fallback: {
      category: "not-configured",
      message: "OpenAI is not configured; deterministic output was used.",
    },
  });
  expect(report.finalTicketStatus).toBe("resolved");
});

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
