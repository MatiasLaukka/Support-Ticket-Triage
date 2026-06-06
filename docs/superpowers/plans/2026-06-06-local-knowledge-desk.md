# Local Knowledge Desk MCP Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully local TypeScript MCP server that lets Codex create, inspect, search, summarize, and safely delete Markdown notes while demonstrating MCP tools, resources, prompts, and server instructions.

**Architecture:** A small `NoteStore` owns validated filesystem access under `data/notes/`. A separate MCP registration module adapts that store into tools, resources, and prompts, while the executable entry point only selects the note directory and connects stdio. Vitest covers storage behavior and drives the server through the official in-memory client/server transport.

**Tech Stack:** Node.js 20+, TypeScript, official MCP TypeScript SDK v2 packages, Zod 4, Vitest

---

## File Map

- `package.json`: scripts, runtime dependencies, and development tooling.
- `tsconfig.json`: strict ESM TypeScript build configuration.
- `.gitignore`: generated files, dependencies, and runtime note data.
- `src/note-store.ts`: note validation, Markdown parsing, and filesystem operations.
- `src/server.ts`: MCP server construction and capability registration.
- `src/index.ts`: stdio executable entry point and startup error handling.
- `test/note-store.test.ts`: storage and safety behavior.
- `test/server.test.ts`: MCP discovery, tool calls, resources, prompts, and errors.
- `.codex/config.toml`: project-scoped Codex MCP server configuration.
- `data/notes/.gitkeep`: keeps the local note directory in the repository.
- `README.md`: teaching tutorial, examples, extension guide, and optional Claude setup.

### Task 1: Scaffold the TypeScript Test Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `data/notes/.gitkeep`
- Create: `test/scaffold.test.ts`

- [ ] **Step 1: Create the package manifest and compiler configuration**

Create `package.json`:

```json
{
  "name": "local-knowledge-desk-mcp",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "A local TypeScript MCP tutorial for Codex",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/server": "^2.0.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@modelcontextprotocol/client": "^2.0.0",
    "@types/node": "^24.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
data/notes/*.md
```

Create the empty `data/notes/.gitkeep`.

- [ ] **Step 2: Install dependencies**

Run: `npm install`

Expected: dependencies install and `package-lock.json` is created.

- [ ] **Step 3: Write a failing scaffold test**

Create `test/scaffold.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { NOTE_ID_PATTERN } from "../src/note-store.js";

describe("project scaffold", () => {
  it("exports the note ID rule", () => {
    expect(NOTE_ID_PATTERN.test("first-note")).toBe(true);
  });
});
```

- [ ] **Step 4: Run the test to verify RED**

Run: `npm test -- test/scaffold.test.ts`

Expected: FAIL because `src/note-store.ts` does not exist.

- [ ] **Step 5: Add the minimal exported rule**

Create `src/note-store.ts`:

```typescript
export const NOTE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
```

- [ ] **Step 6: Run the test and build to verify GREEN**

Run: `npm test -- test/scaffold.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: TypeScript exits successfully.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json tsconfig.json .gitignore data/notes/.gitkeep src/note-store.ts test/scaffold.test.ts
git commit -m "build: scaffold TypeScript MCP project"
```

### Task 2: Implement Validated Markdown Note Storage

**Files:**
- Modify: `src/note-store.ts`
- Create: `test/note-store.test.ts`
- Delete: `test/scaffold.test.ts`

- [ ] **Step 1: Write failing tests for note lifecycle and validation**

Create `test/note-store.test.ts`:

