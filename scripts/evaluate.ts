import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ExpectedOutcomeSchema,
  TriageRecommendationSchema,
} from "../src/domain.js";
import {
  evaluateRecommendations,
  type EvaluationReport,
} from "../src/evaluation.js";

const projectRoot = resolve(import.meta.dirname, "../..");

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function percentage(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function summarize(report: EvaluationReport): string {
  return [
    `Tickets: ${report.ticketCount}`,
    `category ${percentage(report.categoryAccuracy)}`,
    `routing ${percentage(report.routingAccuracy)}`,
    `priority ${percentage(report.priorityAgreement)}`,
    `safety violations ${report.approvalSafetyViolations}`,
  ].join(" | ");
}

function errorDetail(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "issues" in error &&
    Array.isArray(error.issues)
  ) {
    const firstIssue = error.issues[0];
    if (
      typeof firstIssue === "object" &&
      firstIssue !== null &&
      "message" in firstIssue &&
      typeof firstIssue.message === "string"
    ) {
      const path =
        "path" in firstIssue && Array.isArray(firstIssue.path)
          ? firstIssue.path.join(".")
          : "";
      return path === ""
        ? firstIssue.message
        : `${firstIssue.message} at ${path}`;
    }
  }

  if (error instanceof Error) {
    return error.message.split(/\r?\n/, 1)[0]?.trim() || error.name;
  }
  return "Unknown evaluation error.";
}

async function main(): Promise<void> {
  const recommendationsPath =
    process.argv[2] ??
    resolve(projectRoot, "data/seed/sample-recommendations.json");
  const expectedOutcomesPath =
    process.argv[3] ?? resolve(projectRoot, "data/seed/expected-outcomes.json");
  const recommendations = TriageRecommendationSchema.array().parse(
    await readJson(resolve(recommendationsPath)),
  );
  const expectedOutcomes = ExpectedOutcomeSchema.array().parse(
    await readJson(resolve(expectedOutcomesPath)),
  );
  const report = evaluateRecommendations(recommendations, expectedOutcomes);

  console.log(JSON.stringify(report, null, 2));
  console.log(summarize(report));
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  main().catch((error: unknown) => {
    console.error(`Evaluation failed: ${errorDetail(error)}`);
    process.exitCode = 1;
  });
}
