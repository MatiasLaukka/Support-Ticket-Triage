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

  it("lists stored notes as resources and advertises the note template", async () => {
    await store.create({
      id: "mcp-resources",
      title: "MCP Resources",
      body: "Resources expose local context.",
    });

    const listed = await client.listResources();
    expect(listed.resources).toEqual([
      {
        uri: "note://mcp-resources",
        name: "MCP Resources",
        title: "Local note",
        description: "Local note mcp-resources",
        mimeType: "text/markdown",
      },
    ]);

    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates).toEqual([
      {
        uriTemplate: "note://{id}",
        name: "note",
        title: "Local note",
        description: "A Markdown note stored by the Local Knowledge Desk",
        mimeType: "text/markdown",
      },
    ]);
  });

  it("updates listed resources after notes are created and deleted", async () => {
    expect((await client.listResources()).resources).toEqual([]);

    await store.create({
      id: "dynamic-resource",
      title: "Dynamic Resource",
      body: "Appears through discovery.",
    });
    expect((await client.listResources()).resources).toEqual([
      expect.objectContaining({
        uri: "note://dynamic-resource",
        name: "Dynamic Resource",
      }),
    ]);

    await store.delete("dynamic-resource");
    expect((await client.listResources()).resources).toEqual([]);
  });

  it("does not expose unexpected storage errors while listing resources", async () => {
    vi.spyOn(store, "list").mockRejectedValueOnce(
      new Error("EACCES C:\\secret\\resource-list"),
    );
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    let rejection: unknown;
    try {
      await client.listResources();
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain(
      "Unexpected local storage error.",
    );
    expect(String(rejection)).not.toContain("C:\\secret\\resource-list");
    expect(stderr).toHaveBeenCalled();
  });

  it("reads exact Markdown through the note resource", async () => {
    await store.create({
      id: "resource-read",
      title: "Resource Read",
      body: "Exact body.",
    });

    const result = await client.readResource({
      uri: "note://resource-read",
    });

    expect(result.contents).toEqual([
      {
        uri: "note://resource-read",
        mimeType: "text/markdown",
        text: "# Resource Read\n\nExact body.",
      },
    ]);
  });

  it("rejects missing and invalid note resources without leaking internals", async () => {
    await expect(
      client.readResource({ uri: "note://missing" }),
    ).rejects.toThrow('Note "missing" does not exist.');
    await expect(
      client.readResource({ uri: "note://bad_id" }),
    ).rejects.toThrow('Invalid note ID: "bad_id".');

    vi.spyOn(store, "read").mockRejectedValueOnce(
      new Error("EACCES C:\\secret\\resource"),
    );
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      client.readResource({ uri: "note://private" }),
    ).rejects.toThrow("Unexpected local storage error.");
    expect(stderr).toHaveBeenCalled();
  });

  it("advertises the two review prompts with argument metadata", async () => {
    const result = await client.listPrompts();

    expect(result.prompts.map((prompt) => prompt.name)).toEqual([
      "daily_review",
      "research_digest",
    ]);
    expect(result.prompts).toEqual([
      expect.objectContaining({
        name: "daily_review",
        description: expect.stringMatching(/review/i),
        arguments: undefined,
      }),
      expect.objectContaining({
        name: "research_digest",
        description: expect.stringMatching(/research|digest/i),
        arguments: [
          {
            name: "topic",
            description: expect.stringMatching(/topic/i),
            required: true,
          },
        ],
      }),
    ]);
  });

  it("returns workflow instructions for both prompts", async () => {
    const daily = await client.getPrompt({
      name: "daily_review",
      arguments: {},
    });
    expect(daily.messages).toHaveLength(1);
    expect(daily.messages[0]).toMatchObject({
      role: "user",
      content: {
        type: "text",
        text: expect.stringMatching(
          /list_notes[\s\S]*read_note[\s\S]*cite[\s\S]*note IDs/i,
        ),
      },
    });

    const research = await client.getPrompt({
      name: "research_digest",
      arguments: { topic: "MCP resource design" },
    });
    expect(research.messages).toHaveLength(1);
    expect(research.messages[0]).toMatchObject({
      role: "user",
      content: {
        type: "text",
        text: expect.stringMatching(
          /MCP resource design[\s\S]*search_notes[\s\S]*read[\s\S]*cite[\s\S]*note ID/i,
        ),
      },
    });
  });

  it.each([
    ["missing", {}],
    ["empty", { topic: "" }],
    ["whitespace-only", { topic: "   " }],
  ])("rejects a %s research digest topic", async (_case, args) => {
    await expect(
      client.getPrompt({
        name: "research_digest",
        arguments: args,
      }),
    ).rejects.toThrow(/invalid arguments/i);
  });
});
