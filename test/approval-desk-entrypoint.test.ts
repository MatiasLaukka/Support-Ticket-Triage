import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Readable } from "node:stream";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const PROCESS_TIMEOUT_MS = 10_000;
const PROCESS_SHUTDOWN_TIMEOUT_MS = 2_000;
const REQUEST_TIMEOUT_MS = 5_000;
const INTEGRATION_TEST_TIMEOUT_MS = 20_000;
const temporaryRoots: string[] = [];

interface ProcessOutput {
  stdout: string;
  stderr: string;
}

interface ProcessResult extends ProcessOutput {
  code: number | null;
}

function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = PROCESS_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
        timeoutMs,
      );
    }),
  ]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

async function spawnApprovalDesk(
  env: NodeJS.ProcessEnv,
): Promise<{
  child: ChildProcessByStdio<null, Readable, Readable>;
  output: ProcessOutput;
  close: Promise<number | null>;
}> {
  const dataRoot = await mkdtemp(join(tmpdir(), "approval-desk-entrypoint-"));
  temporaryRoots.push(dataRoot);
  const child = spawn(process.execPath, ["dist/src/approval-desk.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TRIAGE_DATA_ROOT: dataRoot,
      TRIAGE_SEED_FILE: resolve("data", "seed", "tickets.json"),
      TRIAGE_KNOWLEDGE_ROOT: resolve("data", "knowledge"),
      TRIAGE_MINUTES_SAVED: "8",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const output: ProcessOutput = { stdout: "", stderr: "" };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    output.stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    output.stderr += chunk;
  });
  const close = new Promise<number | null>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", resolveExit);
  });
  return { child, output, close };
}

async function stopProcess(
  child: ChildProcessByStdio<null, Readable, Readable>,
  close: Promise<number | null>,
): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    await withTimeout(
      close,
      "approval desk process shutdown",
      PROCESS_SHUTDOWN_TIMEOUT_MS,
    );
  }
}

async function runStartupProcess(env: NodeJS.ProcessEnv): Promise<ProcessResult> {
  const { child, output, close } = await spawnApprovalDesk(env);
  try {
    const code = await withTimeout(close, "approval desk process");
    return { code, ...output };
  } finally {
    await stopProcess(child, close);
  }
}

async function waitForListenUrl(output: ProcessOutput): Promise<URL> {
  const deadline = Date.now() + PROCESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const match = /Approval Desk listening at (http:\/\/(?:\[[^\]]+\]|[^:\s]+):\d+)\./.exec(
      output.stdout,
    );
    if (match !== null) {
      return new URL(match[1]!);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error("Approval Desk listen URL was not printed.");
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("compiled approval desk entrypoint", () => {
  it("listens on an ephemeral local port and serves the Approval Desk UI", async () => {
    const { child, output, close } = await spawnApprovalDesk({
      APPROVAL_DESK_PORT: "0",
    });

    try {
      const url = await waitForListenUrl(output);
      expect(url.hostname).toBe("127.0.0.1");
      expect(Number(url.port)).toBeGreaterThan(0);

      const response = await withTimeout(
        fetch(url),
        "approval desk root request",
        REQUEST_TIMEOUT_MS,
      );
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(body).toContain("<title>Approval Desk</title>");
      expect(body).toContain("Evaluate ticket");
      expect(body).toContain("Done");
      expect(output.stderr).toBe("");
    } finally {
      await stopProcess(child, close);
    }
  }, INTEGRATION_TEST_TIMEOUT_MS);

  it("rejects an invalid port with safe startup stderr and no stack trace", async () => {
    const result = await runStartupProcess({ APPROVAL_DESK_PORT: "65536" });

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.replaceAll("\r\n", "\n")).toBe(
      [
        "Approval Desk failed to start.",
        "APPROVAL_DESK_PORT must be an integer from 0 to 65535.",
        "",
      ].join("\n"),
    );
    expect(result.stderr).not.toContain("at ");
  }, INTEGRATION_TEST_TIMEOUT_MS);

  it("rejects a blank host instead of binding to an unspecified address", async () => {
    const result = await runStartupProcess({ APPROVAL_DESK_HOST: " \t " });

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.replaceAll("\r\n", "\n")).toBe(
      [
        "Approval Desk failed to start.",
        "APPROVAL_DESK_HOST must not be blank.",
        "",
      ].join("\n"),
    );
    expect(result.stderr).not.toContain("at ");
  }, INTEGRATION_TEST_TIMEOUT_MS);

  it("prints a valid bracketed URL for IPv6 hosts", async () => {
    const { child, output, close } = await spawnApprovalDesk({
      APPROVAL_DESK_HOST: "::1",
      APPROVAL_DESK_PORT: "0",
    });

    try {
      const url = await waitForListenUrl(output);

      expect(url.hostname).toBe("[::1]");
      expect(output.stdout).toContain("Approval Desk listening at http://[::1]:");
    } finally {
      await stopProcess(child, close);
    }
  }, INTEGRATION_TEST_TIMEOUT_MS);
});
