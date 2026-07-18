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

  it.each([
    ["concise", 140],
    ["balanced", 240],
    ["empathetic", 280],
    ["technical", 340],
    ["executive-update", 200],
  ] as const)("accepts %s drafts at exactly %i words and rejects one more", (style, limit) => {
    const atLimit = validateDraftQuality({
      response: Array.from({ length: limit }, () => "word").join(" "),
      style,
    });
    const overLimit = validateDraftQuality({
      response: Array.from({ length: limit + 1 }, () => "word").join(" "),
      style,
    });

    expect(atLimit.checks).toContainEqual(expect.objectContaining({
      id: "style-word-limit",
      status: "pass",
    }));
    expect(overLimit.checks).toContainEqual(expect.objectContaining({
      id: "style-word-limit",
      status: "fail",
    }));
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

  it("allows a diagnosis-recommended customer action", () => {
    const result = validateDraftQuality({
      response: "Please provide the affected campaign ID.",
      style: "balanced",
      diagnosisContext: {
        status: "completed",
        causeType: "performance",
        customerSafeSummary: "The editor may be slow.",
        evidenceUsed: [],
        confidence: "likely",
        owner: "support",
        recommendedNextAction: "Please provide the affected campaign ID.",
        doNotSay: [],
      },
    });

    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "relevant-information-requests",
      status: "pass",
    }));
  });

  it("warns about unmatched non-sensitive requests", () => {
    const result = validateDraftQuality({
      response: "Please share a screenshot of the issue.",
      style: "balanced",
    });

    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "relevant-information-requests",
      status: "warn",
    }));
    expect(result.blockingMessages).toEqual([]);
  });

  it.each([
    "confirm whether the editor loads internally",
    "verify the editor state internally",
    "test the editor internally",
    "investigate the editor internally",
    "review the editor internally",
    "check the editor internally",
    "look into the editor internally",
    "compare the editor behavior internally",
    "work on the editor internally",
  ])("does not treat support-owned we need to actions as customer requests: %s", (action) => {
    const result = validateDraftQuality({
      response: `We need to ${action}.`,
      style: "balanced",
    });

    expect(result.checks).toContainEqual(expect.objectContaining({
      id: "relevant-information-requests",
      status: "pass",
    }));
  });

  it("still treats we need your billing details as a customer request", () => {
    const result = validateDraftQuality({
      response: "We need your billing account number.",
      style: "balanced",
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
