import { randomUUID } from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { z } from "zod";
import {
  TriageRecommendationSchema,
  type TriageRecommendation,
} from "./domain.js";
import { DomainError } from "./errors.js";

const RecommendationIdSchema = z.uuid();
const defaultFileSystem = { link, open, readdir, rename, rm };
type RecommendationFileSystem = typeof defaultFileSystem;
const recommendationOperations = new Map<string, Promise<void>>();

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
    if (error instanceof DomainError || isMissing(error)) {
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

async function initializeDirectory(path: string): Promise<void> {
  try {
    await assertNoLinkedPath(path);
    await mkdir(path, { recursive: true });
    await assertNoLinkedPath(path);
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }
    throw repositoryError("Repository could not be initialized.");
  }
}

async function closeQuietly(handle: Closable | undefined): Promise<void> {
  try {
    await handle?.close();
  } catch {
    // Cleanup must not replace the repository operation's safe result.
  }
}

async function removeQuietly(
  remove: typeof rm,
  path: string,
): Promise<void> {
  try {
    await remove(path, { force: true });
  } catch {
    // Best-effort cleanup must not leak local filesystem details.
  }
}

async function serializeByPath<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = operationKey(path);
  const previous = recommendationOperations.get(key) ?? Promise.resolve();
  let release = (): void => undefined;
  const current = new Promise<void>((resolveOperation) => {
    release = resolveOperation;
  });
  recommendationOperations.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (recommendationOperations.get(key) === current) {
      recommendationOperations.delete(key);
    }
  }
}

async function waitForPath(path: string): Promise<void> {
  await recommendationOperations.get(operationKey(path));
}

function operationKey(path: string): string {
  const resolvedPath = resolve(path);
  return process.platform === "win32"
    ? resolvedPath.toLowerCase()
    : resolvedPath;
}

export class RecommendationRepository {
  private readonly root: string;
  private readonly fileSystem: RecommendationFileSystem;

  constructor(
    root: string,
    fileSystem: Partial<RecommendationFileSystem> = {},
  ) {
    this.root = resolve(root);
    this.fileSystem = { ...defaultFileSystem, ...fileSystem };
  }

