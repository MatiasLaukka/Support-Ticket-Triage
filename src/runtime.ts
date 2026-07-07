import process from "node:process";
import { resolve } from "node:path";
import { AuditRepository } from "./audit-repository.js";
import { KnowledgeRepository } from "./knowledge-repository.js";
import { RecommendationRepository } from "./recommendation-repository.js";
import { TicketRepository } from "./ticket-repository.js";
import { TriageService } from "./triage-service.js";

const DEFAULT_MINUTES_SAVED = 8;
const STARTUP_PATH_MESSAGES = {
  TRIAGE_DATA_ROOT: "TRIAGE_DATA_ROOT must not be blank.",
  TRIAGE_SEED_FILE: "TRIAGE_SEED_FILE must not be blank.",
  TRIAGE_KNOWLEDGE_ROOT: "TRIAGE_KNOWLEDGE_ROOT must not be blank.",
} as const;

export class StartupConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StartupConfigError";
  }
}

export type RuntimeEnvironment = NodeJS.ProcessEnv;

export interface RuntimeOptions {
  env?: RuntimeEnvironment;
  cwd?: string;
  now?: () => Date;
}

export interface RuntimePaths {
  dataRoot: string;
  seedFile: string;
  knowledgeRoot: string;
  recommendationsRoot: string;
  auditFile: string;
}

export interface RuntimeDependencies {
  tickets: TicketRepository;
  knowledge: KnowledgeRepository;
  recommendations: RecommendationRepository;
  audits: AuditRepository;
  service: TriageService;
  now: () => Date;
  minutesPerAcceptedRecommendation: number;
  paths: RuntimePaths;
}

export function environmentPath(
  name: keyof typeof STARTUP_PATH_MESSAGES,
  fallback: string,
  env: RuntimeEnvironment,
  cwd = process.cwd(),
): string {
  const configured = env[name];
  if (configured !== undefined && configured.trim() === "") {
    throw new StartupConfigError(STARTUP_PATH_MESSAGES[name]);
  }
  return resolve(cwd, configured ?? fallback);
}

export function minutesSaved(env: RuntimeEnvironment): number {
  const configured = env.TRIAGE_MINUTES_SAVED;
  if (configured === undefined) {
    return DEFAULT_MINUTES_SAVED;
  }
  if (configured.trim() === "") {
    throw invalidMinutesSaved();
  }
  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw invalidMinutesSaved();
  }
  return parsed;
}

export async function createRuntimeDependencies(
  options: RuntimeOptions = {},
): Promise<RuntimeDependencies> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const dataRoot = environmentPath("TRIAGE_DATA_ROOT", "data/runtime", env, cwd);
  const seedFile = environmentPath(
    "TRIAGE_SEED_FILE",
    "data/seed/tickets.json",
    env,
    cwd,
  );
  const knowledgeRoot = environmentPath(
    "TRIAGE_KNOWLEDGE_ROOT",
    "data/knowledge",
    env,
    cwd,
  );
  const recommendationsRoot = resolve(dataRoot, "recommendations");
  const auditFile = resolve(dataRoot, "audit", "events.jsonl");
  const minutesPerAcceptedRecommendation = minutesSaved(env);
  const now = options.now ?? (() => new Date());

  const tickets = new TicketRepository(dataRoot, seedFile);
  await tickets.initialize();
  const knowledge = new KnowledgeRepository(knowledgeRoot);
  const recommendations = new RecommendationRepository(recommendationsRoot);
  const audits = new AuditRepository(auditFile);
  const service = new TriageService({
    tickets,
    recommendations,
    audit: audits,
    now,
  });

  return {
    tickets,
    knowledge,
    recommendations,
    audits,
    service,
    now,
    minutesPerAcceptedRecommendation,
    paths: {
      dataRoot,
      seedFile,
      knowledgeRoot,
      recommendationsRoot,
      auditFile,
    },
  };
}

function invalidMinutesSaved(): StartupConfigError {
  return new StartupConfigError(
    "TRIAGE_MINUTES_SAVED must be a finite nonnegative number.",
  );
}
