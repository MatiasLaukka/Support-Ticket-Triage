import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NOTE_ID_PATTERN, NoteStore } from "../src/note-store.js";

describe("NOTE_ID_PATTERN", () => {
  it.each(["a", "first-note", "note-123", "a".repeat(64)])(
    "accepts valid note ID %s",
    (id) => {
      expect(NOTE_ID_PATTERN.test(id)).toBe(true);
    },
  );

  it.each([
    "",
    "../secret",
    "Uppercase",
    "-leading",
    "trailing-",
    "a".repeat(65),
  ])("rejects invalid note ID %s", (id) => {
    expect(NOTE_ID_PATTERN.test(id)).toBe(false);
  });
});

describe("NoteStore", () => {
  let tempDirectory: string;
  let rootDirectory: string;
  let store: NoteStore;

  beforeEach(async () => {
    tempDirectory = await mkdtemp(path.join(tmpdir(), "note-store-"));
    rootDirectory = path.join(tempDirectory, "notes", "..", "notes");
    store = new NoteStore(rootDirectory);
  });

  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it("creates and reads a trimmed Markdown note with exact file content", async () => {
    const created = await store.create({
      id: "first-note",
      title: "  First Note  ",
      body: "  Useful details.  ",
    });

    expect(created).toEqual({
      id: "first-note",
      title: "First Note",
      body: "Useful details.",
    });
    await expect(
      readFile(path.join(tempDirectory, "notes", "first-note.md"), "utf8"),
    ).resolves.toBe("# First Note\n\nUseful details.\n");
    await expect(store.read("first-note")).resolves.toEqual(created);
  });

  it("lists only Markdown notes as summaries sorted by ID", async () => {
    await store.create({ id: "zeta", title: "Zeta", body: "Last" });
    await store.create({ id: "alpha", title: "Alpha", body: "First" });
    await writeFile(path.join(tempDirectory, "notes", "ignored.txt"), "ignore");

    await expect(store.list()).resolves.toEqual([
      { id: "alpha", title: "Alpha" },
      { id: "zeta", title: "Zeta" },
    ]);
  });

  it("searches title and body case-insensitively in list order", async () => {
    await store.create({
      id: "zeta",
      title: "Other",
      body: "Contains NEEDLE here",
    });
    await store.create({
      id: "alpha",
      title: "Needle title",
      body: "Different body",
    });
    await store.create({
      id: "middle",
      title: "No match",
      body: "Nothing useful",
    });

    await expect(store.search(" needle ")).resolves.toEqual([
      { id: "alpha", title: "Needle title" },
      { id: "zeta", title: "Other" },
    ]);
  });

  it("summarizes the notes", async () => {
    await store.create({ id: "beta", title: "Beta", body: "Second" });
    await store.create({ id: "alpha", title: "Alpha", body: "First" });

    await expect(store.summary()).resolves.toEqual({
      count: 2,
      notes: [
        { id: "alpha", title: "Alpha" },
        { id: "beta", title: "Beta" },
      ],
    });
  });

  it("deletes an existing note", async () => {
    await store.create({ id: "temporary", title: "Temporary", body: "Remove" });

    await expect(store.delete("temporary")).resolves.toBeUndefined();
    await expect(store.read("temporary")).rejects.toThrow(
      'Note "temporary" does not exist.',
    );
  });

  it.each([
    "",
    "../secret",
    "Uppercase",
    "-leading",
    "trailing-",
    "a".repeat(65),
  ])("rejects invalid or traversing ID %s before filesystem access", async (id) => {
    await expect(
      store.create({ id, title: "Title", body: "Body" }),
    ).rejects.toThrow(/^Invalid note ID/);
    await expect(store.read(id)).rejects.toThrow(/^Invalid note ID/);
    await expect(store.delete(id)).rejects.toThrow(/^Invalid note ID/);
  });

  it("rejects duplicate IDs without overwriting the note", async () => {
    await store.create({ id: "same", title: "Original", body: "First body" });

    await expect(
      store.create({ id: "same", title: "Replacement", body: "Second body" }),
    ).rejects.toThrow('Note "same" already exists.');
    await expect(store.read("same")).resolves.toEqual({
      id: "same",
      title: "Original",
      body: "First body",
    });
  });

  it.each([
    [{ id: "blank-title", title: "  ", body: "Body" }, "Title is required."],
    [{ id: "blank-body", title: "Title", body: "\n\t" }, "Body is required."],
  ])("rejects blank note content", async (input, message) => {
    await expect(store.create(input)).rejects.toThrow(message);
  });

  it("rejects a blank search query", async () => {
    await expect(store.search(" \n ")).rejects.toThrow(
      "Search query is required.",
    );
  });

  it("reports the exact missing-note error for reads and deletes", async () => {
    await expect(store.read("missing")).rejects.toThrow(
      'Note "missing" does not exist.',
    );
    await expect(store.delete("missing")).rejects.toThrow(
      'Note "missing" does not exist.',
    );
  });

  it("reports malformed Markdown headings clearly", async () => {
    await store.create({ id: "broken", title: "Valid", body: "Valid body" });
    await writeFile(
      path.join(tempDirectory, "notes", "broken.md"),
      "Not a heading\n\nBody\n",
      "utf8",
    );

    await expect(store.read("broken")).rejects.toThrow(
      'Note "broken" has a malformed Markdown heading.',
    );
  });
});
