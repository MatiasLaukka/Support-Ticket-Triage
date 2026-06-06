import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NoteStore } from "../src/note-store.js";
import { createKnowledgeDeskServer } from "../src/server.js";

describe("knowledge desk MCP tools", () => {
  let tempRoot: string;
  let store: NoteStore;
  let server: McpServer;
  let client: Client;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "knowledge-desk-server-"));
    store = new NoteStore(path.join(tempRoot, "notes"));
    server = createKnowledgeDeskServer(store);
    client = new Client({ name: "test-client", version: "1.0.0" });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    let closeResults: PromiseSettledResult<void>[] = [];

    try {
      closeResults = await Promise.allSettled([
        Promise.resolve().then(() => client.close()),
        Promise.resolve().then(() => server.close()),
      ]);
    } finally {
      try {
        await rm(tempRoot, { recursive: true, force: true });
      } finally {
        vi.restoreAllMocks();
      }
    }

    const closeFailures = closeResults.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (closeFailures.length > 0) {
      throw new AggregateError(closeFailures, "Failed to close MCP resources.");
    }
  });

  it("advertises exactly the six described note tools with annotations", async () => {
    const result = await client.listTools();

    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      "create_note",
      "delete_note",
      "list_notes",
      "read_note",
      "search_notes",
      "workspace_summary",
    ]);
    expect(result.tools.every((tool) => Boolean(tool.description?.trim()))).toBe(
      true,
    );
    expect(result.tools.find((tool) => tool.name === "create_note")).toMatchObject(
      {
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
    );
    expect(result.tools.find((tool) => tool.name === "read_note")).toMatchObject({
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
    expect(result.tools.find((tool) => tool.name === "delete_note")).toMatchObject(
      {
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
    );
  });

  it("creates and reads exact Markdown without a trailing newline", async () => {
    const created = await client.callTool({
      name: "create_note",
      arguments: {
        id: "mcp-basics",
        title: "MCP Basics",
        body: "Tools perform actions.",
      },
    });

    expect(created.isError).not.toBe(true);
    expect(created).toMatchObject({
      content: [
        {
          type: "text",
          text: 'Created note "mcp-basics" (MCP Basics).',
        },
      ],
    });

    const read = await client.callTool({
      name: "read_note",
      arguments: { id: "mcp-basics" },
    });
    expect(read.isError).not.toBe(true);
    expect(read).toMatchObject({
      content: [
        {
          type: "text",
          text: "# MCP Basics\n\nTools perform actions.",
        },
      ],
    });
  });

  it("lists, searches, and summarizes representative notes", async () => {
    await store.create({
      id: "alpha",
      title: "MCP Resources",
      body: "Resources expose local context.",
    });
    await store.create({
      id: "beta",
      title: "Shopping",
      body: "Buy tea.",
    });

    const listed = await client.callTool({
      name: "list_notes",
      arguments: {},
    });
    expect(listed.isError).not.toBe(true);
    expect(listed).toMatchObject({
      content: [
        {
          type: "text",
          text: "alpha: MCP Resources\nbeta: Shopping",
        },
      ],
    });
    const matched = await client.callTool({
      name: "search_notes",
      arguments: { query: "local context" },
    });
    expect(matched.isError).not.toBe(true);
    expect(matched).toMatchObject({
      content: [{ type: "text", text: "alpha: MCP Resources" }],
    });
    const unmatched = await client.callTool({
      name: "search_notes",
      arguments: { query: "absent" },
    });
    expect(unmatched.isError).not.toBe(true);
    expect(unmatched).toMatchObject({
      content: [{ type: "text", text: 'No notes match "absent".' }],
    });
    const summary = await client.callTool({
      name: "workspace_summary",
      arguments: {},
    });
    expect(summary.isError).not.toBe(true);
    expect(summary).toMatchObject({
      content: [
        {
          type: "text",
          text: "2 notes:\nalpha: MCP Resources\nbeta: Shopping",
        },
      ],
    });
  });

  it("reports a missing read as a tool error without crashing", async () => {
    const missing = await client.callTool({
      name: "read_note",
      arguments: { id: "missing" },
    });

    expect(missing).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: 'Note "missing" does not exist.',
        },
      ],
    });
    await expect(client.listTools()).resolves.toHaveProperty("tools");
  });

  it("preserves exact NoteStore validation errors", async () => {
    const result = await client.callTool({
      name: "read_note",
      arguments: { id: "bad\nid" },
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: 'Invalid note ID: "bad\nid".',
        },
      ],
    });
  });

  it("does not expose unexpected local storage errors", async () => {
    vi.spyOn(store, "list").mockRejectedValueOnce(
      new Error("EACCES C:\\secret\\path"),
    );
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await client.callTool({
      name: "list_notes",
      arguments: {},
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "Unexpected local storage error.",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("C:\\secret\\path");
    expect(stderr).toHaveBeenCalled();
  });

  it("rejects deletion without confirmation and preserves the note", async () => {
    await store.create({
      id: "keep-me",
      title: "Keep Me",
      body: "Important.",
    });

    const result = await client.callTool({
      name: "delete_note",
      arguments: { id: "keep-me", confirm: false },
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "Deletion requires confirm=true.",
        },
      ],
    });
    await expect(store.read("keep-me")).resolves.toMatchObject({
      id: "keep-me",
    });
  });

  it("deletes a note when explicitly confirmed", async () => {
    await store.create({
      id: "remove-me",
      title: "Remove Me",
      body: "Temporary.",
    });

    const result = await client.callTool({
      name: "delete_note",
      arguments: { id: "remove-me", confirm: true },
    });

    expect(result.isError).not.toBe(true);
    expect(result).toMatchObject({
      content: [
        {
          type: "text",
          text: 'Deleted note "remove-me".',
        },
      ],
    });
    await expect(store.read("remove-me")).rejects.toThrow(
      'Note "remove-me" does not exist.',
    );
  });

  it("handles invalid input through the protocol schema", async () => {
    const result = await client.callTool({
      name: "create_note",
      arguments: {
        id: "missing-body",
        title: "Missing Body",
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("Invalid arguments for tool create_note"),
      }),
    ]);
    await expect(client.listTools()).resolves.toHaveProperty("tools");
  });
});
