import { resolve } from "node:path";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { NoteStore } from "./note-store.js";
import { createKnowledgeDeskServer } from "./server.js";

async function main(): Promise<void> {
  const notesDirectory = resolve(
    process.env.KNOWLEDGE_DESK_NOTES_DIR ?? "data/notes",
  );
  const store = new NoteStore(notesDirectory);
  const server = createKnowledgeDeskServer(store);

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error("Local Knowledge Desk failed to start:", error);
  process.exitCode = 1;
});
