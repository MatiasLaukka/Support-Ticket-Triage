import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
    await Promise.allSettled([client?.close(), server?.close()]);
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("advertises exactly the six note tools", async () => {
    const result = await client.listTools();

    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      "create_note",
      "delete_note",
      "list_notes",
      "read_note",
      "search_notes",
      "workspace_summary",
    ]);
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

    await expect(
      client.callTool({ name: "list_notes", arguments: {} }),
    ).resolves.toMatchObject({
      content: [
        {
          type: "text",
          text: "alpha: MCP Resources\nbeta: Shopping",
        },
      ],
    });
    await expect(
      client.callTool({
        name: "search_notes",
        arguments: { query: "local context" },
      }),
    ).resolves.toMatchObject({
      content: [{ type: "text", text: "alpha: MCP Resources" }],
    });
    await expect(
      client.callTool({
        name: "search_notes",
        arguments: { query: "absent" },
      }),
    ).resolves.toMatchObject({
      content: [{ type: "text", text: 'No notes match "absent".' }],
    });
    await expect(
      client.callTool({ name: "workspace_summary", arguments: {} }),
    ).resolves.toMatchObject({
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
