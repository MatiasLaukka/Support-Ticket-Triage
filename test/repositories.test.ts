import {
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AuditEventSchema,
  TicketSchema,
  TriageRecommendationSchema,
  type AuditEvent,
  type Ticket,
  type TriageRecommendation,
} from "../src/domain.js";
import { DomainError } from "../src/errors.js";
import { AuditRepository } from "../src/audit-repository.js";
import { KnowledgeRepository } from "../src/knowledge-repository.js";
import { RecommendationRepository } from "../src/recommendation-repository.js";
import { TicketRepository } from "../src/ticket-repository.js";

const temporaryRoots: string[] = [];

const baseTicket = TicketSchema.parse({
  id: "TKT-1001",
  createdAt: "2026-06-10T08:00:00.000Z",
  updatedAt: "2026-06-10T08:30:00.000Z",
  customer: {
    name: "Northstar Labs",
    plan: "enterprise",
    region: "eu-west",
    vip: false,
  },
  subject: "API requests return 503",
  description: "Production requests fail consistently.",
  status: "triage",
  category: "api",
  priority: "P1",
  team: "api-platform",
  assignee: "operator@example.test",
  tags: ["api", "outage"],
  sla: {
    responseDueAt: "2026-06-10T10:30:00.000Z",
    breached: false,
  },
  relatedTicketIds: [],
  revision: 2,
});

const recommendation = TriageRecommendationSchema.parse({
  id: "d61bba15-41f4-495b-a794-93696343cc9d",
  ticketId: "TKT-1001",
  sourceRevision: 2,
  category: "incident",
  priority: "P1",
  team: "incident-response",
  duplicateCandidates: [],
  outageRisk: "likely",
  securityRisk: "none",
  slaRisk: "possible",
  missingInformation: [],
  knowledgeArticleIds: ["api-errors"],
  draftCustomerResponse: "We are investigating the elevated API errors.",
  rationale: "Multiple reports share a production failure signature.",
  confidence: 0.9,
  recommendedNextAction: "Notify incident response.",
  escalationRequired: true,
  escalationReasons: ["outage"],
  resolution: "pending",
  createdAt: "2026-06-10T08:35:00.000Z",
});

const auditEvent = AuditEventSchema.parse({
  id: "00c96411-a595-4e2a-8869-c219d7637980",
  timestamp: "2026-06-10T08:40:01.000Z",
  actor: "casey",
  action: "recommendation-approved",
  ticketId: "TKT-1001",
  recommendationId: recommendation.id,
  before: { priority: "P3" },
  after: { priority: "P1" },
  rationale: "Approved incident routing.",
  knowledgeArticleIds: ["api-errors"],
  result: "success",
});

function auditEventAt(index: number, ticketId: Ticket["id"]): AuditEvent {
  return AuditEventSchema.parse({
    ...auditEvent,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    timestamp: new Date(
      Date.parse("2026-06-10T08:40:01.000Z") + index * 1_000,
    ).toISOString(),
    ticketId,
  });
}

function recommendationAt(
  index: number,
  overrides: Partial<TriageRecommendation> = {},
): TriageRecommendation {
  return TriageRecommendationSchema.parse({
    ...recommendation,
    id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    createdAt: new Date(
      Date.parse("2026-06-10T08:35:00.000Z") + index * 1_000,
    ).toISOString(),
    ...overrides,
  });
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "support-repositories-"));
  temporaryRoots.push(root);
  return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ticket(
  id: `TKT-${number}`,
  overrides: Partial<Ticket> = {},
): Ticket {
  return TicketSchema.parse({
    ...baseTicket,
    id,
    ...overrides,
    customer: {
      ...baseTicket.customer,
      ...overrides.customer,
    },
    sla: {
      ...baseTicket.sla,
      ...overrides.sla,
    },
  });
}

async function createTicketRepository(
  tickets: Ticket[],
): Promise<{
  repository: TicketRepository;
  root: string;
  runtimeRoot: string;
  seedFile: string;
}> {
  const root = await temporaryRoot();
  const runtimeRoot = resolve(root, "runtime");
  const seedFile = resolve(root, "tickets.seed.json");
  await writeJson(seedFile, tickets);
  const repository = new TicketRepository(runtimeRoot, seedFile);
  await repository.initialize();
  return { repository, root, runtimeRoot, seedFile };
}

function expectDomainError(
  code: string,
  message: string,
): (error: unknown) => boolean {
  return (error) => {
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code, message });
    for (const root of temporaryRoots) {
      expect(String((error as Error).message)).not.toContain(root);
    }
    return true;
  };
}

