import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRuntimeDependencies,
  environmentPath,
  minutesSaved,
} from "../src/runtime.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("runtime configuration", () => {
  it("rejects blank path environment variables", () => {
    expect(() =>
      environmentPath("TRIAGE_DATA_ROOT", "data/runtime", {
        TRIAGE_DATA_ROOT: "   ",
      }),
    ).toThrow("TRIAGE_DATA_ROOT must not be blank.");
  });

  it("reads minutes saved from the environment", () => {
    expect(minutesSaved({ TRIAGE_MINUTES_SAVED: "12" })).toBe(12);
  });

  it("rejects negative minutes saved", () => {
    expect(() => minutesSaved({ TRIAGE_MINUTES_SAVED: "-1" })).toThrow(
      "TRIAGE_MINUTES_SAVED must be a finite nonnegative number.",
    );
  });

  it("initializes repositories and service dependencies", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "triage-runtime-"));
    temporaryRoots.push(dataRoot);
    const fixedNow = new Date("2026-06-26T12:00:00.000Z");

    const deps = await createRuntimeDependencies({
      env: {
        TRIAGE_DATA_ROOT: dataRoot,
        TRIAGE_SEED_FILE: resolve("data", "seed", "tickets.json"),
        TRIAGE_KNOWLEDGE_ROOT: resolve("data", "knowledge"),
        TRIAGE_MINUTES_SAVED: "8",
      },
      now: () => fixedNow,
    });

    await expect(deps.tickets.get("TKT-1005")).resolves.toMatchObject({
      id: "TKT-1005",
      revision: 0,
    });
    expect(deps.minutesPerAcceptedRecommendation).toBe(8);
  });
});
