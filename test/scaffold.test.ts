import { describe, expect, it } from "vitest";

import { NOTE_ID_PATTERN } from "../src/note-store.js";

describe("NOTE_ID_PATTERN", () => {
  it("accepts a simple kebab-case note ID", () => {
    expect(NOTE_ID_PATTERN.test("first-note")).toBe(true);
  });
});
