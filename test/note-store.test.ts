import * as fsPromises from "node:fs/promises";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NOTE_ID_PATTERN, NoteStore } from "../src/note-store.js";

vi.mock("node:fs/promises", { spy: true });

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

  it("sorts note IDs without locale-sensitive comparison", async () => {
    await store.create({ id: "zeta", title: "Zeta", body: "Last" });
    await store.create({ id: "alpha", title: "Alpha", body: "First" });
    const localeCompare = vi
      .spyOn(String.prototype, "localeCompare")
      .mockImplementation(() => {
        throw new Error("localeCompare must not be used");
      });

    try {
      await expect(store.list()).resolves.toEqual([
        { id: "alpha", title: "Alpha" },
        { id: "zeta", title: "Zeta" },
      ]);
    } finally {
      localeCompare.mockRestore();
    }
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

  it("reads each note only once while searching", async () => {
    await store.create({ id: "alpha", title: "Alpha", body: "Needle" });
    await store.create({ id: "beta", title: "Beta", body: "Needle" });
    vi.mocked(fsPromises.readFile).mockClear();

    await store.search("needle");

    expect(fsPromises.readFile).toHaveBeenCalledTimes(2);
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

  it("allows only one concurrent create for the same ID", async () => {
    const results = await Promise.allSettled([
      store.create({ id: "racing", title: "First", body: "First body" }),
      store.create({ id: "racing", title: "Second", body: "Second body" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        message: 'Note "racing" already exists.',
      }),
    });
  });

  it.each([
    [{ id: "blank-title", title: "  ", body: "Body" }, "Title is required."],
    [{ id: "blank-body", title: "Title", body: "\n\t" }, "Body is required."],
  ])("rejects blank note content", async (input, message) => {
    await expect(store.create(input)).rejects.toThrow(message);
  });

  it.each(["First\nSecond", "First\rSecond", "First\r\nSecond"])(
    "rejects multiline title %j",
    async (title) => {
      await expect(
        store.create({ id: "multiline", title, body: "Body" }),
      ).rejects.toThrow("Title must be a single line.");
    },
  );

  it.each([
    "con",
    "prn",
    "aux",
    "nul",
    "clock$",
    ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
  ])("rejects reserved Windows device ID %s", async (id) => {
    await expect(
      store.create({ id, title: "Title", body: "Body" }),
    ).rejects.toThrow(/^Invalid note ID/);
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

  it("surfaces malformed Markdown while listing", async () => {
    await store.create({ id: "broken", title: "Valid", body: "Valid body" });
    await writeFile(
      path.join(tempDirectory, "notes", "broken.md"),
      "Not a heading\n\nBody\n",
      "utf8",
    );

    await expect(store.list()).rejects.toThrow(
      'Note "broken" has a malformed Markdown heading.',
    );
  });

  it("skips a note that disappears after directory enumeration", async () => {
    await store.create({ id: "stable", title: "Stable", body: "Body" });
    await store.create({ id: "vanishing", title: "Vanishing", body: "Body" });
    const actualFsPromises =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const vanishingPath = path.join(rootDirectory, "vanishing.md");
    let removed = false;
    vi.mocked(fsPromises.lstat).mockImplementation(async (notePath) => {
      if (!removed && path.resolve(notePath.toString()) === vanishingPath) {
        removed = true;
        await unlink(vanishingPath);
      }
      return actualFsPromises.lstat(notePath);
    });

    await expect(store.list()).resolves.toEqual([
      { id: "stable", title: "Stable" },
    ]);
  });

  it("rejects note file symlinks without following them", async (context) => {
    const targetPath = path.join(tempDirectory, "target.md");
    const linkPath = path.join(rootDirectory, "linked.md");
    await mkdir(rootDirectory, { recursive: true });
    await writeFile(targetPath, "# Target\n\nSecret\n", "utf8");

    try {
      await symlink(targetPath, linkPath, "file");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EPERM"
      ) {
        context.skip();
        return;
      }
      throw error;
    }

    await expect(store.read("linked")).rejects.toThrow(
      'Note "linked" must be a regular file.',
    );
    await expect(store.list()).rejects.toThrow(
      'Note "linked" must be a regular file.',
    );
    await expect(store.search("secret")).rejects.toThrow(
      'Note "linked" must be a regular file.',
    );
    await expect(store.delete("linked")).rejects.toThrow(
      'Note "linked" must be a regular file.',
    );
    await expect(readFile(targetPath, "utf8")).resolves.toBe(
      "# Target\n\nSecret\n",
    );
  });

  it("parses CRLF Markdown notes", async () => {
    await store.create({ id: "windows", title: "Valid", body: "Valid body" });
    await writeFile(
      path.join(tempDirectory, "notes", "windows.md"),
      "# Windows Note\r\n\r\nFirst line\r\nSecond line\r\n",
      "utf8",
    );

    await expect(store.read("windows")).resolves.toEqual({
      id: "windows",
      title: "Windows Note",
      body: "First line\r\nSecond line",
    });
  });
});
