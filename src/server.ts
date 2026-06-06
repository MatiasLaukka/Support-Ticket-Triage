import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
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

const KNOWN_DOMAIN_ERRORS = new Set([
  "Title must be a single line.",
  "Title is required.",
  "Body is required.",
  "Search query is required.",
  "Notes directory must not be a symbolic link.",
  "Notes directory must be a directory.",
  "Deletion requires confirm=true.",
]);

const KNOWN_NOTE_ERROR_PATTERNS = [
  /^Invalid note ID: "[\s\S]*"\.$/,
  /^Note "[a-z0-9-]+" already exists\.$/,
  /^Note "[a-z0-9-]+" does not exist\.$/,
  /^Note "[a-z0-9-]+" must be a regular file\.$/,
  /^Note "[a-z0-9-]+" has a malformed Markdown heading\.$/,
];

function isKnownDomainError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (KNOWN_DOMAIN_ERRORS.has(error.message) ||
      KNOWN_NOTE_ERROR_PATTERNS.some((pattern) => pattern.test(error.message)))
  );
}

async function asToolResult(action: () => Promise<string>) {
  try {
    return textResult(await action());
  } catch (error) {
    if (!isKnownDomainError(error)) {
      console.error("Unexpected local storage error:", error);
    }

    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: isKnownDomainError(error)
            ? error.message
            : "Unexpected local storage error.",
        },
      ],
    };
  }
}

async function asResourceResult<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!isKnownDomainError(error)) {
      console.error("Unexpected local storage error:", error);
    }

    throw new McpError(
      isKnownDomainError(error)
        ? ErrorCode.InvalidParams
        : ErrorCode.InternalError,
      isKnownDomainError(error)
        ? error.message
        : "Unexpected local storage error.",
    );
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

  server.registerResource(
    "note",
    new ResourceTemplate("note://{id}", {
      list: async () => ({
        resources: (await store.list()).map((note) => ({
          uri: `note://${note.id}`,
          name: note.title,
          description: `Local note ${note.id}`,
          mimeType: "text/markdown",
        })),
      }),
    }),
    {
      title: "Local note",
      description: "A Markdown note stored by the Local Knowledge Desk",
      mimeType: "text/markdown",
    },
    async (uri, variables) =>
      asResourceResult(async () => {
        const id = variables.id;
        if (typeof id !== "string") {
          throw new Error('Invalid note ID: "".');
        }
        const note = await store.read(id);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/markdown",
              text: `# ${note.title}\n\n${note.body}`,
            },
          ],
        };
      }),
  );

  server.registerPrompt(
    "daily_review",
    {
      description:
        "Review local notes to identify the day's most important priorities.",
    },
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Call list_notes, inspect the relevant notes, identify the highest priorities, and return a concise daily review that cites note IDs.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "research_digest",
    {
      description:
        "Research a topic across local notes and produce a sourced digest.",
      argsSchema: {
        topic: z
          .string()
          .describe("The research topic to investigate in local notes."),
      },
    },
    async ({ topic }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Research topic: ${topic}\n\nCall search_notes for this topic, read matching notes with read_note, synthesize the findings, and cite every source note ID.`,
          },
        },
      ],
    }),
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
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
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
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
