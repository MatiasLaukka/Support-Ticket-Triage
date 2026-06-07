import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vitest";

const OPERATION_TIMEOUT_MS = 3_000;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout<T>(
  operation: Promise<T>,
  label: string,
  diagnostics: () => string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} timed out after ${OPERATION_TIMEOUT_MS}ms.`));
        }, OPERATION_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    const details = diagnostics();
    throw new Error(
      `${label} failed: ${describeError(error)}${details ? `\n${details}` : ""}`,
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

it(
  "completes the stdio MCP handshake and advertises all note tools",
  async () => {
    const tempDirectory = await mkdtemp(
      path.join(tmpdir(), "knowledge-desk-entrypoint-"),
    );
    const entrypoint = path.resolve("dist/src/index.js");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint],
      cwd: process.cwd(),
      env: {
        ...getDefaultEnvironment(),
        KNOWLEDGE_DESK_NOTES_DIR: path.join(tempDirectory, "notes"),
      },
      stderr: "pipe",
    });
    const client = new Client({
      name: "entrypoint-test-client",
      version: "1.0.0",
    });
    let stderr = "";
    let transportError: Error | undefined;

    transport.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    transport.onerror = (error) => {
      transportError = error;
    };

    const diagnostics = () =>
      [
        transportError
          ? `Transport error: ${describeError(transportError)}`
          : "",
        stderr.trim() ? `Server stderr:\n${stderr.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n");

    try {
      await withTimeout(client.connect(transport), "MCP connect", diagnostics);

      expect(client.getServerVersion()).toEqual({
        name: "local-knowledge-desk",
        version: "1.0.0",
      });

      const result = await withTimeout(
        client.listTools(),
        "MCP tools/list",
        diagnostics,
      );
      expect(transportError, diagnostics()).toBeUndefined();
      expect(result.tools.map((tool) => tool.name).sort()).toEqual([
        "create_note",
        "delete_note",
        "list_notes",
        "read_note",
        "search_notes",
        "workspace_summary",
      ]);
    } finally {
      try {
        await withTimeout(client.close(), "MCP client close", diagnostics);
      } finally {
        await rm(tempDirectory, { recursive: true, force: true });
      }
    }
  },
  12_000,
);
