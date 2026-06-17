import process from "node:process";
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AuditRepository } from "./audit-repository.js";
import { DomainError } from "./errors.js";
import { KnowledgeRepository } from "./knowledge-repository.js";
import { RecommendationRepository } from "./recommendation-repository.js";
import { createTriageServer } from "./server.js";
import { TicketRepository } from "./ticket-repository.js";
import { TriageService } from "./triage-service.js";

const DEFAULT_MINUTES_SAVED = 8;
const STARTUP_PATH_MESSAGES = {
  TRIAGE_DATA_ROOT: "TRIAGE_DATA_ROOT must not be blank.",
  TRIAGE_SEED_FILE: "TRIAGE_SEED_FILE must not be blank.",
  TRIAGE_KNOWLEDGE_ROOT: "TRIAGE_KNOWLEDGE_ROOT must not be blank.",
} as const;

class StartupConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StartupConfigError";
  }
}

function environmentPath(
  name: keyof typeof STARTUP_PATH_MESSAGES,
  fallback: string,
): string {
  const configured = process.env[name];
  if (configured !== undefined && configured.trim() === "") {
    throw new StartupConfigError(STARTUP_PATH_MESSAGES[name]);
  }
  return resolve(process.cwd(), configured ?? fallback);
}

function minutesSaved(): number {
  const configured = process.env.TRIAGE_MINUTES_SAVED;
  if (configured === undefined) {
    return DEFAULT_MINUTES_SAVED;
  }
  if (configured.trim() === "") {
    throw new StartupConfigError(
      "TRIAGE_MINUTES_SAVED must be a finite nonnegative number.",
    );
  }
  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new StartupConfigError(
      "TRIAGE_MINUTES_SAVED must be a finite nonnegative number.",
    );
  }
  return parsed;
}

function safeErrorDetail(error: unknown): string {
  if (error instanceof StartupConfigError || error instanceof DomainError) {
    return error.message;
  }
  return "Unexpected startup error.";
}

async function main(): Promise<void> {
  const dataRoot = environmentPath("TRIAGE_DATA_ROOT", "data/runtime");
  const seedFile = environmentPath(
    "TRIAGE_SEED_FILE",
    "data/seed/tickets.json",
  );
  const knowledgeRoot = environmentPath(
    "TRIAGE_KNOWLEDGE_ROOT",
    "data/knowledge",
  );
  const minutesPerAcceptedRecommendation = minutesSaved();
  const now = () => new Date();

  const tickets = new TicketRepository(dataRoot, seedFile);
  await tickets.initialize();
  const knowledge = new KnowledgeRepository(knowledgeRoot);
  const recommendations = new RecommendationRepository(
    resolve(dataRoot, "recommendations"),
  );
  const audits = new AuditRepository(
    resolve(dataRoot, "audit", "events.jsonl"),
  );
  const service = new TriageService({
    tickets,
    recommendations,
    audit: audits,
    now,
  });
  const server = createTriageServer({
    tickets,
    knowledge,
    recommendations,
    audits,
    service,
    now,
    minutesPerAcceptedRecommendation,
  });

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error("Support ticket triage server failed to start.");
  console.error(safeErrorDetail(error));
  process.exitCode = 1;
});
