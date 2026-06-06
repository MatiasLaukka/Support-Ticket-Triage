import {
  lstat,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const NOTE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const WINDOWS_RESERVED_ID_PATTERN =
  /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])$/i;

export interface NoteInput {
  id: string;
  title: string;
  body: string;
}

export interface Note {
  id: string;
  title: string;
  body: string;
}

export interface NoteSummary {
  id: string;
  title: string;
}

export class NoteStore {
  private readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = path.resolve(rootDirectory);
  }

  async create(input: NoteInput): Promise<Note> {
    const notePath = this.resolveNotePath(input.id);
    const title = input.title.trim();
    const body = input.body.trim();

    if (/[\r\n]/.test(input.title)) {
      throw new Error("Title must be a single line.");
    }
    if (!title) {
      throw new Error("Title is required.");
    }
    if (!body) {
      throw new Error("Body is required.");
    }

    await mkdir(this.rootDirectory, { recursive: true });

    try {
      await writeFile(notePath, `# ${title}\n\n${body}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (error) {
      if (this.hasCode(error, "EEXIST")) {
        throw new Error(`Note "${input.id}" already exists.`);
      }
      throw error;
    }

    return { id: input.id, title, body };
  }

  async read(id: string): Promise<Note> {
    try {
      return await this.readNote(id);
    } catch (error) {
      if (this.hasCode(error, "ENOENT")) {
        throw new Error(`Note "${id}" does not exist.`);
      }
      throw error;
    }
  }

  async list(): Promise<NoteSummary[]> {
    const notes = await this.readSortedNotes();
    return notes.map(({ id, title }) => ({ id, title }));
  }

  async search(query: string): Promise<NoteSummary[]> {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      throw new Error("Search query is required.");
    }

    const notes = await this.readSortedNotes();
    const matches: NoteSummary[] = [];

    for (const note of notes) {
      if (
        note.title.toLowerCase().includes(normalizedQuery) ||
        note.body.toLowerCase().includes(normalizedQuery)
      ) {
        matches.push({ id: note.id, title: note.title });
      }
    }

    return matches;
  }

  async summary(): Promise<{ count: number; notes: NoteSummary[] }> {
    const notes = await this.readSortedNotes();
    return {
      count: notes.length,
      notes: notes.map(({ id, title }) => ({ id, title })),
    };
  }

  async delete(id: string): Promise<void> {
    const notePath = this.resolveNotePath(id);

    try {
      await this.assertRegularFile(notePath, id);
      await unlink(notePath);
    } catch (error) {
      if (this.hasCode(error, "ENOENT")) {
        throw new Error(`Note "${id}" does not exist.`);
      }
      throw error;
    }
  }

  private async readSortedNotes(): Promise<Note[]> {
    let entries;

    try {
      entries = await readdir(this.rootDirectory, { withFileTypes: true });
    } catch (error) {
      if (this.hasCode(error, "ENOENT")) {
        return [];
      }
      throw error;
    }

    const ids = entries
      .filter(
        (entry) =>
          entry.name.endsWith(".md") &&
          NOTE_ID_PATTERN.test(entry.name.slice(0, -3)) &&
          !WINDOWS_RESERVED_ID_PATTERN.test(entry.name.slice(0, -3)),
      )
      .map((entry) => entry.name.slice(0, -3))
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

    const notes = await Promise.all(
      ids.map(async (id) => {
        try {
          return await this.readNote(id);
        } catch (error) {
          if (this.hasCode(error, "ENOENT")) {
            return undefined;
          }
          throw error;
        }
      }),
    );

    return notes.filter((note): note is Note => note !== undefined);
  }

  private async readNote(id: string): Promise<Note> {
    const notePath = this.resolveNotePath(id);
    await this.assertRegularFile(notePath, id);
    const markdown = await readFile(notePath, "utf8");
    const match = /^# ([^\r\n]+)\r?\n\r?\n([\s\S]*?)\r?\n?$/.exec(markdown);

    if (!match) {
      throw new Error(`Note "${id}" has a malformed Markdown heading.`);
    }

    return {
      id,
      title: match[1],
      body: match[2],
    };
  }

  private async assertRegularFile(notePath: string, id: string): Promise<void> {
    const stats = await lstat(notePath);
    if (!stats.isFile()) {
      throw new Error(`Note "${id}" must be a regular file.`);
    }
  }

  private resolveNotePath(id: string): string {
    if (
      !NOTE_ID_PATTERN.test(id) ||
      WINDOWS_RESERVED_ID_PATTERN.test(id)
    ) {
      throw new Error(`Invalid note ID: "${id}".`);
    }

    const notePath = path.resolve(this.rootDirectory, `${id}.md`);
    const relativePath = path.relative(this.rootDirectory, notePath);
    if (
      relativePath.startsWith(`..${path.sep}`) ||
      relativePath === ".." ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(`Invalid note ID: "${id}".`);
    }

    return notePath;
  }

  private hasCode(error: unknown, code: string): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === code
    );
  }
}