```typescript
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NoteStore } from "../src/note-store.js";

describe("NoteStore", () => {
  let root: string;
  let store: NoteStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "knowledge-desk-"));
    store = new NoteStore(root);
  });

  afterEach(async () => {
    await store.clear();
  });

  it("creates and reads a Markdown note", async () => {
    await store.create({ id: "mcp-basics", title: "MCP Basics", body: "Tools perform actions." });

    await expect(store.read("mcp-basics")).resolves.toEqual({
      id: "mcp-basics",
      title: "MCP Basics",
      body: "Tools perform actions."
    });
    await expect(readFile(join(root, "mcp-basics.md"), "utf8"))
      .resolves.toBe("# MCP Basics\n\nTools perform actions.\n");
  });

  it("lists notes in ID order", async () => {
    await store.create({ id: "z-last", title: "Last", body: "Z" });
    await store.create({ id: "a-first", title: "First", body: "A" });

    await expect(store.list()).resolves.toEqual([
      { id: "a-first", title: "First" },
      { id: "z-last", title: "Last" }
    ]);
  });

  it("searches titles and bodies case-insensitively", async () => {
    await store.create({ id: "protocol", title: "MCP Protocol", body: "Resources expose context." });
    await store.create({ id: "shopping", title: "Shopping", body: "Buy tea." });

    await expect(store.search("RESOURCES")).resolves.toEqual([
      { id: "protocol", title: "MCP Protocol" }
    ]);
  });

  it("summarizes the workspace", async () => {
    await store.create({ id: "one", title: "One", body: "First." });
    await store.create({ id: "two", title: "Two", body: "Second." });

    await expect(store.summary()).resolves.toEqual({
      count: 2,
      notes: [
        { id: "one", title: "One" },
        { id: "two", title: "Two" }
      ]
    });
  });

  it("deletes a confirmed note", async () => {
    await store.create({ id: "temporary", title: "Temporary", body: "Remove me." });
    await store.delete("temporary");

    await expect(store.read("temporary")).rejects.toThrow('Note "temporary" does not exist.');
  });

  it.each(["", "../secret", "UPPERCASE", "-leading", "trailing-", "a".repeat(65)])(
    "rejects invalid note ID %j",
    async (id) => {
      await expect(store.create({ id, title: "Title", body: "Body" }))
        .rejects.toThrow("Invalid note ID");
    }
  );

  it("rejects duplicate IDs", async () => {
    await store.create({ id: "same", title: "First", body: "One" });
    await expect(store.create({ id: "same", title: "Second", body: "Two" }))
      .rejects.toThrow('Note "same" already exists.');
  });

  it.each([
    { id: "blank-title", title: "   ", body: "Body", message: "Title is required." },
    { id: "blank-body", title: "Title", body: "   ", message: "Body is required." }
  ])("rejects empty note content", async ({ id, title, body, message }) => {
    await expect(store.create({ id, title, body })).rejects.toThrow(message);
  });
});
```

Remove `test/scaffold.test.ts`.

- [ ] **Step 2: Run the storage tests to verify RED**

Run: `npm test -- test/note-store.test.ts`

Expected: FAIL because `NoteStore` is not exported.

- [ ] **Step 3: Implement the minimal storage class**

Replace `src/note-store.ts` with:

```typescript
import { mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export const NOTE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export interface NoteInput {
  id: string;
  title: string;
  body: string;
}

export interface Note extends NoteInput {}

export interface NoteSummary {
  id: string;
  title: string;
}

function parseMarkdown(id: string, markdown: string): Note {
  const normalized = markdown.replace(/\r\n/g, "\n").replace(/\n$/, "");
  const [heading, ...bodyLines] = normalized.split("\n");
  if (!heading.startsWith("# ")) {
    throw new Error(`Note "${id}" has an invalid Markdown heading.`);
  }
  const body = bodyLines[0] === "" ? bodyLines.slice(1).join("\n") : bodyLines.join("\n");
  return { id, title: heading.slice(2), body };
}

export class NoteStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(id: string): string {
    if (!NOTE_ID_PATTERN.test(id)) {
      throw new Error("Invalid note ID. Use 1-64 lowercase letters, digits, and hyphens.");
    }
    const path = resolve(this.root, `${id}.md`);
    if (!path.startsWith(`${this.root}${sep}`)) {
      throw new Error("Invalid note path.");
    }
    return path;
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async create(input: NoteInput): Promise<Note> {
    const path = this.pathFor(input.id);
    const title = input.title.trim();
    const body = input.body.trim();
    if (!title) throw new Error("Title is required.");
    if (!body) throw new Error("Body is required.");
    await this.ensureRoot();
    try {
      await writeFile(path, `# ${title}\n\n${body}\n`, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`Note "${input.id}" already exists.`);
      }
      throw error;
    }
    return { id: input.id, title, body };
  }

  async read(id: string): Promise<Note> {
    const path = this.pathFor(id);
    try {
      return parseMarkdown(id, await readFile(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Note "${id}" does not exist.`);
      }
      throw error;
    }
  }

  async list(): Promise<NoteSummary[]> {
    await this.ensureRoot();
    const files = (await readdir(this.root)).filter((file) => file.endsWith(".md")).sort();
    return Promise.all(files.map(async (file) => {
      const note = await this.read(file.slice(0, -3));
      return { id: note.id, title: note.title };
    }));
  }

  async search(query: string): Promise<NoteSummary[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) throw new Error("Search query is required.");
    const notes = await this.list();
    const matches: NoteSummary[] = [];
    for (const summary of notes) {
      const note = await this.read(summary.id);
      if (`${note.title}\n${note.body}`.toLowerCase().includes(normalized)) matches.push(summary);
    }
    return matches;
  }

  async summary(): Promise<{ count: number; notes: NoteSummary[] }> {
    const notes = await this.list();
    return { count: notes.length, notes };
  }

  async delete(id: string): Promise<void> {
    const path = this.pathFor(id);
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Note "${id}" does not exist.`);
      }
      throw error;
    }
  }

  async clear(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
    await mkdir(dirname(this.root), { recursive: true });
  }
}
```

- [ ] **Step 4: Run tests and build to verify GREEN**

Run: `npm test -- test/note-store.test.ts`

Expected: all storage tests PASS.

Run: `npm run build`

Expected: TypeScript exits successfully.

- [ ] **Step 5: Commit**

```powershell
git add src/note-store.ts test/note-store.test.ts test/scaffold.test.ts
git commit -m "feat: add local Markdown note storage"
```

### Task 3: Register MCP Tools

**Files:**
- Create: `src/server.ts`
- Create: `test/server.test.ts`

- [ ] **Step 1: Write failing protocol tests for tool discovery and calls**

Create `test/server.test.ts`:

```typescript
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/client/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NoteStore } from "../src/note-store.js";
import { createKnowledgeDeskServer } from "../src/server.js";

