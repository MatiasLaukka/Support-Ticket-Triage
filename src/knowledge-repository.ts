import {
  lstat,
  open,
  readdir,
  type FileHandle,
} from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import {
  KnowledgeArticleSchema,
  type KnowledgeArticle,
} from "./domain.js";
import { DomainError } from "./errors.js";

const ARTICLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;
const defaultFileSystem = { open, readdir };
type KnowledgeFileSystem = typeof defaultFileSystem;

interface Closable {
  close(): Promise<void>;
}

function repositoryError(message: string): DomainError {
  return new DomainError(message, "REPOSITORY_ERROR");
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function assertNoLinkedPath(path: string): Promise<void> {
  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  let current = absolutePath;
  while (current !== root) {
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw repositoryError("Repository contains an unsupported linked path.");
      }
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      if (!isMissing(error)) {
        throw repositoryError("Repository path could not be inspected.");
      }
    }
    current = dirname(current);
  }
}

async function assertSafeFile(path: string): Promise<void> {
  await assertNoLinkedPath(path);
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink > 1) {
      throw repositoryError("Repository contains an unsupported linked path.");
    }
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }
    throw repositoryError("Repository path could not be inspected.");
  }
}

async function assertSafeOpenedFile(
  handle: Pick<FileHandle, "stat">,
): Promise<void> {
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.nlink !== 1) {
      throw repositoryError("Repository contains an unsupported linked path.");
    }
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }
    throw repositoryError("Repository path could not be inspected.");
  }
}

async function closeQuietly(handle: Closable | undefined): Promise<void> {
  try {
    await handle?.close();
  } catch {
    // Cleanup must not replace the repository operation's safe result.
  }
}

function parseArticle(content: string): KnowledgeArticle {
  const normalized = content.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    throw repositoryError("Repository data is invalid.");
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) {
    throw repositoryError("Repository data is invalid.");
  }

  const metadata = new Map<string, string>();
  for (const line of normalized.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) {
      throw repositoryError("Repository data is invalid.");
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!["id", "title", "tags"].includes(key) || metadata.has(key)) {
      throw repositoryError("Repository data is invalid.");
    }
    metadata.set(key, value);
  }
  if (
    metadata.size !== 3 ||
    metadata.get("id") === undefined ||
    metadata.get("title") === undefined ||
    metadata.get("tags") === undefined
  ) {
    throw repositoryError("Repository data is invalid.");
  }

  const result = KnowledgeArticleSchema.safeParse({
    id: metadata.get("id"),
    title: metadata.get("title"),
    tags: metadata
      .get("tags")!
      .split(",")
      .map((tag) => tag.trim()),
    body: normalized.slice(end + 5).trim(),
  });
  if (!result.success) {
    throw repositoryError("Repository data is invalid.");
  }
  return result.data;
}

export class KnowledgeRepository {
  private readonly root: string;
  private readonly fileSystem: KnowledgeFileSystem;

  constructor(
    root: string,
    fileSystem: Partial<KnowledgeFileSystem> = {},
  ) {
    this.root = resolve(root);
    this.fileSystem = { ...defaultFileSystem, ...fileSystem };
  }

  async list(): Promise<KnowledgeArticle[]> {
    await assertNoLinkedPath(this.root);
    let entries;
    try {
      entries = await this.fileSystem.readdir(this.root, { withFileTypes: true });
    } catch {
      throw repositoryError("Knowledge repository is unavailable.");
    }

    const parsedArticles: Array<{
      article: KnowledgeArticle;
      filenameStem: string;
    }> = [];
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = resolve(this.root, entry.name);
      await assertNoLinkedPath(path);
      if (!entry.name.endsWith(".md")) {
        continue;
      }
      await assertSafeFile(path);
      let handle;
      try {
        handle = await this.fileSystem.open(path, "r");
        await assertSafeOpenedFile(handle);
        parsedArticles.push({
          article: parseArticle(await handle.readFile("utf8")),
          filenameStem: entry.name.slice(0, -3),
        });
      } catch (error) {
        if (error instanceof DomainError) {
          throw error;
        }
        throw repositoryError("Repository data is invalid.");
      } finally {
        await closeQuietly(handle);
      }
    }

    const ids = new Set<string>();
    for (const { article } of parsedArticles) {
      if (ids.has(article.id)) {
        throw repositoryError("Repository data is invalid.");
      }
      ids.add(article.id);
    }
    for (const { article, filenameStem } of parsedArticles) {
      if (article.id !== filenameStem) {
        throw repositoryError("Repository data is invalid.");
      }
    }
    return parsedArticles.map(({ article }) => article);
  }

  async get(id: string): Promise<KnowledgeArticle> {
    if (!ARTICLE_ID_PATTERN.test(id)) {
      throw repositoryError("Repository path is not allowed.");
    }
    const article = (await this.list()).find((candidate) => candidate.id === id);
    if (article === undefined) {
      throw repositoryError("Knowledge article was not found.");
    }
    return article;
  }

  async search(query: string, limit = DEFAULT_SEARCH_LIMIT): Promise<KnowledgeArticle[]> {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery === "") {
      return [];
    }
    const boundedLimit = Number.isFinite(limit)
      ? Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.floor(limit)))
      : DEFAULT_SEARCH_LIMIT;
    return (await this.list())
      .filter((article) =>
        [
          article.id,
          article.title,
          article.tags.join(" "),
          article.body,
        ]
          .join("\n")
          .toLowerCase()
          .includes(normalizedQuery),
      )
      .slice(0, boundedLimit);
  }
}
