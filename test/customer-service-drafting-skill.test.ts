import { describe, expect, it } from "vitest";
import {
  buildCustomerServiceDraftingInstructions,
  buildCustomerServiceSkillContext,
  isFinalDiagnosisForCustomer,
} from "../src/approval-desk/customer-service-drafting-skill.js";
import type { DiagnosisContext } from "../src/triage-service.js";

const likelyPerformanceDiagnosis: DiagnosisContext = {
  status: "completed",
  causeType: "performance",
  customerSafeSummary:
    "The details narrow the issue to campaign editor loading, but browser/session checks are needed before treating this as a frontend loading issue.",
  evidenceUsed: ["campaign name", "browser/session details"],
  confidence: "likely",
  owner: "engineering",
  recommendedNextAction:
    "Use browser-session checks to decide whether this needs frontend engineering.",
  doNotSay: ["Do not claim this is a confirmed frontend issue."],
};

describe("customer service drafting skill", () => {
  it("treats likely diagnoses as narrowing updates, not finished diagnoses", () => {
    const context = buildCustomerServiceSkillContext({
      diagnosisContext: likelyPerformanceDiagnosis,
    });

    expect(context.stage).toBe("diagnostic-narrowing");
    expect(context.diagnosisFinality).toMatchObject({
      finalForCustomer: false,
      reason: expect.stringContaining("likely"),
    });
    expect(isFinalDiagnosisForCustomer(likelyPerformanceDiagnosis)).toBe(false);
  });

  it("does not treat confirmed diagnoses with open alternatives as finished", () => {
    const ambiguousConfirmed: DiagnosisContext = {
      ...likelyPerformanceDiagnosis,
      confidence: "confirmed",
      customerSafeSummary:
        "The issue is either browser session state or a frontend loading issue.",
    };

    expect(isFinalDiagnosisForCustomer(ambiguousConfirmed)).toBe(false);
    const context = buildCustomerServiceSkillContext({
      diagnosisContext: ambiguousConfirmed,
    });
    expect(context.diagnosisFinality).toBeDefined();
    expect(context.diagnosisFinality?.reason).toContain(
      "open diagnostic alternatives",
    );
  });

  it("adds explicit finality rules to OpenAI drafting instructions", () => {
    const instructions = buildCustomerServiceDraftingInstructions({
      responseStyle: "auto",
      signOff: "Kind regards\nSupport Team\nNorthstar Marketing Support",
    });

    expect(instructions).toContain("Customer service drafting skill");
    expect(instructions).toContain("A likely diagnosis is not a finished diagnosis");
    expect(instructions).toContain("browser session or frontend loading issue");
    expect(instructions).toContain("Return only JSON");
  });

  it("tells GPT to acknowledge evidence naturally instead of reciting it", () => {
    const instructions = buildCustomerServiceDraftingInstructions({
      responseStyle: "auto",
      signOff: "Kind regards\nSupport Team\nNorthstar Marketing Support",
    });

    expect(instructions).toContain("Do not recite received evidence");
    expect(instructions).toContain("one short acknowledgement");
    expect(instructions).toContain("avoid internal-sounding phrases");
  });
});