describe("knowledge desk MCP server", () => {
  let store: NoteStore;
  let client: Client;

  beforeEach(async () => {
    store = new NoteStore(await mkdtemp(join(tmpdir(), "knowledge-desk-server-")));
    const server = createKnowledgeDeskServer(store);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await store.clear();
  });

  it("advertises all note tools", async () => {
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      "create_note",
      "delete_note",
      "list_notes",
      "read_note",
      "search_notes",
      "workspace_summary"
    ]);
  });

  it("creates and reads a note through MCP", async () => {
    const created = await client.callTool({
      name: "create_note",
      arguments: { id: "mcp-basics", title: "MCP Basics", body: "Tools perform actions." }
    });
    expect(created.isError).not.toBe(true);

    const read = await client.callTool({
      name: "read_note",
      arguments: { id: "mcp-basics" }
    });
    expect(read.content).toContainEqual({
      type: "text",
      text: "# MCP Basics\n\nTools perform actions."
    });
  });

  it("returns expected failures as tool errors", async () => {
    const result = await client.callTool({
      name: "read_note",
      arguments: { id: "missing" }
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContainEqual({
      type: "text",
      text: 'Note "missing" does not exist.'
    });
  });

  it("requires explicit deletion confirmation", async () => {
    await store.create({ id: "keep-me", title: "Keep Me", body: "Important." });
    const result = await client.callTool({
      name: "delete_note",
      arguments: { id: "keep-me", confirm: false }
    });
    expect(result.isError).toBe(true);
    await expect(store.read("keep-me")).resolves.toMatchObject({ id: "keep-me" });
  });
});
```

- [ ] **Step 2: Run the server tests to verify RED**

Run: `npm test -- test/server.test.ts`

Expected: FAIL because `src/server.ts` does not exist.

- [ ] **Step 3: Implement MCP server instructions and tools**

Create `src/server.ts` with `McpServer`, Zod schemas, a shared
`toolResult()` success helper, and a `toolError()` wrapper. Register:

```typescript
const server = new McpServer(
  { name: "local-knowledge-desk", version: "1.0.0" },
  {
    instructions: [
      "Search existing notes before creating a potentially duplicate note.",
      "Cite note IDs when using local material.",
      "Confirm user intent before deleting a note.",
      "Treat notes as local user data."
    ].join(" ")
  }
);
```

Use `server.registerTool()` for each tool:

```typescript
server.registerTool(
  "create_note",
  {
    title: "Create note",
    description: "Create a new local Markdown note without overwriting an existing note.",
    inputSchema: {
      id: z.string(),
      title: z.string(),
      body: z.string()
    }
  },
  async ({ id, title, body }) => asToolResult(async () => {
    const note = await store.create({ id, title, body });
    return `Created note "${note.id}" (${note.title}).`;
  })
);
```

Register `list_notes`, `read_note`, `search_notes`, `workspace_summary`, and
`delete_note` with the exact names in the test. Format read output as
`# ${title}\n\n${body}`. For delete, reject unless `confirm === true` with:

```typescript
throw new Error("Deletion requires confirm=true.");
```

The shared wrapper must return:

```typescript
async function asToolResult(action: () => Promise<string>) {
  try {
    return { content: [{ type: "text" as const, text: await action() }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }]
    };
  }
}
```

Export `createKnowledgeDeskServer(store: NoteStore): McpServer`.

- [ ] **Step 4: Run tool tests and build to verify GREEN**

Run: `npm test -- test/server.test.ts`

Expected: all four protocol tests PASS.

Run: `npm run build`

Expected: TypeScript exits successfully.

- [ ] **Step 5: Commit**

```powershell
git add src/server.ts test/server.test.ts
git commit -m "feat: expose note tools over MCP"
```

### Task 4: Add MCP Resources and Prompts

**Files:**
- Modify: `src/server.ts`
- Modify: `test/server.test.ts`

- [ ] **Step 1: Add failing tests for resources and prompts**

Append tests that:

```typescript
it("lists and reads note resources", async () => {
  await store.create({ id: "resource-note", title: "Resource Note", body: "Readable context." });
  const listed = await client.listResources();
  expect(listed.resources).toContainEqual(expect.objectContaining({
    uri: "note://resource-note",
    name: "Resource Note",
    mimeType: "text/markdown"
  }));

  const read = await client.readResource({ uri: "note://resource-note" });
  expect(read.contents).toContainEqual({
    uri: "note://resource-note",
    mimeType: "text/markdown",
    text: "# Resource Note\n\nReadable context."
  });
});

it("advertises reusable workflow prompts", async () => {
  const listed = await client.listPrompts();
  expect(listed.prompts.map((prompt) => prompt.name).sort())
    .toEqual(["daily_review", "research_digest"]);

  const prompt = await client.getPrompt({
    name: "research_digest",
    arguments: { topic: "MCP" }
  });
  expect(prompt.messages[0]?.content).toEqual(expect.objectContaining({
    type: "text",
    text: expect.stringContaining("MCP")
  }));
});
```

- [ ] **Step 2: Run the new tests to verify RED**

Run: `npm test -- test/server.test.ts`

Expected: FAIL because resources and prompts are not registered.

- [ ] **Step 3: Register a dynamic resource template**

In `src/server.ts`, import `ResourceTemplate` and register:

```typescript
server.registerResource(
  "note",
  new ResourceTemplate("note://{id}", {
    list: async () => ({
      resources: (await store.list()).map((note) => ({
        uri: `note://${note.id}`,
        name: note.title,
        description: `Local note ${note.id}`,
        mimeType: "text/markdown"
      }))
    })
  }),
  {
    title: "Local note",
    description: "A Markdown note stored by the Local Knowledge Desk",
    mimeType: "text/markdown"
  },
  async (uri, { id }) => {
    const note = await store.read(String(id));
    return {
      contents: [{
        uri: uri.href,
        mimeType: "text/markdown",
        text: `# ${note.title}\n\n${note.body}`
      }]
    };
  }
);
```

- [ ] **Step 4: Register both workflow prompts**

Register `daily_review` with no required arguments and a user message that
instructs the model to call `list_notes`, inspect relevant notes, identify
priorities, and return a concise review with note IDs.

Register `research_digest` with:

```typescript
inputSchema: { topic: z.string().describe("Topic to research in local notes") }
```

Its user message must instruct the model to call `search_notes` using the topic,
read matches, synthesize findings, and cite every source note ID.

- [ ] **Step 5: Run protocol tests and build to verify GREEN**

Run: `npm test -- test/server.test.ts`

Expected: all protocol tests PASS.

Run: `npm run build`

Expected: TypeScript exits successfully.

- [ ] **Step 6: Commit**

```powershell
git add src/server.ts test/server.test.ts
git commit -m "feat: add MCP resources and prompts"
```

### Task 5: Add the Stdio Entrypoint and Codex Configuration

**Files:**
- Create: `src/index.ts`
- Create: `.codex/config.toml`
- Create: `test/entrypoint.test.ts`

- [ ] **Step 1: Write a failing entrypoint smoke test**

Create `test/entrypoint.test.ts`:

```typescript
import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