function constructWithFileSystem<T>(
  Repository: new (...args: never[]) => T,
  args: unknown[],
  fileSystem: Record<string, unknown>,
): T {
  const InjectableRepository = Repository as unknown as new (
    ...constructorArgs: unknown[]
  ) => T;
  return new InjectableRepository(...args, fileSystem);
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolvePromise = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("TicketRepository", () => {
  it("maps runtime directory creation failures to a safe repository error", async () => {
    const root = await temporaryRoot();
    const blockingFile = resolve(root, "blocked");
    const seedFile = resolve(root, "tickets.seed.json");
    await writeFile(blockingFile, "not a directory", "utf8");
    await writeJson(seedFile, [baseTicket]);

    await expect(
      new TicketRepository(resolve(blockingFile, "runtime"), seedFile).initialize(),
    ).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository could not be initialized.",
      ),
    );
  });

  it("maps a missing seed file to a safe repository error", async () => {
    const root = await temporaryRoot();
    const runtimeRoot = resolve(root, "runtime");
    const missingSeedFile = resolve(root, "missing-seed.json");

    await expect(
      new TicketRepository(runtimeRoot, missingSeedFile).initialize(),
    ).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository could not be initialized.",
      ),
    );
  });

  it("initializes runtime tickets from seed without overwriting existing state", async () => {
    const root = await temporaryRoot();
    const runtimeRoot = resolve(root, "runtime");
    const seedFile = resolve(root, "tickets.seed.json");
    await writeJson(seedFile, [baseTicket]);

    const repository = new TicketRepository(runtimeRoot, seedFile);
    await repository.initialize();
    const runtimeFile = resolve(runtimeRoot, "tickets.json");
    const existing = [
      ticket("TKT-1002", {
        subject: "Existing runtime state",
        revision: 7,
      }),
    ];
    await writeJson(runtimeFile, existing);
    await repository.initialize();

    expect(JSON.parse(await readFile(runtimeFile, "utf8"))).toEqual(existing);
  });

  it("cleans a failed initial ticket write and allows retry", async () => {
    const root = await temporaryRoot();
    const runtimeRoot = resolve(root, "runtime");
    const seedFile = resolve(root, "tickets.seed.json");
    await writeJson(seedFile, [baseTicket]);
    let failFirstWrite = true;
    const repository = constructWithFileSystem(
      TicketRepository,
      [runtimeRoot, seedFile],
      {
        open: async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          return {
            readFile: handle.readFile.bind(handle),
            writeFile: async (
              value: Parameters<typeof handle.writeFile>[0],
              options?: Parameters<typeof handle.writeFile>[1],
            ) => {
              if (failFirstWrite) {
                failFirstWrite = false;
                await handle.writeFile("partial", "utf8");
                throw new Error(`write failed at ${runtimeRoot}`);
              }
              return handle.writeFile(value, options);
            },
            sync: handle.sync.bind(handle),
            stat: handle.stat.bind(handle),
            close: handle.close.bind(handle),
          };
        },
      },
    );

    await expect(repository.initialize()).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository could not be initialized.",
      ),
    );
    expect(await readdir(runtimeRoot)).toEqual([]);

    await expect(repository.initialize()).resolves.toBeUndefined();
    await expect(repository.get("TKT-1001")).resolves.toEqual(baseTicket);
    expect(await readdir(runtimeRoot)).toEqual(["tickets.json"]);
  });

  it("rolls back a ticket published when temporary-link cleanup fails", async () => {
    const root = await temporaryRoot();
    const runtimeRoot = resolve(root, "runtime");
    const seedFile = resolve(root, "tickets.seed.json");
    await writeJson(seedFile, [baseTicket]);
    let failFirstRemove = true;
    const repository = constructWithFileSystem(
      TicketRepository,
      [runtimeRoot, seedFile],
      {
        rm: async (...args: Parameters<typeof rm>) => {
          if (failFirstRemove) {
            failFirstRemove = false;
            throw new Error(`remove failed at ${runtimeRoot}`);
          }
          return rm(...args);
        },
      },
    );

    await expect(repository.initialize()).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository could not be initialized.",
      ),
    );
    expect(await readdir(runtimeRoot)).toEqual([]);

    await expect(repository.initialize()).resolves.toBeUndefined();
    await expect(repository.get("TKT-1001")).resolves.toEqual(baseTicket);
  });

  it.each([
    [
      "list",
      (repository: TicketRepository) => repository.list({}),
    ],
    [
      "get",
      (repository: TicketRepository) => repository.get("TKT-1001"),
    ],
    [
      "update",
      (repository: TicketRepository) =>
        repository.update("TKT-1001", 2, (current) => current),
    ],
  ])(
    "maps missing runtime state during %s to a safe repository error",
    async (_method, operation) => {
      const root = await temporaryRoot();
      const runtimeRoot = resolve(root, "runtime");
      const seedFile = resolve(root, "tickets.seed.json");
      await mkdir(runtimeRoot);
      await writeJson(seedFile, [baseTicket]);
      const repository = new TicketRepository(runtimeRoot, seedFile);

      await expect(operation(repository)).rejects.toSatisfy(
        expectDomainError(
          "REPOSITORY_ERROR",
          "Ticket repository is unavailable.",
        ),
      );
    },
  );

  it("filters tickets by status, category, priority, team, and SLA state", async () => {
    const { repository } = await createTicketRepository([
      ticket("TKT-1001", {
        status: "triage",
        category: "api",
        priority: "P1",
        team: "api-platform",
        sla: {
          responseDueAt: "2026-06-10T10:30:00.000Z",
          breached: false,
        },
      }),
      ticket("TKT-1002", {
        status: "new",
        category: "billing",
        priority: "P3",
        team: "billing",
        sla: {
          responseDueAt: "2026-06-10T09:30:00.000Z",
          breached: false,
        },
      }),
      ticket("TKT-1003", {
        status: "in-progress",
        category: "security",
        priority: "P2",
        team: "security",
        sla: {
          responseDueAt: "2026-06-10T08:30:00.000Z",
          breached: true,
        },
      }),
    ]);

    await expect(repository.list({ status: "new" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "TKT-1002" })],
      total: 1,
    });
    await expect(repository.list({ category: "security" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "TKT-1003" })],
      total: 1,
    });
    await expect(repository.list({ priority: "P1" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "TKT-1001" })],
      total: 1,
    });
    await expect(repository.list({ team: "billing" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "TKT-1002" })],
      total: 1,
    });
    await expect(
      repository.list({
        slaState: "at-risk",
        asOf: "2026-06-10T09:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "TKT-1002" })],
      total: 1,
    });
    await expect(
      repository.list({
        slaState: "breached",
        asOf: "2026-06-10T09:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "TKT-1003" })],
      total: 1,
    });
    await expect(
      repository.list({
        slaState: "healthy",
        asOf: "2026-06-10T09:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "TKT-1001" })],
      total: 1,
    });
  });

  it("bounds pagination limits to 50 and reports the filtered total", async () => {
    const tickets = Array.from({ length: 55 }, (_, index) =>
      ticket(`TKT-${String(1001 + index).padStart(4, "0")}` as `TKT-${number}`),
    );
    const { repository } = await createTicketRepository(tickets);

    const firstPage = await repository.list({ limit: 500 });
    const secondPage = await repository.list({ offset: 50, limit: 500 });

    expect(firstPage).toMatchObject({ total: 55, offset: 0, limit: 50 });
    expect(firstPage.items).toHaveLength(50);
    expect(secondPage).toMatchObject({ total: 55, offset: 50, limit: 50 });
    expect(secondPage.items).toHaveLength(5);
  });

  it("returns one cloned validated ticket snapshot", async () => {
    const values = [baseTicket, ticket("TKT-1002")];
    const { repository } = await createTicketRepository(values);

    const snapshot = await repository.snapshot();
    snapshot[0]!.subject = "mutated caller copy";

    await expect(repository.snapshot()).resolves.toEqual(values);
  });

  it("waits for an active transaction before reading a ticket snapshot", async () => {
    const { runtimeRoot, seedFile } = await createTicketRepository([baseTicket]);
    const writer = new TicketRepository(runtimeRoot, seedFile);
    const reader = new TicketRepository(runtimeRoot, seedFile);
    const commitStarted = deferred();
    const allowCommitFailure = deferred();

    const transaction = writer.updateWithCommit(
      "TKT-1001",
      2,
      (current) => ({
        ...current,
        priority: "P2",
        updatedAt: "2026-06-10T08:45:00.000Z",
      }),
      async () => {
        commitStarted.resolve();
        await allowCommitFailure.promise;
        throw new DomainError("Commit failed.", "REPOSITORY_ERROR");
      },
    );
    await commitStarted.promise;
    const snapshot = reader.snapshot();
    const snapshotState = await Promise.race([
      snapshot.then(() => "completed"),
      new Promise<string>((resolveRace) =>
        setTimeout(() => resolveRace("waiting"), 25),
      ),
    ]);
    allowCommitFailure.resolve();

    expect(snapshotState).toBe("waiting");
    await expect(transaction).rejects.toMatchObject({ message: "Commit failed." });
    await expect(snapshot).resolves.toEqual([baseTicket]);
  });

  it("reads and atomically updates a ticket when its revision matches", async () => {
    const { repository, runtimeRoot } = await createTicketRepository([baseTicket]);

    await expect(repository.get("TKT-1001")).resolves.toEqual(baseTicket);
    const updated = await repository.update("TKT-1001", 2, (current) => ({
      ...current,
      status: "in-progress",
      updatedAt: "2026-06-10T08:45:00.000Z",
    }));

    expect(updated).toMatchObject({ status: "in-progress", revision: 3 });
    await expect(repository.get("TKT-1001")).resolves.toEqual(updated);
    expect(await readdir(runtimeRoot)).toEqual(["tickets.json"]);
  });

  it("updates a ticket and returns the commit callback result", async () => {
    const { repository } = await createTicketRepository([baseTicket]);

    const result = await repository.updateWithCommit(
      "TKT-1001",
      2,
      (current) => ({
        ...current,
        status: "in-progress",
        updatedAt: "2026-06-10T08:45:00.000Z",
      }),
      async (updated, previous) => ({
        updatedRevision: updated.revision,
        previousRevision: previous.revision,
      }),
    );

    expect(result).toEqual({
      ticket: expect.objectContaining({
        status: "in-progress",
        revision: 3,
      }),
      result: {
        updatedRevision: 3,
        previousRevision: 2,
      },
    });
  });

  it("restores the exact previous ticket collection when the commit callback fails", async () => {
    const { repository } = await createTicketRepository([baseTicket]);
    const callbackError = new DomainError(
      "Recommendation transition failed.",
      "REPOSITORY_ERROR",
    );

    await expect(
      repository.updateWithCommit(
        "TKT-1001",
        2,
        (current) => ({
          ...current,
          priority: "P2",
          updatedAt: "2026-06-10T08:45:00.000Z",
        }),
        async () => {
          throw callbackError;
        },
      ),
    ).rejects.toBe(callbackError);

    await expect(repository.get("TKT-1001")).resolves.toEqual(baseTicket);
    await expect(
      repository.update("TKT-1001", 2, (current) => ({
        ...current,
        status: "in-progress",
        updatedAt: "2026-06-10T08:46:00.000Z",
      })),
    ).resolves.toMatchObject({
      status: "in-progress",
      revision: 3,
    });
  });

  it("holds concurrent updates until rollback completes and then applies to restored state", async () => {
    const { runtimeRoot, seedFile } = await createTicketRepository([baseTicket]);
    const first = new TicketRepository(runtimeRoot, seedFile);
    const second = new TicketRepository(runtimeRoot, seedFile);
    const commitStarted = deferred();
    const allowCommitFailure = deferred();

    const transaction = first.updateWithCommit(
      "TKT-1001",
      2,
      (current) => ({
        ...current,
        priority: "P2",
        updatedAt: "2026-06-10T08:45:00.000Z",
      }),
      async () => {
        commitStarted.resolve();
        await allowCommitFailure.promise;
        throw new DomainError("Commit failed.", "REPOSITORY_ERROR");
      },
    );
    await commitStarted.promise;
    const concurrentUpdate = second.update("TKT-1001", 2, (current) => ({
      ...current,
      assignee: "concurrent@example.test",
      updatedAt: "2026-06-10T08:46:00.000Z",
    }));
    const concurrentState = await Promise.race([
      concurrentUpdate.then(
        () => "completed",
        () => "completed",
      ),
      new Promise<string>((resolveRace) =>
        setTimeout(() => resolveRace("waiting"), 25),
      ),
    ]);
    allowCommitFailure.resolve();

    expect(concurrentState).toBe("waiting");
    await expect(transaction).rejects.toMatchObject({
      message: "Commit failed.",
    });
    await expect(concurrentUpdate).resolves.toMatchObject({
      priority: "P1",
      assignee: "concurrent@example.test",
      revision: 3,
    });
  });

  it("does not let get or list observe an intermediate transactional ticket", async () => {
    const { runtimeRoot, seedFile } = await createTicketRepository([baseTicket]);
    const writer = new TicketRepository(runtimeRoot, seedFile);
    const reader = new TicketRepository(runtimeRoot, seedFile);
    const commitStarted = deferred();
    const allowCommitFailure = deferred();

    const transaction = writer.updateWithCommit(
      "TKT-1001",
      2,
      (current) => ({
        ...current,
        priority: "P2",
        updatedAt: "2026-06-10T08:45:00.000Z",
      }),
      async () => {
        commitStarted.resolve();
        await allowCommitFailure.promise;
        throw new DomainError("Commit failed.", "REPOSITORY_ERROR");
      },
    );
    await commitStarted.promise;
    const getResult = reader.get("TKT-1001");
    const listResult = reader.list({});
    const readState = await Promise.race([
      Promise.all([getResult, listResult]).then(() => "completed"),
      new Promise<string>((resolveRace) =>
        setTimeout(() => resolveRace("waiting"), 25),
      ),
    ]);
    allowCommitFailure.resolve();

    expect(readState).toBe("waiting");
    await expect(transaction).rejects.toMatchObject({
      message: "Commit failed.",
    });
    await expect(getResult).resolves.toEqual(baseTicket);
    await expect(listResult).resolves.toMatchObject({
      items: [baseTicket],
      total: 1,
    });
  });

  it("returns a stable unsafe rollback error when exact restoration cannot be persisted", async () => {
    const { runtimeRoot, seedFile } = await createTicketRepository([baseTicket]);
    let renameCount = 0;
    const repository = constructWithFileSystem(
      TicketRepository,
      [runtimeRoot, seedFile],
      {
        rename: async (...args: Parameters<typeof rename>) => {
          renameCount += 1;
          if (renameCount === 2) {
            throw new Error(`rollback rename failed at ${runtimeRoot}`);
          }
          return rename(...args);
        },
      },
    );

    await expect(
      repository.updateWithCommit(
        "TKT-1001",
        2,
        (current) => ({
          ...current,
          priority: "P2",
          updatedAt: "2026-06-10T08:45:00.000Z",
        }),
        async () => {
          throw new DomainError("Commit failed.", "REPOSITORY_ERROR");
        },
      ),
    ).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Ticket transaction rollback was not safe.",
      ),
    );
  });

  it.each([
    [
      "get",
      (repository: TicketRepository) => repository.get("TKT-1001"),
    ],
    [
      "list",
      (repository: TicketRepository) => repository.list({}),
    ],
    [
      "update",
      (repository: TicketRepository) =>
        repository.update("TKT-1001", 3, (ticket) => ticket),
    ],
    [
      "updateWithCommit",
      (repository: TicketRepository) =>
        repository.updateWithCommit(
          "TKT-1001",
          3,
          (ticket) => ticket,
          async () => undefined,
        ),
    ],
  ])(
    "rejects same-path %s reentry from a transaction callback without deadlocking",
    async (_operationName, operation) => {
      const { repository } = await createTicketRepository([baseTicket]);

      await expect(
        repository.updateWithCommit(
          "TKT-1001",
          2,
          (current) => ({
            ...current,
            priority: "P2",
            updatedAt: "2026-06-10T08:45:00.000Z",
          }),
          async () =>
            Promise.race([
              operation(repository),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error("reentrant operation timed out")),
                  100,
                ),
              ),
            ]),
        ),
      ).rejects.toSatisfy(
        expectDomainError(
          "REPOSITORY_ERROR",
          "Ticket transaction callback cannot reenter the same repository.",
        ),
      );
      await expect(repository.get("TKT-1001")).resolves.toEqual(baseTicket);
    },
  );

  it("allows a transaction callback to access an unrelated ticket repository path", async () => {
    const first = await createTicketRepository([baseTicket]);
    const otherTicket = ticket("TKT-1002");
    const second = await createTicketRepository([otherTicket]);

    const result = await first.repository.updateWithCommit(
      "TKT-1001",
      2,
      (current) => ({
        ...current,
        priority: "P2",
        updatedAt: "2026-06-10T08:45:00.000Z",
      }),
      async () => second.repository.get("TKT-1002"),
    );

    expect(result.result).toEqual(otherTicket);
    expect(result.ticket).toMatchObject({ priority: "P2", revision: 3 });
  });

  it("rejects a stale revision without changing persisted state", async () => {
    const { repository } = await createTicketRepository([baseTicket]);

    await expect(
      repository.update("TKT-1001", 1, (current) => ({
        ...current,
        status: "resolved",
      })),
    ).rejects.toSatisfy(
      expectDomainError(
        "REVISION_CONFLICT",
        "Ticket revision does not match.",
      ),
    );
    await expect(repository.get("TKT-1001")).resolves.toEqual(baseTicket);
  });

  it("serializes revision-checked updates across repository instances", async () => {
    const { runtimeRoot, seedFile } = await createTicketRepository([baseTicket]);
    const first = new TicketRepository(runtimeRoot, seedFile);
    const second = new TicketRepository(runtimeRoot, seedFile);

    const results = await Promise.allSettled([
      first.update("TKT-1001", 2, (current) => ({
        ...current,
        status: "in-progress",
        updatedAt: "2026-06-10T08:45:00.000Z",
      })),
      second.update("TKT-1001", 2, (current) => ({
        ...current,
        status: "resolved",
        updatedAt: "2026-06-10T08:46:00.000Z",
      })),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejection = results.find(({ status }) => status === "rejected");
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        name: "DomainError",
        code: "REVISION_CONFLICT",
        message: "Ticket revision does not match.",
      }),
    });
    await expect(first.get("TKT-1001")).resolves.toMatchObject({ revision: 3 });
  });

  it("serializes Windows path aliases for revision-checked updates", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const { runtimeRoot, seedFile } = await createTicketRepository([baseTicket]);
    const runtimeFile = resolve(runtimeRoot, "tickets.json");
    const readStarted = deferred();
    const allowRead = deferred();
    let pauseFirstRuntimeRead = true;
    const first = constructWithFileSystem(
      TicketRepository,
      [runtimeRoot, seedFile],
      {
        open: async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          if (
            pauseFirstRuntimeRead &&
            args[1] === "r" &&
            String(args[0]).toLowerCase() === runtimeFile.toLowerCase()
          ) {
            pauseFirstRuntimeRead = false;
            return {
              readFile: async (...readArgs: Parameters<typeof handle.readFile>) => {
                const content = await handle.readFile(...readArgs);
                readStarted.resolve();
                await allowRead.promise;
                return content;
              },
              stat: handle.stat.bind(handle),
              close: handle.close.bind(handle),
            };
          }
          return handle;
        },
      },
    );
    const second = new TicketRepository(
      runtimeRoot.toUpperCase(),
      seedFile.toUpperCase(),
    );

    const firstUpdate = first.update("TKT-1001", 2, (current) => ({
      ...current,
      status: "in-progress",
      updatedAt: "2026-06-10T08:45:00.000Z",
    }));
    await readStarted.promise;
    const secondUpdate = second.update("TKT-1001", 2, (current) => ({
      ...current,
      status: "resolved",
      updatedAt: "2026-06-10T08:46:00.000Z",
    }));
    const secondState = await Promise.race([
      secondUpdate.then(
        () => "completed",
        () => "completed",
      ),
      new Promise<string>((resolveRace) =>
        setTimeout(() => resolveRace("waiting"), 25),
      ),
    ]);
    allowRead.resolve();
    const results = await Promise.allSettled([firstUpdate, secondUpdate]);

    expect(secondState).toBe("waiting");
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ code: "REVISION_CONFLICT" }),
      }),
    ]);
  });

  it("does not let temporary-file cleanup override a safe update error", async () => {
    const { runtimeRoot, seedFile } = await createTicketRepository([baseTicket]);
    const repository = constructWithFileSystem(
      TicketRepository,
      [runtimeRoot, seedFile],
      {
        rename: async () => {
          throw new Error(`rename failed at ${runtimeRoot}`);
        },
        rm: async () => {
          throw new Error(`cleanup failed at ${runtimeRoot}`);
        },
      },
    );

    await expect(
      repository.update("TKT-1001", 2, (current) => ({
        ...current,
        status: "in-progress",
        updatedAt: "2026-06-10T08:45:00.000Z",
      })),
    ).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Ticket update could not be persisted.",
      ),
    );
  });

  it("returns the stable not-found error for an unknown ticket", async () => {
    const { repository } = await createTicketRepository([baseTicket]);

    await expect(repository.get("TKT-9999")).rejects.toSatisfy(
      expectDomainError("TICKET_NOT_FOUND", "Ticket was not found."),
    );
  });

  it("rejects traversal IDs and linked runtime roots or files", async () => {
    const root = await temporaryRoot();
    const seedFile = resolve(root, "tickets.seed.json");
    await writeJson(seedFile, [baseTicket]);

    const actualRuntimeRoot = resolve(root, "actual-runtime");
    const linkedRuntimeRoot = resolve(root, "linked-runtime");
    await mkdir(actualRuntimeRoot);
    await symlink(actualRuntimeRoot, linkedRuntimeRoot, "junction");
    await expect(
      new TicketRepository(linkedRuntimeRoot, seedFile).initialize(),
    ).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository contains an unsupported linked path.",
      ),
    );

    const runtimeRoot = resolve(root, "runtime");
    const repository = new TicketRepository(runtimeRoot, seedFile);
    await repository.initialize();
    const runtimeFile = resolve(runtimeRoot, "tickets.json");
    const linkedFile = resolve(runtimeRoot, "linked.json");
    await link(runtimeFile, linkedFile);
    await rm(runtimeFile);
    await link(linkedFile, runtimeFile);
    await expect(repository.get("TKT-1001")).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository contains an unsupported linked path.",
      ),
    );
    await expect(repository.get("../outside" as never)).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository path is not allowed.",
      ),
    );
  });

  it("rejects a linked opened ticket handle after preflight validation", async () => {
    const { runtimeRoot, seedFile } = await createTicketRepository([baseTicket]);
    const repository = constructWithFileSystem(
      TicketRepository,
      [runtimeRoot, seedFile],
      {
        open: async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          return {
            readFile: handle.readFile.bind(handle),
            stat: async () => ({
              isFile: () => true,
              nlink: 2,
            }),
            close: handle.close.bind(handle),
          };
        },
      },
    );

    await expect(repository.get("TKT-1001")).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository contains an unsupported linked path.",
      ),
    );
  });
});

