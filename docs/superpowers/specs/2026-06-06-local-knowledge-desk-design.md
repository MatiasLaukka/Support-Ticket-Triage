# Local Knowledge Desk MCP Demo Design

## Purpose

Build a small, fully local TypeScript MCP server that teaches how MCP connects
Codex to tools and context. The demo must be easy to run, inspect, modify, and
later connect to Claude Desktop without changing server behavior.

## Scope

The project stores Markdown notes in `data/notes/` and exposes them through MCP.
It requires Node.js and local npm dependencies, but no API key, database,
network service, or hosted infrastructure.

The tutorial targets Codex first. A project-scoped `.codex/config.toml` starts
the compiled server through stdio. Documentation will also show the equivalent
Claude Desktop configuration as a later optional step.

## Architecture

The project has four focused layers:

1. **Note storage** reads and writes Markdown files beneath `data/notes/`.
2. **Domain validation** validates note IDs, tool inputs, and destructive
   operation confirmation.
3. **MCP server** registers tools, resources, prompts, and server instructions.
4. **Tutorial and configuration** explain how Codex launches and uses the
   server.

The server uses the official TypeScript MCP SDK and communicates over stdio.
All diagnostic logging goes to stderr so stdout remains reserved for MCP
messages.

## Capabilities

### Tools

- `create_note`: Create a Markdown note with a validated ID, title, and body.
  It fails rather than overwriting an existing note.
- `list_notes`: Return note IDs and titles.
- `read_note`: Return one note by ID.
- `search_notes`: Search note titles and bodies with a case-insensitive text
  query.
- `delete_note`: Delete one note only when the caller supplies an explicit
  confirmation flag.
- `workspace_summary`: Return counts and a compact overview of locally stored
  notes.

Tool results use MCP text content with concise, human-readable output.
Expected validation and storage failures are returned as tool errors rather
than crashing the server.

### Resources

Each note is available through a `note://<id>` resource URI. Listing resources
discovers existing notes, and reading a resource returns its Markdown content
with the `text/markdown` MIME type.

### Prompts

- `daily_review`: Guide Codex to inspect current notes, identify priorities,
  and produce a short daily review.
- `research_digest`: Guide Codex to search related notes and synthesize a
  digest with source note IDs.

Prompts provide workflow instructions; they do not call tools themselves.

### Server Instructions

Initialization instructions tell Codex to:

- search existing notes before creating a potentially duplicate note;
- use note IDs when citing local material;
- obtain user intent before calling the destructive deletion tool;
- treat the note directory as local user data.

## Data Format

Each note is one UTF-8 Markdown file named `<id>.md`. The file begins with a
level-one heading containing the title, followed by a blank line and the body.

Note IDs contain lowercase ASCII letters, digits, and hyphens, start and end
with an alphanumeric character, and are limited to 64 characters. Storage code
resolves every path and verifies it remains inside `data/notes/`.

## Data Flow

1. Codex starts the configured stdio command.
2. The server initializes and advertises instructions and capabilities.
3. Codex discovers tools, resources, or prompts.
4. A handler validates the request and delegates note access to storage.
5. Storage reads or changes local Markdown files.
6. The server returns MCP content or a structured tool error.

No note data leaves the local machine through this server.

## Error Handling

- Invalid IDs and empty required fields produce clear validation errors.
- Missing notes and duplicate IDs produce distinct errors.
- Path traversal attempts are rejected before filesystem access.
- Deletion without explicit confirmation is rejected.
- Unexpected startup failures are written to stderr and exit nonzero.
- Individual request failures are contained and do not terminate the server.

## Testing

Automated tests cover:

- ID and path validation;
- note creation, listing, reading, searching, summary, and deletion;
- duplicate, missing-note, and confirmation failures;
- MCP discovery and representative calls through an in-memory client/server
  transport or SDK-supported local test transport.

A final smoke test builds the TypeScript project and launches the compiled
stdio server long enough to verify it starts without writing non-protocol
output to stdout.

## Tutorial

The README will explain:

1. the roles of an MCP host, client, server, tools, resources, and prompts;
2. installation and build commands;
3. the project-scoped Codex configuration;
4. restarting or opening a new Codex session so configuration is loaded;
5. sample requests for discovery, note creation, search, resource reading,
   prompt use, and deletion;
6. where to modify each capability;
7. an optional Claude Desktop configuration example.

## Success Criteria

- A fresh local checkout can install, build, and test successfully.
- Codex can launch the server from `.codex/config.toml`.
- Codex can discover and invoke the note tools.
- Notes persist as inspectable Markdown files.
- Resource and prompt capabilities are implemented and testable through MCP.
- The README enables a newcomer to understand and extend the demo.
