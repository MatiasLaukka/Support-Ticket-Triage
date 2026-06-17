import {
  lstat,
  mkdir,
  open,
  type FileHandle,
} from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import {
  AuditEventSchema,
  TicketIdSchema,
  type AuditEvent,
  type TicketId,
} from "./domain.js";
import { DomainError } from "./errors.js";

const defaultFileSystem = { open };
type AuditFileSystem = typeof defaultFileSystem;
const auditOperations = new Map<string, Promise<void>>();
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 50;

export interface AuditPageInput {
  ticketId?: TicketId;
  offset: number;
  limit: number;
}

export interface AuditPage {
  events: AuditEvent[];
  total: number;
  offset: number;
  limit: number;
}

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

async function serializeByPath<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = operationKey(path);
  const previous = auditOperations.get(key) ?? Promise.resolve();
  let release = (): void => undefined;
  const current = new Promise<void>((resolveOperation) => {
    release = resolveOperation;
  });
  auditOperations.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (auditOperations.get(key) === current) {
      auditOperations.delete(key);
    }
  }
}

function operationKey(path: string): string {
  const resolvedPath = resolve(path);
  return process.platform === "win32"
    ? resolvedPath.toLowerCase()
    : resolvedPath;
}

function parseTicketId(ticketId: TicketId | undefined): TicketId | undefined {
  if (ticketId === undefined) {
    return undefined;
  }
  const result = TicketIdSchema.safeParse(ticketId);
  if (!result.success) {
    throw repositoryError("Repository path is not allowed.");
  }
  return result.data;
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function parseAuditLine(line: string): AuditEvent {
  if (line.trim() === "") {
    throw repositoryError("Audit log contains malformed data.");
  }
  try {
    const result = AuditEventSchema.safeParse(JSON.parse(line));
    if (!result.success) {
      throw repositoryError("Audit log contains malformed data.");
    }
    return result.data;
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }
    throw repositoryError("Audit log contains malformed data.");
  }
}

export class AuditRepository {
  private readonly file: string;
  private readonly fileSystem: AuditFileSystem;

  constructor(file: string, fileSystem: Partial<AuditFileSystem> = {}) {
    this.file = resolve(file);
    this.fileSystem = { ...defaultFileSystem, ...fileSystem };
  }

  async append(event: AuditEvent): Promise<void> {
    const parsed = AuditEventSchema.safeParse(event);
    if (!parsed.success) {
      throw repositoryError("Repository data is invalid.");
    }

    return serializeByPath(this.file, async () => {
      const root = dirname(this.file);
      await initializeDirectory(root);
      try {
        await assertSafeFile(this.file);
      } catch (error) {
        if (!isMissing(error)) {
          throw error;
        }
      }

      let handle;
      let originalSize = 0;
      let appendStarted = false;
      try {
        handle = await this.fileSystem.open(this.file, "a+");
        await assertSafeOpenedFile(handle);
        originalSize = (await handle.stat()).size;
        appendStarted = true;
        await handle.writeFile(`${JSON.stringify(parsed.data)}\n`, "utf8");
        await handle.sync();
      } catch (error) {
        if (appendStarted) {
          await closeQuietly(handle);
          handle = undefined;
          let rollbackHandle;
          try {
            rollbackHandle = await this.fileSystem.open(this.file, "r+");
            await assertSafeOpenedFile(rollbackHandle);
            await rollbackHandle.truncate(originalSize);
            await rollbackHandle.sync();
          } catch {
            // Preserve the safe append error even if rollback cannot complete.
          } finally {
            await closeQuietly(rollbackHandle);
          }
        }
        if (error instanceof DomainError) {
          throw error;
        }
        throw repositoryError("Audit event could not be persisted.");
      } finally {
        await closeQuietly(handle);
      }
    });
  }

  async list(ticketId?: TicketId): Promise<AuditEvent[]> {
    return serializeByPath(this.file, async () => {
      const parsedTicketId = parseTicketId(ticketId);

      try {
        await assertSafeFile(this.file);
      } catch (error) {
        if (isMissing(error)) {
          return [];
        }
        throw error;
      }

      let content: string;
      let handle;
      try {
        handle = await this.fileSystem.open(this.file, "r");
        await assertSafeOpenedFile(handle);
        content = await handle.readFile("utf8");
      } catch (error) {
        if (error instanceof DomainError) {
          throw error;
        }
        throw repositoryError("Audit log could not be read.");
      } finally {
        await closeQuietly(handle);
      }
      if (content === "") {
        return [];
      }

      const lines = content.endsWith("\n")
        ? content.slice(0, -1).split("\n")
        : content.split("\n");
      const events: AuditEvent[] = [];
      for (const line of lines) {
        events.push(parseAuditLine(line));
      }
      return parsedTicketId === undefined
        ? events
        : events.filter((event) => event.ticketId === parsedTicketId);
    });
  }

  async listPage(input: AuditPageInput): Promise<AuditPage> {
    const parsedTicketId = parseTicketId(input.ticketId);
    const offset = boundedInteger(input.offset, 0, Number.MAX_SAFE_INTEGER, 0);
    const limit = boundedInteger(
      input.limit,
      1,
      MAX_PAGE_LIMIT,
      DEFAULT_PAGE_LIMIT,
    );

    return serializeByPath(this.file, async () => {
      try {
        await assertSafeFile(this.file);
      } catch (error) {
        if (isMissing(error)) {
          return { events: [], total: 0, offset, limit };
        }
        throw error;
      }

      const events: AuditEvent[] = [];
      let total = 0;
      let handle;
      try {
        handle = await this.fileSystem.open(this.file, "r");
        await assertSafeOpenedFile(handle);
        for await (const line of handle.readLines()) {
          const event = parseAuditLine(line);
          if (
            parsedTicketId !== undefined &&
            event.ticketId !== parsedTicketId
          ) {
            continue;
          }
          if (total >= offset && events.length < limit) {
            events.push(event);
          }
          total += 1;
        }
      } catch (error) {
        if (error instanceof DomainError) {
          throw error;
        }
        throw repositoryError("Audit log could not be read.");
      } finally {
        await closeQuietly(handle);
      }

      return { events, total, offset, limit };
    });
  }
}