describe("stdio entrypoint", () => {
  it("starts without ordinary stdout logging", async () => {
    const child = spawn(process.execPath, ["dist/src/index.js"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(child.exitCode).toBeNull();
    expect(stdout).toBe("");
    child.kill();
    await once(child, "exit");
  });
});
```

- [ ] **Step 2: Build and run the test to verify RED**

Run: `npm run build`

Run: `npm test -- test/entrypoint.test.ts`

Expected: FAIL because `dist/src/index.js` does not exist.

- [ ] **Step 3: Implement the stdio executable**

Create `src/index.ts`:

```typescript
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio.js";
import { NoteStore } from "./note-store.js";
import { createKnowledgeDeskServer } from "./server.js";

async function main(): Promise<void> {
  const notesDirectory = resolve(process.env.KNOWLEDGE_DESK_NOTES_DIR ?? "data/notes");
  const server = createKnowledgeDeskServer(new NoteStore(notesDirectory));
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error("Local Knowledge Desk failed to start:", error);
  process.exitCode = 1;
});
```

- [ ] **Step 4: Add project-scoped Codex configuration**

Create `.codex/config.toml`:

```toml
[mcp_servers.local-knowledge-desk]
command = "node"
args = ["dist/src/index.js"]
cwd = "."
startup_timeout_sec = 10
tool_timeout_sec = 30
enabled = true
```

- [ ] **Step 5: Build and verify GREEN**

Run: `npm run build`

Run: `npm test -- test/entrypoint.test.ts`

Expected: PASS.

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/index.ts .codex/config.toml test/entrypoint.test.ts
git commit -m "feat: connect knowledge desk to Codex over stdio"
```

### Task 6: Write the Teaching Tutorial

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the tutorial**

Create a README containing:

- a concise MCP mental model: Codex is the host/client, this process is the
  server, tools perform actions, resources expose context, prompts package
  reusable workflows;
- a Mermaid flowchart from Codex to stdio server to Markdown notes;
- prerequisites: Node.js 20+ and npm;
- setup commands: `npm install`, `npm run build`, `npm test`;
- an explanation of `.codex/config.toml` and the need to open a new Codex
  session after building;
- sample requests:
  - “List the tools provided by the Local Knowledge Desk.”
  - “Create a note called `mcp-basics` titled `MCP Basics`...”
  - “Search my notes for resources.”
  - “Read `note://mcp-basics`.”
  - “Use the `daily_review` prompt.”
  - “Delete `mcp-basics` after asking me to confirm.”
- a file-by-file extension guide showing where to add a tool, resource, prompt,
  or alternate storage implementation;
- safety notes explaining local files, validation, overwrite prevention, and
  deletion confirmation;
- troubleshooting for missing tools, stale builds, stdout logging, and Windows
  absolute paths;
- an optional Claude Desktop JSON configuration using the same
  `node` plus absolute `dist/src/index.js` command.

- [ ] **Step 2: Verify commands and documentation references**

Run: `npm run build`

Run: `npm test`

Run: `rg -n "TODO|TBD|dist/index|src/index.ts|create_note|note://" README.md .codex/config.toml`

Expected: no placeholders; all paths and capability names match the project.

- [ ] **Step 3: Commit**

```powershell
git add README.md
git commit -m "docs: add Local Knowledge Desk MCP tutorial"
```

### Task 7: Final Verification

**Files:**
- Modify only if verification reveals a defect.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: every Vitest test passes with no warnings or unhandled errors.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: strict TypeScript compilation succeeds.

- [ ] **Step 3: Inspect repository state**

Run: `git status --short`

Expected: only the implementation-plan document is uncommitted if it has not
already been committed; no generated `dist/`, `node_modules/`, or Markdown note
files are tracked.

- [ ] **Step 4: Review the final diff against the design**

Run: `git log --oneline --decorate -8`

Run: `git diff HEAD^ --check`

Expected: focused commits, no whitespace errors, and full design coverage.

- [ ] **Step 5: Commit the implementation plan if still uncommitted**

```powershell
git add docs/superpowers/plans/2026-06-06-local-knowledge-desk.md
git commit -m "docs: add MCP demo implementation plan"
```
