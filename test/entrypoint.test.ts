import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

const PROCESS_TIMEOUT_MS = 10_000;
const PROCESS_SHUTDOWN_TIMEOUT_MS = 2_000;
const REQUEST_TIMEOUT_MS = 5_000;
const INTEGRATION_TEST_TIMEOUT_MS = 20_000;
const temporaryRoots: string[] = [];

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

function textOf(result: CallToolResult): string {
  const text = result.content.find((content) => content.type === "text");
  expect(text?.type).toBe("text");
  return text?.type === "text" ? text.text : "";
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function runStartupProcess(
  env: NodeJS.ProcessEnv,
  nodeArgs: string[] = [],
  cwd = process.cwd(),
): Promise<ProcessResult> {
  const root = await mkdtemp(join(tmpdir(), "triage-entrypoint-invalid-"));
  temporaryRoots.push(root);
  const child = spawn(process.execPath, [
    ...nodeArgs,
    resolve("dist", "src", "index.js"),
  ], {
    cwd,
    env: {
      ...process.env,
      TRIAGE_DATA_ROOT: root,
      TRIAGE_SEED_FILE: resolve("data", "seed", "tickets.json"),
      TRIAGE_KNOWLEDGE_ROOT: resolve("data", "knowledge"),
      TRIAGE_MINUTES_SAVED: "8",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const close = new Promise<number | null>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", resolveExit);
  });

  try {
    const code = await withTimeout(
      close,
      "entrypoint process",
    );
    return { code, stdout, stderr };
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await withTimeout(
        close,
        "entrypoint process shutdown",
        PROCESS_SHUTDOWN_TIMEOUT_MS,
      );
    }
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("compiled stdio entrypoint", () => {
  it("initializes MCP, exposes discovery surfaces, serves a ticket, and closes", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "triage-entrypoint-"));
    temporaryRoots.push(dataRoot);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["dist/src/index.js"],
      cwd: process.cwd(),
      env: {
        TRIAGE_DATA_ROOT: dataRoot,
        TRIAGE_SEED_FILE: resolve("data", "seed", "tickets.json"),
        TRIAGE_KNOWLEDGE_ROOT: resolve("data", "knowledge"),
        TRIAGE_MINUTES_SAVED: "8",
      },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    const client = new Client({
      name: "compiled-entrypoint-test",
      version: "1.0.0",
    });

    try {
      await withTimeout(
        client.connect(transport, { timeout: REQUEST_TIMEOUT_MS }),
        "MCP initialization",
      );
      const requestOptions = { timeout: REQUEST_TIMEOUT_MS };
      const tools = await client.listTools(undefined, requestOptions);
      const resources = await client.listResources(undefined, requestOptions);
      const templates = await client.listResourceTemplates(
        undefined,
        requestOptions,
      );
      const prompts = await client.listPrompts(undefined, requestOptions);
      const result = await client.callTool(
        { name: "get_ticket", arguments: { id: "TKT-1001" } },
        undefined,
        requestOptions,
      );

      expect(tools.tools.map(({ name }) => name)).toContain("get_ticket");
      expect(resources.resources.map(({ uri }) => uri)).toContain(
        "metrics://queue",
      );
      expect(templates.resourceTemplates.length).toBeGreaterThan(0);
      expect(prompts.prompts.length).toBeGreaterThan(0);
      expect("content" in result).toBe(true);
      if (!("content" in result)) {
        throw new Error("Expected a synchronous MCP tool result.");
      }
      const toolResult = result as CallToolResult;
      expect(toolResult.isError).not.toBe(true);
      expect(JSON.parse(textOf(toolResult))).toMatchObject({
        ticket: { id: "TKT-1001" },
      });
      await expect(
        stat(resolve(dataRoot, "tickets.json")),
      ).resolves.toBeDefined();
      expect(stderr).toBe("");
    } catch (error) {
      throw new Error(
        `Compiled entrypoint failed: ${
          error instanceof Error ? error.message : String(error)
        }\nChild stderr:\n${stderr || "<empty>"}`,
        { cause: error },
      );
    } finally {
      await withTimeout(client.close(), "MCP client close");
    }
  }, INTEGRATION_TEST_TIMEOUT_MS);

  it("rejects an invalid minutes-saved value without writing protocol stdout", async () => {
    const result = await runStartupProcess({ TRIAGE_MINUTES_SAVED: "-1" });

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "Support ticket triage server failed to start.",
    );
    expect(result.stderr).toContain(
      "TRIAGE_MINUTES_SAVED must be a finite nonnegative number.",
    );
  }, INTEGRATION_TEST_TIMEOUT_MS);

  it.each([
    ["TRIAGE_DATA_ROOT", "", "TRIAGE_DATA_ROOT must not be blank."],
    ["TRIAGE_SEED_FILE", " \t ", "TRIAGE_SEED_FILE must not be blank."],
    ["TRIAGE_KNOWLEDGE_ROOT", "\t", "TRIAGE_KNOWLEDGE_ROOT must not be blank."],
  ] as const)(
    "rejects blank %s before repository use without writing protocol stdout",
    async (name, value, message) => {
      const repositoryRoot = await mkdtemp(
        join(tmpdir(), "triage-entrypoint-cwd-"),
      );
      temporaryRoots.push(repositoryRoot);
      const result = await runStartupProcess(
        { [name]: value },
        [],
        repositoryRoot,
      );

      expect(result.code).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(
        "Support ticket triage server failed to start.",
      );
      expect(result.stderr).toContain(message);
      await expect(
        stat(resolve(repositoryRoot, "tickets.json")),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it("exposes safe DomainError startup messages", async () => {
    const result = await runStartupProcess({
      TRIAGE_SEED_FILE: resolve("missing-entrypoint-seed.json"),
    });

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "Support ticket triage server failed to start.",
    );
    expect(result.stderr).toContain("Repository could not be initialized.");
  }, INTEGRATION_TEST_TIMEOUT_MS);

  it("redacts unexpected startup error details", async () => {
    const root = await mkdtemp(join(tmpdir(), "triage-entrypoint-preload-"));
    temporaryRoots.push(root);
    const preload = resolve(root, "leaking-startup-error.mjs");
    const leakedPath = String.raw`C:\private\customer\tickets.json`;
    await writeFile(
      preload,
      [
        'import process from "node:process";',
        `process.cwd = () => { throw new Error(${JSON.stringify(
          `Cannot access ${leakedPath}`,
        )}); };`,
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runStartupProcess(
      {},
      ["--import", pathToFileURL(preload).href],
    );

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.replaceAll("\r\n", "\n")).toBe(
      [
        "Support ticket triage server failed to start.",
        "Unexpected startup error.",
        "",
      ].join("\n"),
    );
    expect(result.stderr).not.toContain(leakedPath);
    expect(result.stderr).not.toContain("Cannot access");
    expect(result.stderr).not.toContain("at ");
  }, INTEGRATION_TEST_TIMEOUT_MS);
});

describe("Codex MCP configuration", () => {
  it("contains the exact enabled stdio server configuration", async () => {
    const expected = [
      "[mcp_servers.support-ticket-triage]",
      'command = "node"',
      'args = ["dist/src/index.js"]',
      'cwd = "."',
      "startup_timeout_sec = 10",
      "tool_timeout_sec = 30",
      "enabled = true",
      "",
    ].join("\n");
    const config = await readFile(resolve(".codex", "config.toml"), "utf8");

    expect(config.replaceAll("\r\n", "\n")).toBe(expected);
  });
});
