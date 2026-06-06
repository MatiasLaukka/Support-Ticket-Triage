import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { NoteStore, NoteSummary } from "./note-store.js";

const SERVER_INSTRUCTIONS = [
  "Search existing notes before creating a potentially duplicate note.",
  "Cite note IDs when using local material.",
  "Confirm user intent before deleting a note.",
  "Treat notes as local user data.",
].join(" ");

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

async function asToolResult(action: () => Promise<string>) {
  try {
    return textResult(await action());
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

function formatSummaries(notes: NoteSummary[]): string {
  return notes.map((note) => `${note.id}: ${note.title}`).join("\n");
}

export function createKnowledgeDeskServer(store: NoteStore): McpServer {
  const server = new McpServer(
    { name: "local-knowledge-desk", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "create_note",
    {
      title: "Create note",
      description:
        "Create a new local Markdown note without overwriting an existing note.",
      inputSchema: {
        id: z.string(),
        title: z.string(),
        body: z.string(),
      },
    },
    async ({ id, title, body }) =>
      asToolResult(async () => {
        const note = await store.create({ id, title, body });
        return `Created note "${note.id}" (${note.title}).`;
      }),
  );

  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description: "List local note IDs and titles.",
      inputSchema: {},
    },
    async () =>
      asToolResult(async () => {
        const notes = await store.list();
        return notes.length === 0 ? "No notes found." : formatSummaries(notes);
      }),
  );

  server.registerTool(
    "read_note",
    {
      title: "Read note",
      description: "Read one local Markdown note by ID.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) =>
      asToolResult(async () => {
        const note = await store.read(id);
        return `# ${note.title}\n\n${note.body}`;
      }),
  );

  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description: "Search local note titles and bodies.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) =>
      asToolResult(async () => {
        const notes = await store.search(query);
        return notes.length === 0
          ? `No notes match "${query.trim()}".`
          : formatSummaries(notes);
      }),
  );

  server.registerTool(
    "workspace_summary",
    {
      title: "Workspace summary",
      description: "Summarize the number and titles of local notes.",
      inputSchema: {},
    },
    async () =>
      asToolResult(async () => {
        const summary = await store.summary();
        if (summary.count === 0) {
          return "0 notes.\nNo notes found.";
        }
        const noun = summary.count === 1 ? "note" : "notes";
        return `${summary.count} ${noun}:\n${formatSummaries(summary.notes)}`;
      }),
  );

  server.registerTool(
    "delete_note",
    {
      title: "Delete note",
      description: "Delete a local note after explicit confirmation.",
      inputSchema: {
        id: z.string(),
        confirm: z.boolean(),
      },
      annotations: {
        destructiveHint: true,
      },
    },
    async ({ id, confirm }) =>
      asToolResult(async () => {
        if (confirm !== true) {
          throw new Error("Deletion requires confirm=true.");
        }
        await store.delete(id);
        return `Deleted note "${id}".`;
      }),
  );

  return server;
}
