import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDemoWalkthrough,
  resetRuntimeDirectory,
  verifyDemoRepository,
} from "../scripts/demo-approval-desk.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Approval Desk demo runner helpers", () => {
  it("accepts the project repository", async () => {
    await expect(verifyDemoRepository(process.cwd())).resolves.toBeUndefined();
  });

  it("rejects repositories with a different package name", async () => {
    const root = await mkdtemp(join(tmpdir(), "approval-desk-wrong-repo-"));
    temporaryRoots.push(root);
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "different-package" }),
    );

    await expect(verifyDemoRepository(root)).rejects.toThrow(
      "Refusing demo start: expected package support-ticket-triage-mcp.",
    );
  });

  it("resets runtime data while preserving .gitkeep", async () => {
    const root = await mkdtemp(join(tmpdir(), "approval-desk-runtime-"));
    temporaryRoots.push(root);
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "support-ticket-triage-mcp" }),
    );
    const runtime = resolve(root, "data", "runtime");
    await mkdir(join(runtime, "nested"), { recursive: true });
    await writeFile(join(runtime, ".gitkeep"), "");
    await writeFile(join(runtime, "recommendations.json"), "[]");
    await writeFile(join(runtime, "nested", "audit.json"), "[]");

    await resetRuntimeDirectory(root);

    await expect(readFile(join(runtime, ".gitkeep"), "utf8")).resolves.toBe("");
    await expect(readFile(join(runtime, "recommendations.json"))).rejects.toThrow();
    await expect(readFile(join(runtime, "nested", "audit.json"))).rejects.toThrow();
  });

  it("creates the runtime directory when it is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "approval-desk-missing-runtime-"));
    temporaryRoots.push(root);
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "support-ticket-triage-mcp" }),
    );
    const runtime = resolve(root, "data", "runtime");

    await resetRuntimeDirectory(root);

    const runtimeStat = await stat(runtime);
    expect(runtimeStat.isDirectory()).toBe(true);
  });

  it("refuses to reset when the runtime path is not a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "approval-desk-runtime-file-"));
    temporaryRoots.push(root);
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "support-ticket-triage-mcp" }),
    );
    await mkdir(join(root, "data"));
    await writeFile(resolve(root, "data", "runtime"), "not a directory");

    await expect(resetRuntimeDirectory(root)).rejects.toThrow(
      "is not a directory.",
    );
  });

  it("builds a concise suggested walkthrough", () => {
    const walkthrough = buildDemoWalkthrough("http://127.0.0.1:5177");

    expect(walkthrough).toContain("Approval Desk demo ready:");
    expect(walkthrough).toContain("Select TKT-1005");
    expect(walkthrough).toContain("Create a recommendation");
    expect(walkthrough).toContain(
      "Review the evidence dashboard and prompt-injection warning",
    );
    expect(walkthrough).toContain("Approve named fields");
    expect(walkthrough).toContain("Confirm dashboard metrics");
    expect(walkthrough).toContain("audit trail");
    expect(walkthrough).toContain("Press Ctrl+C to stop the local demo server");
  });
});
