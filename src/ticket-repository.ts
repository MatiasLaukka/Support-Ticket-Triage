import { AsyncLocalStorage } from "node:async_hooks";
import {
  lstat,
  link,
  mkdir,
  open,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, parse, resolve } from "node:path";
import {
  CategorySchema,
  IsoTimestampSchema,
  PrioritySchema,
  TeamSchema,
  TicketIdSchema,
  TicketSchema,
  TicketStatusSchema,
  type Category,
  type Priority,
  type Team,
  type Ticket,
  type TicketId,
  type TicketStatus,
} from "./domain.js";
import { DomainError } from "./errors.js";

export type TicketSlaState = "breached" | "at-risk" | "healthy";

export interface TicketFilter {
  status?: TicketStatus;
  category?: Category;
  priority?: Priority;
  team?: Team;
  slaState?: TicketSlaState;
  asOf?: string;
  offset?: number;
  limit?: number;
}

export interface PaginatedTickets {
  items: Ticket[];
  total: number;
  offset: number;
  limit: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const AT_RISK_WINDOW_MS = 60 * 60 * 1000;
const defaultFileSystem = { link, open, rename, rm };
type TicketFileSystem = typeof defaultFileSystem;
const ticketOperations = new Map<string, Promise<void>>();
const activeTicketOperations = new AsyncLocalStorage<ReadonlySet<string>>();

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
  const active = activeTicketOperations.getStore();
  if (active?.has(key)) {
    throw repositoryError(
      "Ticket transaction callback cannot reenter the same repository.",
    );
  }
  const previous = ticketOperations.get(key) ?? Promise.resolve();
  let release = (): void => undefined;
  const current = new Promise<void>((resolveOperation) => {
    release = resolveOperation;
  });
  ticketOperations.set(key, current);
  await previous;
  try {
    return await activeTicketOperations.run(
      new Set([...(active ?? []), key]),
      operation,
    );
  } finally {
    release();
    if (ticketOperations.get(key) === current) {
      ticketOperations.delete(key);
    }
  }
}

function operationKey(path: string): string {
  const resolvedPath = resolve(path);
  return process.platform === "win32"
    ? resolvedPath.toLowerCase()
    : resolvedPath;
}

function parseTickets(value: unknown): Ticket[] {
  const result = TicketSchema.array().safeParse(value);
  if (!result.success) {
    throw repositoryError("Repository data is invalid.");
  }
  return result.data;
}

function parseFilter(filter: TicketFilter): {
  status?: TicketStatus;
  category?: Category;
  priority?: Priority;
  team?: Team;
  slaState?: TicketSlaState;
  asOf: Date;
  offset: number;
  limit: number;
} {
  const status = parseOptional(filter.status, TicketStatusSchema);
  const category = parseOptional(filter.category, CategorySchema);
  const priority = parseOptional(filter.priority, PrioritySchema);
  const team = parseOptional(filter.team, TeamSchema);
  if (
    filter.slaState !== undefined &&
    !["breached", "at-risk", "healthy"].includes(filter.slaState)
  ) {
    throw repositoryError("Ticket filter is invalid.");
  }

  const asOfValue = filter.asOf ?? new Date().toISOString();
  if (!IsoTimestampSchema.safeParse(asOfValue).success) {
    throw repositoryError("Ticket filter is invalid.");
  }

  return {
    status,
    category,
    priority,
    team,
    slaState: filter.slaState,
    asOf: new Date(asOfValue),
    offset: boundedInteger(filter.offset, 0, Number.MAX_SAFE_INTEGER, 0),
    limit: boundedInteger(filter.limit, 1, MAX_LIMIT, DEFAULT_LIMIT),
  };
}

function parseOptional<T>(
  value: unknown,
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw repositoryError("Ticket filter is invalid.");
  }
  return result.data;
}

function boundedInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value)) {
    throw repositoryError("Ticket filter is invalid.");
  }
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function slaState(ticket: Ticket, asOf: Date): TicketSlaState {
  const dueAt = new Date(ticket.sla.responseDueAt).getTime();
  const now = asOf.getTime();
  if (ticket.sla.breached || dueAt <= now) {
    return "breached";
  }
  if (dueAt - now <= AT_RISK_WINDOW_MS) {
    return "at-risk";
  }
  return "healthy";
}

