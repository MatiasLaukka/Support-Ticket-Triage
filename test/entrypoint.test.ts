import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    child.once("exit", () => resolve());
  });
}

async function expectProcessToRemainAlive(
  child: ChildProcess,
  durationMs: number,
  getStderr: () => string,
): Promise<void> {
  const deadline = Date.now() + durationMs;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Entrypoint exited early with code ${child.exitCode} and signal ${child.signalCode}.\n${getStderr()}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

it("starts the stdio server without writing to stdout", async () => {
  const tempDirectory = await mkdtemp(
    path.join(tmpdir(), "knowledge-desk-entrypoint-"),
  );
  const entrypoint = path.resolve("dist/src/index.js");
  const child = spawn(process.execPath, [entrypoint], {
    env: {
      ...process.env,
      KNOWLEDGE_DESK_NOTES_DIR: path.join(tempDirectory, "notes"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  try {
    await expectProcessToRemainAlive(child, 200, () => stderr);

    expect(child.exitCode, stderr).toBeNull();
    expect(stdout).toBe("");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
    await waitForExit(child);
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