describe("KnowledgeRepository", () => {
  it("maps an unusable knowledge root to a safe repository error", async () => {
    const root = await temporaryRoot();
    const knowledgeRoot = resolve(root, "knowledge");
    await writeFile(knowledgeRoot, "not a directory", "utf8");

    await expect(new KnowledgeRepository(knowledgeRoot).list()).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Knowledge repository is unavailable.",
      ),
    );
  });

  it("parses Markdown frontmatter and searches case-insensitively", async () => {
    const root = await temporaryRoot();
    const knowledgeRoot = resolve(root, "knowledge");
    await mkdir(knowledgeRoot);
    await writeFile(
      resolve(knowledgeRoot, "api-errors.md"),
      [
        "---",
        "id: api-errors",
        "title: API Error Investigation",
        "tags: api, errors, validation",
        "---",
        "# Troubleshooting",
        "",
        "Inspect HTTP status codes and request identifiers.",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      resolve(knowledgeRoot, "billing-refunds.md"),
      [
        "---",
        "id: billing-refunds",
        "title: Billing Refunds",
        "tags: billing, refund",
        "---",
        "Verify duplicate charges before refunding.",
        "",
      ].join("\n"),
      "utf8",
    );
    const repository = new KnowledgeRepository(knowledgeRoot);

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({ id: "api-errors" }),
      expect.objectContaining({ id: "billing-refunds" }),
    ]);
    await expect(repository.get("api-errors")).resolves.toMatchObject({
      id: "api-errors",
      title: "API Error Investigation",
      tags: ["api", "errors", "validation"],
      body: "# Troubleshooting\n\nInspect HTTP status codes and request identifiers.",
    });
    await expect(repository.search("http STATUS", 10)).resolves.toEqual([
      expect.objectContaining({ id: "api-errors" }),
    ]);
    await expect(repository.search("BILLING", 1)).resolves.toEqual([
      expect.objectContaining({ id: "billing-refunds" }),
    ]);
  });

  it("requires frontmatter IDs to match filename stems", async () => {
    const root = await temporaryRoot();
    const knowledgeRoot = resolve(root, "knowledge");
    await mkdir(knowledgeRoot);
    await writeFile(
      resolve(knowledgeRoot, "api-errors.md"),
      "---\nid: wrong-id\ntitle: API Errors\ntags: api\n---\nBody.\n",
      "utf8",
    );

    await expect(new KnowledgeRepository(knowledgeRoot).list()).rejects.toSatisfy(
      expectDomainError("REPOSITORY_ERROR", "Repository data is invalid."),
    );
  });

  it("rejects duplicate knowledge article IDs", async () => {
    const root = await temporaryRoot();
    const knowledgeRoot = resolve(root, "knowledge");
    await mkdir(knowledgeRoot);
    await writeFile(
      resolve(knowledgeRoot, "first.md"),
      "---\nid: duplicate\ntitle: First\ntags: test\n---\nFirst body.\n",
      "utf8",
    );
    await writeFile(
      resolve(knowledgeRoot, "second.md"),
      "---\nid: duplicate\ntitle: Second\ntags: test\n---\nSecond body.\n",
      "utf8",
    );

    await expect(new KnowledgeRepository(knowledgeRoot).list()).rejects.toSatisfy(
      expectDomainError("REPOSITORY_ERROR", "Repository data is invalid."),
    );
  });

  it("rejects a linked opened knowledge handle after preflight validation", async () => {
    const root = await temporaryRoot();
    const knowledgeRoot = resolve(root, "knowledge");
    await mkdir(knowledgeRoot);
    await writeFile(
      resolve(knowledgeRoot, "article.md"),
      "---\nid: article\ntitle: Article\ntags: test\n---\nBody.\n",
      "utf8",
    );
    const repository = constructWithFileSystem(
      KnowledgeRepository,
      [knowledgeRoot],
      {
        open: async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          return {
            readFile: handle.readFile.bind(handle),
            stat: async () => ({
              isFile: () => true,
              nlink: 2,
            }),
            close: handle.close.bind(handle),
          };
        },
      },
    );

    // Node pathname APIs cannot eliminate a hostile concurrent parent-junction swap.
    await expect(repository.list()).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository contains an unsupported linked path.",
      ),
    );
  });

  it("rejects traversal and linked knowledge roots or files", async () => {
    const root = await temporaryRoot();
    const actualRoot = resolve(root, "actual");
    const linkedRoot = resolve(root, "linked");
    await mkdir(actualRoot);
    await symlink(actualRoot, linkedRoot, "junction");
    await expect(new KnowledgeRepository(linkedRoot).list()).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository contains an unsupported linked path.",
      ),
    );

    const article = resolve(actualRoot, "article.md");
    const linkedArticle = resolve(actualRoot, "linked.md");
    await writeFile(
      article,
      "---\nid: article\ntitle: Article\ntags: test\n---\nBody.\n",
      "utf8",
    );
    await link(article, linkedArticle);
    await expect(new KnowledgeRepository(actualRoot).list()).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository contains an unsupported linked path.",
      ),
    );
    await expect(
      new KnowledgeRepository(actualRoot).get("../article"),
    ).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository path is not allowed.",
      ),
    );
  });
});