export class TicketRepository {
  private readonly runtimeRoot: string;
  private readonly seedFile: string;
  private readonly runtimeFile: string;
  private readonly fileSystem: TicketFileSystem;

  constructor(
    runtimeRoot: string,
    seedFile: string,
    fileSystem: Partial<TicketFileSystem> = {},
  ) {
    this.runtimeRoot = resolve(runtimeRoot);
    this.seedFile = resolve(seedFile);
    this.runtimeFile = resolve(this.runtimeRoot, "tickets.json");
    this.fileSystem = { ...defaultFileSystem, ...fileSystem };
  }

  async initialize(): Promise<void> {
    return serializeByPath(this.runtimeFile, async () => {
      await initializeDirectory(this.runtimeRoot);

      try {
        await this.readTicketsFrom(this.runtimeFile);
        return;
      } catch (error) {
        if (!(isMissing(error))) {
          throw error;
        }
      }

      const tickets = await this.readSeedTickets();
      const temporaryFile = resolve(
        this.runtimeRoot,
        `.tickets.json.${randomUUID()}.tmp`,
      );
      let handle;
      let published = false;
      try {
        handle = await this.fileSystem.open(temporaryFile, "wx");
        await assertSafeOpenedFile(handle);
        await handle.writeFile(`${JSON.stringify(tickets, null, 2)}\n`, "utf8");
        await handle.sync();
        await closeQuietly(handle);
        handle = undefined;
        await this.fileSystem.link(temporaryFile, this.runtimeFile);
        published = true;
        await this.fileSystem.rm(temporaryFile, { force: true });
        published = false;
      } catch (error) {
        if (published) {
          await removeQuietly(this.fileSystem.rm, this.runtimeFile);
        }
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "EEXIST"
        ) {
          try {
            await this.readTicketsUnlocked();
          } catch (readError) {
            if (readError instanceof DomainError) {
              throw readError;
            }
            throw repositoryError("Repository could not be initialized.");
          }
          return;
        }
        if (error instanceof DomainError) {
          throw error;
        }
        throw repositoryError("Repository could not be initialized.");
      } finally {
        await closeQuietly(handle);
        await removeQuietly(this.fileSystem.rm, temporaryFile);
      }
    });
  }

  async list(filter: TicketFilter): Promise<PaginatedTickets> {
    const parsedFilter = parseFilter(filter);
    return serializeByPath(this.runtimeFile, async () => {
      const tickets = (await this.readTicketsUnlocked()).filter(
        (candidate) =>
          (parsedFilter.status === undefined ||
            candidate.status === parsedFilter.status) &&
          (parsedFilter.category === undefined ||
            candidate.category === parsedFilter.category) &&
          (parsedFilter.priority === undefined ||
            candidate.priority === parsedFilter.priority) &&
          (parsedFilter.team === undefined ||
            candidate.team === parsedFilter.team) &&
          (parsedFilter.slaState === undefined ||
            slaState(candidate, parsedFilter.asOf) === parsedFilter.slaState),
      );

      return {
        items: tickets.slice(
          parsedFilter.offset,
          parsedFilter.offset + parsedFilter.limit,
        ),
        total: tickets.length,
        offset: parsedFilter.offset,
        limit: parsedFilter.limit,
      };
    });
  }

  async snapshot(): Promise<Ticket[]> {
    return serializeByPath(this.runtimeFile, async () =>
      structuredClone(await this.readTicketsUnlocked()),
    );
  }

  async get(id: TicketId): Promise<Ticket> {
    const parsedId = TicketIdSchema.safeParse(id);
    if (!parsedId.success) {
      throw repositoryError("Repository path is not allowed.");
    }
    return serializeByPath(this.runtimeFile, async () => {
      const result = (await this.readTicketsUnlocked()).find(
        (candidate) => candidate.id === parsedId.data,
      );
      if (result === undefined) {
        throw new DomainError("Ticket was not found.", "TICKET_NOT_FOUND");
      }
      return result;
    });
  }

  async update(
    id: TicketId,
    expectedRevision: number,
    mutate: (ticket: Ticket) => Ticket,
  ): Promise<Ticket> {
    const { ticket } = await this.updateWithCommit(
      id,
      expectedRevision,
      mutate,
      async () => undefined,
    );
    return ticket;
  }

  async updateWithCommit<T>(
    id: TicketId,
    expectedRevision: number,
    mutate: (ticket: Ticket) => Ticket,
    commit: (updated: Ticket, previous: Ticket) => Promise<T>,
  ): Promise<{ ticket: Ticket; result: T }> {
    // The callback runs under this runtime file's in-process lock and must not
    // reenter it. This is best-effort exact rollback, not cross-process ACID.
    return serializeByPath(this.runtimeFile, async () => {
      const parsedId = TicketIdSchema.safeParse(id);
      if (!parsedId.success) {
        throw repositoryError("Repository path is not allowed.");
      }
      const tickets = await this.readTicketsUnlocked();
      const index = tickets.findIndex(
        (candidate) => candidate.id === parsedId.data,
      );
      if (index < 0) {
        throw new DomainError("Ticket was not found.", "TICKET_NOT_FOUND");
      }
      const current = tickets[index]!;
      if (current.revision !== expectedRevision) {
        throw new DomainError(
          "Ticket revision does not match.",
          "REVISION_CONFLICT",
        );
      }

      let mutated: Ticket;
      try {
        mutated = mutate(structuredClone(current));
      } catch (error) {
        if (error instanceof DomainError) {
          throw error;
        }
        throw repositoryError("Ticket update was rejected.");
      }
      const parsed = TicketSchema.safeParse({
        ...mutated,
        id: current.id,
        revision: current.revision + 1,
      });
      if (!parsed.success) {
        throw repositoryError("Repository data is invalid.");
      }
      tickets[index] = parsed.data;
      await this.writeTicketsAtomically(tickets);

      try {
        const result = await commit(
          structuredClone(parsed.data),
          structuredClone(current),
        );
        return { ticket: parsed.data, result };
      } catch (error) {
        tickets[index] = current;
        try {
          await this.writeTicketsAtomically(tickets);
        } catch {
          throw repositoryError("Ticket transaction rollback was not safe.");
        }
        throw error;
      }
    });
  }

  private async readTicketsUnlocked(): Promise<Ticket[]> {
    try {
      return await this.readTicketsFrom(this.runtimeFile);
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw repositoryError("Ticket repository is unavailable.");
    }
  }

  private async readSeedTickets(): Promise<Ticket[]> {
    try {
      return await this.readTicketsFrom(this.seedFile);
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw repositoryError("Repository could not be initialized.");
    }
  }

  private async readTicketsFrom(path: string): Promise<Ticket[]> {
    await assertSafeFile(path);
    let handle;
    try {
      // This narrows local check/use races. Node pathname APIs cannot prevent
      // a hostile concurrent parent-junction swap without native openat APIs.
      handle = await this.fileSystem.open(path, "r");
      await assertSafeOpenedFile(handle);
      return parseTickets(JSON.parse(await handle.readFile("utf8")));
    } catch (error) {
      if (error instanceof DomainError || isMissing(error)) {
        throw error;
      }
      throw repositoryError("Repository data is invalid.");
    } finally {
      await closeQuietly(handle);
    }
  }

  private async writeTicketsAtomically(tickets: Ticket[]): Promise<void> {
    const temporaryFile = resolve(
      this.runtimeRoot,
      `.tickets.json.${randomUUID()}.tmp`,
    );
    let handle;
    try {
      await assertNoLinkedPath(this.runtimeRoot);
      await assertSafeFile(this.runtimeFile);
      handle = await this.fileSystem.open(temporaryFile, "wx");
      await assertSafeOpenedFile(handle);
      await handle.writeFile(`${JSON.stringify(tickets, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.fileSystem.rename(temporaryFile, this.runtimeFile);
      await this.syncDirectory();
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw repositoryError("Ticket update could not be persisted.");
    } finally {
      await closeQuietly(handle);
      await removeQuietly(this.fileSystem.rm, temporaryFile);
    }
  }

  private async syncDirectory(): Promise<void> {
    let handle;
    try {
      handle = await this.fileSystem.open(this.runtimeRoot, "r");
      await handle.sync();
    } catch {
      // Directory fsync is not supported consistently on Windows.
    } finally {
      await closeQuietly(handle);
    }
  }
}