  async create(value: TriageRecommendation): Promise<void> {
    const parsed = TriageRecommendationSchema.safeParse(value);
    if (!parsed.success) {
      throw repositoryError("Repository data is invalid.");
    }
    const path = this.pathFor(parsed.data.id);
    return serializeByPath(this.root, () =>
      serializeByPath(path, async () => {
        await initializeDirectory(this.root);
        const temporaryFile = resolve(
          this.root,
          `.${parsed.data.id}.${randomUUID()}.tmp`,
        );
        let handle;
        let published = false;
        try {
          handle = await this.fileSystem.open(temporaryFile, "wx");
          await assertSafeOpenedFile(handle);
          await handle.writeFile(
            `${JSON.stringify(parsed.data, null, 2)}\n`,
            "utf8",
          );
          await handle.sync();
          await closeQuietly(handle);
          handle = undefined;
          await this.fileSystem.link(temporaryFile, path);
          published = true;
          await this.fileSystem.rm(temporaryFile, { force: true });
          published = false;
        } catch (error) {
          if (published) {
            await removeQuietly(this.fileSystem.rm, path);
          }
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "EEXIST"
          ) {
            throw repositoryError("Recommendation already exists.");
          }
          if (error instanceof DomainError) {
            throw error;
          }
          throw repositoryError("Recommendation could not be persisted.");
        } finally {
          await closeQuietly(handle);
          await removeQuietly(this.fileSystem.rm, temporaryFile);
        }
      }),
    );
  }

  async get(id: string): Promise<TriageRecommendation> {
    const path = this.pathFor(id);
    return serializeByPath(this.root, async () => {
      await waitForPath(path);
      return this.getUnlocked(path);
    });
  }

  async list(): Promise<TriageRecommendation[]> {
    return serializeByPath(this.root, async () => {
      await assertNoLinkedPath(this.root);
      let entries;
      try {
        entries = await this.fileSystem.readdir(this.root, {
          withFileTypes: true,
        });
      } catch (error) {
        if (isMissing(error)) {
          return [];
        }
        throw repositoryError("Recommendation repository is unavailable.");
      }

      const recommendations: TriageRecommendation[] = [];
      for (const entry of entries) {
        const match = /^([0-9a-f-]{36})\.json$/i.exec(entry.name);
        if (
          match === null ||
          !RecommendationIdSchema.safeParse(match[1]).success
        ) {
          continue;
        }
        const path = resolve(this.root, entry.name);
        const value = await this.getUnlocked(path);
        if (`${value.id}.json`.toLowerCase() !== entry.name.toLowerCase()) {
          throw repositoryError("Repository data is invalid.");
        }
        recommendations.push(value);
      }

      return recommendations.sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
    });
  }

  private async getUnlocked(path: string): Promise<TriageRecommendation> {
    let handle;
    try {
      await assertSafeFile(path);
      handle = await this.fileSystem.open(path, "r");
      await assertSafeOpenedFile(handle);
      const result = TriageRecommendationSchema.safeParse(
        JSON.parse(await handle.readFile("utf8")),
      );
      if (!result.success) {
        throw repositoryError("Repository data is invalid.");
      }
      return result.data;
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      if (isMissing(error)) {
        throw new DomainError(
          "Recommendation was not found.",
          "RECOMMENDATION_NOT_FOUND",
        );
      }
      throw repositoryError("Repository data is invalid.");
    } finally {
      await closeQuietly(handle);
    }
  }

  async markResolved(
    id: string,
    resolution: "approved" | "rejected",
  ): Promise<void> {
    try {
      await this.transitionResolution(id, "pending", resolution);
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.code === "REPOSITORY_ERROR" &&
        error.message ===
          "Recommendation resolution does not match expected state."
      ) {
        throw repositoryError("Recommendation is already resolved.");
      }
      throw error;
    }
  }

  async transitionResolution(
    id: string,
    expected: TriageRecommendation["resolution"],
    next: TriageRecommendation["resolution"],
  ): Promise<void> {
    const path = this.pathFor(id);
    return serializeByPath(this.root, () => serializeByPath(path, async () => {
      const recommendation = await this.getUnlocked(path);
      if (recommendation.resolution !== expected) {
        throw repositoryError(
          "Recommendation resolution does not match expected state.",
        );
      }
      const updated = TriageRecommendationSchema.parse({
        ...recommendation,
        resolution: next,
      });
      const temporaryFile = resolve(
        this.root,
        `.${updated.id}.${randomUUID()}.tmp`,
      );
      let handle;
      try {
        handle = await this.fileSystem.open(temporaryFile, "wx");
        await assertSafeOpenedFile(handle);
        await handle.writeFile(`${JSON.stringify(updated, null, 2)}\n`, "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;
        await assertSafeFile(path);
        await this.fileSystem.rename(temporaryFile, path);
      } catch (error) {
        if (error instanceof DomainError) {
          throw error;
        }
        throw repositoryError("Recommendation could not be persisted.");
      } finally {
        await closeQuietly(handle);
        await removeQuietly(this.fileSystem.rm, temporaryFile);
      }
    }));
  }

  async deletePending(id: string): Promise<void> {
    const path = this.pathFor(id);
    return serializeByPath(this.root, () => serializeByPath(path, async () => {
      const recommendation = await this.getUnlocked(path);
      if (recommendation.resolution !== "pending") {
        throw repositoryError("Only pending recommendations can be deleted.");
      }
      try {
        await assertSafeFile(path);
        await this.fileSystem.rm(path);
      } catch (error) {
        if (error instanceof DomainError) {
          throw error;
        }
        throw repositoryError("Recommendation could not be deleted.");
      }
    }));
  }

  private pathFor(id: string): string {
    const parsed = RecommendationIdSchema.safeParse(id);
    if (!parsed.success) {
      throw repositoryError("Repository path is not allowed.");
    }
    return resolve(this.root, `${parsed.data}.json`);
  }
}