describe("RecommendationRepository", () => {
  it("maps repository directory creation failures to a safe repository error", async () => {
    const root = await temporaryRoot();
    const blockingFile = resolve(root, "blocked");
    await writeFile(blockingFile, "not a directory", "utf8");

    await expect(
      new RecommendationRepository(resolve(blockingFile, "recommendations")).create(
        recommendation,
      ),
    ).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository could not be initialized.",
      ),
    );
  });

  it("creates, reads, and resolves a validated recommendation", async () => {
    const root = await temporaryRoot();
    const repository = new RecommendationRepository(resolve(root, "recommendations"));

    await repository.create(recommendation);
    await expect(repository.get(recommendation.id)).resolves.toEqual(recommendation);
    await repository.markResolved(recommendation.id, "approved");
    await expect(repository.get(recommendation.id)).resolves.toMatchObject({
      id: recommendation.id,
      resolution: "approved",
    });
  });

  it("lists every recommendation sorted by creation time and ID", async () => {
    const root = await temporaryRoot();
    const repository = new RecommendationRepository(resolve(root, "recommendations"));
    const later = recommendationAt(3);
    const sameTimeSecond = recommendationAt(2, {
      createdAt: "2026-06-10T08:35:01.000Z",
    });
    const sameTimeFirst = recommendationAt(1, {
      createdAt: "2026-06-10T08:35:01.000Z",
      resolution: "pending",
    });

    await repository.create(later);
    await repository.create(sameTimeSecond);
    await repository.create(sameTimeFirst);

    await expect(repository.list()).resolves.toEqual([
      sameTimeFirst,
      sameTimeSecond,
      later,
    ]);
  });

  it("rejects malformed and linked recommendation files while listing", async () => {
    const root = await temporaryRoot();
    const repositoryRoot = resolve(root, "recommendations");
    await mkdir(repositoryRoot);
    const malformed = recommendationAt(10);
    await writeFile(
      resolve(repositoryRoot, `${malformed.id}.json`),
      '{"not":"a recommendation"}\n',
      "utf8",
    );

    await expect(
      new RecommendationRepository(repositoryRoot).list(),
    ).rejects.toSatisfy(
      expectDomainError("REPOSITORY_ERROR", "Repository data is invalid."),
    );

    await rm(resolve(repositoryRoot, `${malformed.id}.json`));
    const target = resolve(root, "outside.json");
    const linked = recommendationAt(11);
    await writeJson(target, linked);
    await link(target, resolve(repositoryRoot, `${linked.id}.json`));

    await expect(
      new RecommendationRepository(repositoryRoot).list(),
    ).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository contains an unsupported linked path.",
      ),
    );
  });

  it("transitions recommendation resolution with compare-and-set semantics", async () => {
    const root = await temporaryRoot();
    const repository = new RecommendationRepository(resolve(root, "recommendations"));
    await repository.create(recommendation);

    await repository.transitionResolution(
      recommendation.id,
      "pending",
      "approved",
    );

    await expect(repository.get(recommendation.id)).resolves.toMatchObject({
      resolution: "approved",
    });
  });

  it("returns a stable conflict when recommendation resolution does not match expected state", async () => {
    const root = await temporaryRoot();
    const repository = new RecommendationRepository(resolve(root, "recommendations"));
    await repository.create(recommendation);
    await repository.transitionResolution(
      recommendation.id,
      "pending",
      "approved",
    );

    await expect(
      repository.transitionResolution(
        recommendation.id,
        "pending",
        "rejected",
      ),
    ).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Recommendation resolution does not match expected state.",
      ),
    );
    await expect(repository.get(recommendation.id)).resolves.toMatchObject({
      resolution: "approved",
    });
  });

  it("rolls recommendation resolution back from final to pending", async () => {
    const root = await temporaryRoot();
    const repository = new RecommendationRepository(resolve(root, "recommendations"));
    await repository.create(recommendation);
    await repository.transitionResolution(
      recommendation.id,
      "pending",
      "rejected",
    );

    await repository.transitionResolution(
      recommendation.id,
      "rejected",
      "pending",
    );

    await expect(repository.get(recommendation.id)).resolves.toMatchObject({
      resolution: "pending",
    });
  });

  it("deletes a pending recommendation", async () => {
    const root = await temporaryRoot();
    const repository = new RecommendationRepository(resolve(root, "recommendations"));
    await repository.create(recommendation);

    await repository.deletePending(recommendation.id);

    await expect(repository.get(recommendation.id)).rejects.toSatisfy(
      expectDomainError(
        "RECOMMENDATION_NOT_FOUND",
        "Recommendation was not found.",
      ),
    );
  });

  it.each(["approved", "rejected"] as const)(
    "does not delete a %s recommendation",
    async (resolution) => {
      const root = await temporaryRoot();
      const repository = new RecommendationRepository(
        resolve(root, "recommendations"),
      );
      await repository.create(recommendation);
      await repository.transitionResolution(
        recommendation.id,
        "pending",
        resolution,
      );

      await expect(repository.deletePending(recommendation.id)).rejects.toSatisfy(
        expectDomainError(
          "REPOSITORY_ERROR",
          "Only pending recommendations can be deleted.",
        ),
      );
      await expect(repository.get(recommendation.id)).resolves.toMatchObject({
        resolution,
      });
    },
  );

  it("serializes pending deletion against resolution transitions across instances", async () => {
    const root = await temporaryRoot();
    const repositoryRoot = resolve(root, "recommendations");
    const first = new RecommendationRepository(repositoryRoot);
    const second = new RecommendationRepository(repositoryRoot);
    await first.create(recommendation);

    const results = await Promise.allSettled([
      first.deletePending(recommendation.id),
      second.transitionResolution(recommendation.id, "pending", "approved"),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const finalRead = await first.get(recommendation.id).catch((error) => error);
    if (finalRead instanceof DomainError) {
      expect(finalRead).toMatchObject({ code: "RECOMMENDATION_NOT_FOUND" });
    } else {
      expect(finalRead).toMatchObject({ resolution: "approved" });
    }
  });

  it("serializes compare-and-set transitions across repository instances", async () => {
    const root = await temporaryRoot();
    const repositoryRoot = resolve(root, "recommendations");
    const first = new RecommendationRepository(repositoryRoot);
    const second = new RecommendationRepository(repositoryRoot);
    await first.create(recommendation);

    const results = await Promise.allSettled([
      first.transitionResolution(recommendation.id, "pending", "approved"),
      second.transitionResolution(recommendation.id, "pending", "rejected"),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({
          name: "DomainError",
          code: "REPOSITORY_ERROR",
          message: "Recommendation resolution does not match expected state.",
        }),
      }),
    ]);
    const finalValue = await first.get(recommendation.id);
    expect(["approved", "rejected"]).toContain(finalValue.resolution);
  });

  it("cleans a failed recommendation create and allows retry", async () => {
    const root = await temporaryRoot();
    const repositoryRoot = resolve(root, "recommendations");
    let failFirstWrite = true;
    const repository = constructWithFileSystem(
      RecommendationRepository,
      [repositoryRoot],
      {
        open: async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          return {
            readFile: handle.readFile.bind(handle),
            writeFile: async (
              value: Parameters<typeof handle.writeFile>[0],
              options?: Parameters<typeof handle.writeFile>[1],
            ) => {
              if (failFirstWrite) {
                failFirstWrite = false;
                await handle.writeFile("partial", "utf8");
                throw new Error(`write failed at ${repositoryRoot}`);
              }
              return handle.writeFile(value, options);
            },
            sync: handle.sync.bind(handle),
            stat: handle.stat.bind(handle),
            close: handle.close.bind(handle),
          };
        },
      },
    );

    await expect(repository.create(recommendation)).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Recommendation could not be persisted.",
      ),
    );
    expect(await readdir(repositoryRoot)).toEqual([]);

    await expect(repository.create(recommendation)).resolves.toBeUndefined();
    await expect(repository.get(recommendation.id)).resolves.toEqual(recommendation);
    expect(await readdir(repositoryRoot)).toEqual([`${recommendation.id}.json`]);
  });

  it("rolls back a recommendation published when temporary-link cleanup fails", async () => {
    const root = await temporaryRoot();
    const repositoryRoot = resolve(root, "recommendations");
    let failFirstRemove = true;
    const repository = constructWithFileSystem(
      RecommendationRepository,
      [repositoryRoot],
      {
        rm: async (...args: Parameters<typeof rm>) => {
          if (failFirstRemove) {
            failFirstRemove = false;
            throw new Error(`remove failed at ${repositoryRoot}`);
          }
          return rm(...args);
        },
      },
    );

    await expect(repository.create(recommendation)).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Recommendation could not be persisted.",
      ),
    );
    expect(await readdir(repositoryRoot)).toEqual([]);

    await expect(repository.create(recommendation)).resolves.toBeUndefined();
    await expect(repository.get(recommendation.id)).resolves.toEqual(recommendation);
  });

  it("ignores close cleanup failure after a successful create", async () => {
    const root = await temporaryRoot();
    const repositoryRoot = resolve(root, "recommendations");
    let injectedOpenCalled = false;
    const repository = constructWithFileSystem(
      RecommendationRepository,
      [repositoryRoot],
      {
        open: async (...args: Parameters<typeof open>) => {
          injectedOpenCalled = true;
          const handle = await open(...args);
          return {
            writeFile: handle.writeFile.bind(handle),
            stat: handle.stat.bind(handle),
            sync: handle.sync.bind(handle),
            close: async () => {
              await handle.close();
              throw new Error(`close failed at ${repositoryRoot}`);
            },
          };
        },
      },
    );

    await expect(repository.create(recommendation)).resolves.toBeUndefined();
    expect(injectedOpenCalled).toBe(true);
    await expect(
      new RecommendationRepository(repositoryRoot).get(recommendation.id),
    ).resolves.toEqual(recommendation);
  });

  it("rejects duplicate recommendation IDs", async () => {
    const root = await temporaryRoot();
    const repository = new RecommendationRepository(resolve(root, "recommendations"));
    await repository.create(recommendation);

    await expect(repository.create(recommendation)).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Recommendation already exists.",
      ),
    );
  });

  it("returns the stable not-found error for an unknown recommendation", async () => {
    const root = await temporaryRoot();
    const repository = new RecommendationRepository(resolve(root, "recommendations"));

    await expect(
      repository.get("19632c22-405e-4b70-8b84-0cd15f3ba7e1"),
    ).rejects.toSatisfy(
      expectDomainError(
        "RECOMMENDATION_NOT_FOUND",
        "Recommendation was not found.",
      ),
    );
  });

  it("does not let temporary-file cleanup override a safe resolution error", async () => {
    const root = await temporaryRoot();
    const repositoryRoot = resolve(root, "recommendations");
    const setupRepository = new RecommendationRepository(repositoryRoot);
    await setupRepository.create(recommendation);
    const repository = constructWithFileSystem(
      RecommendationRepository,
      [repositoryRoot],
      {
        rename: async () => {
          throw new Error(`rename failed at ${repositoryRoot}`);
        },
        rm: async () => {
          throw new Error(`cleanup failed at ${repositoryRoot}`);
        },
      },
    );

    await expect(
      repository.markResolved(recommendation.id, "approved"),
    ).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Recommendation could not be persisted.",
      ),
    );
  });

  it("serializes conflicting resolution across repository instances", async () => {
    const root = await temporaryRoot();
    const repositoryRoot = resolve(root, "recommendations");
    const first = new RecommendationRepository(repositoryRoot);
    const second = new RecommendationRepository(repositoryRoot);
    await first.create(recommendation);

    const results = await Promise.allSettled([
      first.markResolved(recommendation.id, "approved"),
      second.markResolved(recommendation.id, "rejected"),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejection = results.find(({ status }) => status === "rejected");
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        name: "DomainError",
        code: "REPOSITORY_ERROR",
        message: "Recommendation is already resolved.",
      }),
    });
    const finalValue = await first.get(recommendation.id);
    const successfulResolution =
      results[0]?.status === "fulfilled" ? "approved" : "rejected";
    expect(finalValue.resolution).toBe(successfulResolution);
  });

  it("serializes Windows path aliases for conflicting resolution", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const root = await temporaryRoot();
    const repositoryRoot = resolve(root, "recommendations");
    const setupRepository = new RecommendationRepository(repositoryRoot);
    await setupRepository.create(recommendation);
    const recommendationFile = resolve(
      repositoryRoot,
      `${recommendation.id}.json`,
    );
    const readStarted = deferred();
    const allowRead = deferred();
    let pauseFirstRead = true;
    const first = constructWithFileSystem(
      RecommendationRepository,
      [repositoryRoot],
      {
        open: async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          if (
            pauseFirstRead &&
            args[1] === "r" &&
            String(args[0]).toLowerCase() === recommendationFile.toLowerCase()
          ) {
            pauseFirstRead = false;
            return {
              readFile: async (...readArgs: Parameters<typeof handle.readFile>) => {
                const content = await handle.readFile(...readArgs);
                readStarted.resolve();
                await allowRead.promise;
                return content;
              },
              stat: handle.stat.bind(handle),
              close: handle.close.bind(handle),
            };
          }
          return handle;
        },
      },
    );
    const second = new RecommendationRepository(repositoryRoot.toUpperCase());

    const firstResolution = first.markResolved(recommendation.id, "approved");
    await readStarted.promise;
    const secondResolution = second.markResolved(recommendation.id, "rejected");
    const secondState = await Promise.race([
      secondResolution.then(
        () => "completed",
        () => "completed",
      ),
      new Promise<string>((resolveRace) =>
        setTimeout(() => resolveRace("waiting"), 25),
      ),
    ]);
    allowRead.resolve();
    const results = await Promise.allSettled([
      firstResolution,
      secondResolution,
    ]);

    expect(secondState).toBe("waiting");
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({
          code: "REPOSITORY_ERROR",
          message: "Recommendation is already resolved.",
        }),
      }),
    ]);
  });

  it("rejects traversal and linked recommendation roots or files", async () => {
    const root = await temporaryRoot();
    const actualRoot = resolve(root, "actual");
    const linkedRoot = resolve(root, "linked");
    await mkdir(actualRoot);
    await symlink(actualRoot, linkedRoot, "junction");
    await expect(
      new RecommendationRepository(linkedRoot).create(recommendation),
    ).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository contains an unsupported linked path.",
      ),
    );

    const repository = new RecommendationRepository(actualRoot);
    await repository.create(recommendation);
    const recommendationFile = resolve(actualRoot, `${recommendation.id}.json`);
    const linkedFile = resolve(actualRoot, "linked.json");
    await link(recommendationFile, linkedFile);
    await expect(repository.get(recommendation.id)).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository contains an unsupported linked path.",
      ),
    );
    await expect(repository.get("../outside")).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository path is not allowed.",
      ),
    );
  });

  it("rejects a linked opened recommendation handle after preflight validation", async () => {
    const root = await temporaryRoot();
    const repositoryRoot = resolve(root, "recommendations");
    const setupRepository = new RecommendationRepository(repositoryRoot);
    await setupRepository.create(recommendation);
    const repository = constructWithFileSystem(
      RecommendationRepository,
      [repositoryRoot],
      {
        open: async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          return {
            readFile: handle.readFile.bind(handle),
            stat: async () => ({
              isFile: () => true,
              nlink: 2,
            }),
            close: handle.close.bind(handle),
          };
        },
      },
    );

    await expect(repository.get(recommendation.id)).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository contains an unsupported linked path.",
      ),
    );
  });

  it("rejects a linked newly opened recommendation write handle", async () => {
    const root = await temporaryRoot();
    const repositoryRoot = resolve(root, "recommendations");
    let wrote = false;
    const repository = constructWithFileSystem(
      RecommendationRepository,
      [repositoryRoot],
      {
        open: async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          return {
            writeFile: async (...writeArgs: Parameters<typeof handle.writeFile>) => {
              wrote = true;
              return handle.writeFile(...writeArgs);
            },
            sync: handle.sync.bind(handle),
            stat: async () => ({
              isFile: () => true,
              nlink: 2,
            }),
            close: handle.close.bind(handle),
          };
        },
      },
    );

    await expect(repository.create(recommendation)).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository contains an unsupported linked path.",
      ),
    );
    expect(wrote).toBe(false);
  });
});

