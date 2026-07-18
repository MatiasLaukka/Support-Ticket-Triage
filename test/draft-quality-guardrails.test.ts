import { describe, expect, it } from "vitest";
import { validateDraftQuality } from "../src/approval-desk/draft-quality-guardrails.js";

const evidenceReadiness = {
  supportState: "needs-information" as const,
  knownCause: null,
  requiredEvidence: [],
  providedEvidence: [],
  missingEvidence: [{
    id: "browser-version",
    label: "Browser version",
    customerQuestion: "Which browser and version are affected?",
    aliases: ["browser", "browser version"],
    source: "knowledge" as const,
  }],
  nextInvestigationSteps: ["Compare browser behavior."],
};

describe("validateDraftQuality", () => {
  it("enforces the selected style word limit", () => {
    const result = validateDraftQuality({
      response: Array.from({ length: 141 }, () => "word").join(" "),
      style: "concise",
      evidenceReadiness,
    });

    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "style-word-limit",
      status: "fail",
    }));
    expect(result.blockingMessages).toContain("The concise draft exceeds 140 words.");
  });

  it("allows questions for currently missing evidence", () => {
    const result = validateDraftQuality({
      response: "Please share the affected browser and browser version.",
      style: "balanced",
      evidenceReadiness,
    });

    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "relevant-information-requests",
      status: "pass",
    }));
  });

  it("blocks a clear irrelevant information request", () => {
    const result = validateDraftQuality({
      response: "Please share your latest invoice number and billing address.",
      style: "balanced",
      evidenceReadiness,
    });

    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "relevant-information-requests",
      status: "fail",
    }));
  });

  it("allows a trusted fix verification request", () => {
    const result = validateDraftQuality({
      response: "Please retry the campaign editor and confirm whether it loads.",
      style: "balanced",
      evidenceReadiness: { ...evidenceReadiness, missingEvidence: [] },
      fixContext: {
        status: "available",
        customerSafeSummary: "A frontend loading fix is available.",
        customerAction: "Retry the campaign editor.",
        verificationRequest: "Confirm whether the campaign editor loads.",
      },
    });

    expect(result.blockingMessages).toEqual([]);
    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "relevant-information-requests",
      status: "pass",
    }));
  });
});