describe("AuditRepository", () => {
  it("maps audit directory creation failures to a safe repository error", async () => {
    const root = await temporaryRoot();
    const blockingFile = resolve(root, "blocked");
    await writeFile(blockingFile, "not a directory", "utf8");

    await expect(
      new AuditRepository(resolve(blockingFile, "audit", "events.jsonl")).append(
        auditEvent,
      ),
    ).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository could not be initialized.",
      ),
    );
  });

  it("appends one validated JSON object per line and filters by ticket", async () => {
    const root = await temporaryRoot();
    const file = resolve(root, "audit", "events.jsonl");
    const repository = new AuditRepository(file);
    const otherEvent: AuditEvent = AuditEventSchema.parse({
      ...auditEvent,
      id: "19632c22-405e-4b70-8b84-0cd15f3ba7e1",
      ticketId: "TKT-1002",
    });

    await repository.append(auditEvent);
    await repository.append(otherEvent);

    expect((await readFile(file, "utf8")).trim().split("\n")).toHaveLength(2);
    await expect(repository.list()).resolves.toEqual([auditEvent, otherEvent]);
    await expect(repository.list("TKT-1001")).resolves.toEqual([auditEvent]);
  });

  it("pages more than 50 audit events with offset and bounded retention", async () => {
    const root = await temporaryRoot();
    const file = resolve(root, "audit", "events.jsonl");
    await mkdir(resolve(root, "audit"));
    const events = Array.from({ length: 70 }, (_, index) =>
      auditEventAt(
        index + 1,
        index % 2 === 0 ? "TKT-1001" : "TKT-1002",
      ),
    );
    await writeFile(
      file,
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );
    const repository = new AuditRepository(file);

    await expect(
      repository.listPage({ offset: 10, limit: 500 }),
    ).resolves.toEqual({
      events: events.slice(10, 60),
      total: 70,
      offset: 10,
      limit: 50,
    });
    await expect(
      repository.listPage({ offset: 65, limit: 50 }),
    ).resolves.toEqual({
      events: events.slice(65),
      total: 70,
      offset: 65,
      limit: 50,
    });
  });

  it("pages and counts only audit events matching the ticket filter", async () => {
    const root = await temporaryRoot();
    const file = resolve(root, "events.jsonl");
    const events = Array.from({ length: 12 }, (_, index) =>
      auditEventAt(
        index + 1,
        index % 2 === 0 ? "TKT-1001" : "TKT-1002",
      ),
    );
    await writeFile(
      file,
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );

    await expect(
      new AuditRepository(file).listPage({
        ticketId: "TKT-1002",
        offset: 2,
        limit: 3,
      }),
    ).resolves.toEqual({
      events: events.filter(({ ticketId }) => ticketId === "TKT-1002").slice(2, 5),
      total: 6,
      offset: 2,
      limit: 3,
    });
  });

  it("rejects a malformed audit line after the retained page", async () => {
    const root = await temporaryRoot();
    const file = resolve(root, "events.jsonl");
    const events = Array.from({ length: 60 }, (_, index) =>
      auditEventAt(index + 1, "TKT-1001"),
    );
    await writeFile(
      file,
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n{"late":"malformed"}\n`,
      "utf8",
    );

    await expect(
      new AuditRepository(file).listPage({ offset: 0, limit: 1 }),
    ).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Audit log contains malformed data.",
      ),
    );
  });

  it("rejects and rolls back a simulated partial audit write", async () => {
    const root = await temporaryRoot();
    const file = resolve(root, "audit", "events.jsonl");
    let injectFirstAppend = true;
    let appendWriteReached = false;
    let rollbackOpenReached = false;
    const repository = constructWithFileSystem(
      AuditRepository,
      [file],
      {
        open: async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          if (!injectFirstAppend) {
            if (args[1] === "r+") {
              rollbackOpenReached = true;
            }
            return handle;
          }
          injectFirstAppend = false;
          return {
            readFile: handle.readFile.bind(handle),
            writeFile: async (
              value: Parameters<typeof handle.writeFile>[0],
            ) => {
              appendWriteReached = true;
              const buffer = Buffer.from(String(value));
              await handle.writeFile(buffer.subarray(0, buffer.length - 1));
              throw new Error(`short write at ${file}`);
            },
            sync: handle.sync.bind(handle),
            stat: handle.stat.bind(handle),
            close: handle.close.bind(handle),
          };
        },
      },
    );

    await expect(repository.append(auditEvent)).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Audit event could not be persisted.",
      ),
    );
    expect(appendWriteReached).toBe(true);
    expect(rollbackOpenReached).toBe(true);
    await expect(repository.list()).resolves.toEqual([]);

    await expect(repository.append(auditEvent)).resolves.toBeUndefined();
    await expect(repository.list()).resolves.toEqual([auditEvent]);
  });

  it("ignores close cleanup failure after a successful append", async () => {
    const root = await temporaryRoot();
    const file = resolve(root, "audit", "events.jsonl");
    let injectedOpenCalled = false;
    const repository = constructWithFileSystem(
      AuditRepository,
      [file],
      {
        open: async (...args: Parameters<typeof open>) => {
          injectedOpenCalled = true;
          const handle = await open(...args);
          return {
            write: handle.write.bind(handle),
            writeFile: handle.writeFile.bind(handle),
            stat: handle.stat.bind(handle),
            sync: handle.sync.bind(handle),
            close: async () => {
              await handle.close();
              throw new Error(`close failed at ${file}`);
            },
          };
        },
      },
    );

    await expect(repository.append(auditEvent)).resolves.toBeUndefined();
    expect(injectedOpenCalled).toBe(true);
    await expect(new AuditRepository(file).list()).resolves.toEqual([auditEvent]);
  });

  it("makes list wait for an active append from another instance", async () => {
    const root = await temporaryRoot();
    const file = resolve(root, "audit", "events.jsonl");
    const writeStarted = deferred();
    const allowWrite = deferred();
    const writer = constructWithFileSystem(
      AuditRepository,
      [file],
      {
        open: async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          return {
            write: async (...writeArgs: Parameters<typeof handle.write>) => {
              writeStarted.resolve();
              await allowWrite.promise;
              return handle.write(...writeArgs);
            },
            writeFile: async (...writeArgs: Parameters<typeof handle.writeFile>) => {
              writeStarted.resolve();
              await allowWrite.promise;
              return handle.writeFile(...writeArgs);
            },
            sync: handle.sync.bind(handle),
            stat: handle.stat.bind(handle),
            close: handle.close.bind(handle),
          };
        },
      },
    );
    const reader = new AuditRepository(file);

    const appendPromise = writer.append(auditEvent);
    await writeStarted.promise;
    const listPromise = reader.list();
    await expect(
      Promise.race([
        listPromise.then(() => "listed"),
        new Promise<string>((resolveRace) =>
          setTimeout(() => resolveRace("waiting"), 25),
        ),
      ]),
    ).resolves.toBe("waiting");

    allowWrite.resolve();
    await appendPromise;
    await expect(listPromise).resolves.toEqual([auditEvent]);
  });

  it("reserves the audit path for the entire list snapshot", async () => {
    const root = await temporaryRoot();
    const file = resolve(root, "audit", "events.jsonl");
    const setupRepository = new AuditRepository(file);
    await setupRepository.append(auditEvent);
    const otherEvent = AuditEventSchema.parse({
      ...auditEvent,
      id: "19632c22-405e-4b70-8b84-0cd15f3ba7e1",
      ticketId: "TKT-1002",
    });
    const readStarted = deferred();
    const allowRead = deferred();
    let pauseFirstRead = true;
    const reader = constructWithFileSystem(
      AuditRepository,
      [file],
      {
        open: async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          if (pauseFirstRead && args[1] === "r") {
            pauseFirstRead = false;
            return {
              readFile: async (...readArgs: Parameters<typeof handle.readFile>) => {
                readStarted.resolve();
                await allowRead.promise;
                return handle.readFile(...readArgs);
              },
              stat: handle.stat.bind(handle),
              close: handle.close.bind(handle),
            };
          }
          return handle;
        },
      },
    );
    const writer = new AuditRepository(file);

    const listPromise = reader.list();
    await readStarted.promise;
    const appendPromise = writer.append(otherEvent);
    const appendState = await Promise.race([
      appendPromise.then(
        () => "completed",
        () => "completed",
      ),
      new Promise<string>((resolveRace) =>
        setTimeout(() => resolveRace("waiting"), 25),
      ),
    ]);
    allowRead.resolve();

    expect(appendState).toBe("waiting");
    await expect(listPromise).resolves.toEqual([auditEvent]);
    await appendPromise;
    await expect(writer.list()).resolves.toEqual([auditEvent, otherEvent]);
  });

  it("serializes Windows path aliases for audit list and append", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const root = await temporaryRoot();
    const file = resolve(root, "audit", "events.jsonl");
    const setupRepository = new AuditRepository(file);
    await setupRepository.append(auditEvent);
    const otherEvent = AuditEventSchema.parse({
      ...auditEvent,
      id: "19632c22-405e-4b70-8b84-0cd15f3ba7e1",
      ticketId: "TKT-1002",
    });
    const readStarted = deferred();
    const allowRead = deferred();
    let pauseFirstRead = true;
    const reader = constructWithFileSystem(
      AuditRepository,
      [file],
      {
        open: async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          if (pauseFirstRead && args[1] === "r") {
            pauseFirstRead = false;
            return {
              readFile: async (...readArgs: Parameters<typeof handle.readFile>) => {
                readStarted.resolve();
                await allowRead.promise;
                return handle.readFile(...readArgs);
              },
              stat: handle.stat.bind(handle),
              close: handle.close.bind(handle),
            };
          }
          return handle;
        },
      },
    );
    const writer = new AuditRepository(file.toUpperCase());

    const listPromise = reader.list();
    await readStarted.promise;
    const appendPromise = writer.append(otherEvent);
    const appendState = await Promise.race([
      appendPromise.then(
        () => "completed",
        () => "completed",
      ),
      new Promise<string>((resolveRace) =>
        setTimeout(() => resolveRace("waiting"), 25),
      ),
    ]);
    allowRead.resolve();

    expect(appendState).toBe("waiting");
    await expect(listPromise).resolves.toEqual([auditEvent]);
    await appendPromise;
    await expect(reader.list()).resolves.toEqual([auditEvent, otherEvent]);
  });

  it("detects malformed JSONL lines without leaking the file path", async () => {
    const root = await temporaryRoot();
    const file = resolve(root, "events.jsonl");
    await writeFile(
      file,
      `${JSON.stringify(auditEvent)}\n{"not":"an audit event"}\n`,
      "utf8",
    );

    await expect(new AuditRepository(file).list()).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Audit log contains malformed data.",
      ),
    );
  });

  it("rejects linked audit files", async () => {
    const root = await temporaryRoot();
    const file = resolve(root, "events.jsonl");
    const linkedFile = resolve(root, "events-linked.jsonl");
    await writeFile(file, "", "utf8");
    await link(file, linkedFile);

    await expect(new AuditRepository(file).append(auditEvent)).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository contains an unsupported linked path.",
      ),
    );
  });

  it("rejects a linked opened audit handle after preflight validation", async () => {
    const root = await temporaryRoot();
    const file = resolve(root, "events.jsonl");
    await writeFile(file, `${JSON.stringify(auditEvent)}\n`, "utf8");
    const repository = constructWithFileSystem(
      AuditRepository,
      [file],
      {
        open: async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          return {
            readFile: handle.readFile.bind(handle),
            stat: async () => ({
              isFile: () => true,
              nlink: 2,
              size: 0,
            }),
            close: handle.close.bind(handle),
          };
        },
      },
    );

    await expect(repository.list()).rejects.toSatisfy(
      expectDomainError(
        "REPOSITORY_ERROR",
        "Repository contains an unsupported linked path.",
      ),
    );
  });
});
