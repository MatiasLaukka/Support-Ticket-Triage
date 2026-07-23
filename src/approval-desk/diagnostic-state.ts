import { z } from "zod";
import { TeamSchema } from "../domain.js";

const NonBlankStringSchema = z.string().trim().min(1);
const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const DiagnosticStateSchema = z.enum([
  "not-started",
  "insufficient-evidence",
  "ambiguous",
  "working-diagnosis",
  "confirmed",
  "escalated",
]);

export const DiagnosticEscalationReasonSchema = z.enum([
  "diagnostic-ambiguity",
  "contradictory-evidence",
]);

export const DiagnosticHypothesisSchema = z
  .object({
    id: SlugSchema,
    label: NonBlankStringSchema,
    status: z.enum(["plausible", "leading", "confirmed", "ruled-out"]),
    evidenceUsed: z.array(NonBlankStringSchema),
    evidenceToConfirm: z.array(NonBlankStringSchema),
  })
  .strict();

export const DiagnosticStateSnapshotSchema = z
  .object({
    state: DiagnosticStateSchema,
    hypotheses: z.array(DiagnosticHypothesisSchema).min(1),
    evidenceToRequest: z.array(NonBlankStringSchema),
    diagnosticAttempts: z.number().int().nonnegative().default(0),
    escalationReason: DiagnosticEscalationReasonSchema.optional(),
    specialistTeam: TeamSchema.optional(),
  })
  .strict();

export type DiagnosticState = z.infer<typeof DiagnosticStateSchema>;
export type DiagnosticEscalationReason = z.infer<
  typeof DiagnosticEscalationReasonSchema
>;
export type DiagnosticHypothesis = z.infer<typeof DiagnosticHypothesisSchema>;
export type DiagnosticStateSnapshot = z.infer<
  typeof DiagnosticStateSnapshotSchema
>;

export const MAX_DIAGNOSTIC_ATTEMPTS = 2;

export function advanceDiagnosticState(input: {
  current: DiagnosticStateSnapshot;
  customerReplyText: string;
  confirmedHypothesisId?: string;
  contradicted: boolean;
}): DiagnosticStateSnapshot {
  const { current } = input;
  if (input.confirmedHypothesisId !== undefined) {
    const hypotheses = current.hypotheses.map((hypothesis) => ({
      ...hypothesis,
      status: hypothesis.id === input.confirmedHypothesisId
        ? "confirmed" as const
        : "ruled-out" as const,
    }));
    const { escalationReason: _reason, specialistTeam: _team, ...withoutEscalation } = current;
    return DiagnosticStateSnapshotSchema.parse({
      ...withoutEscalation,
      state: "confirmed",
      hypotheses,
    });
  }

  const attempts = current.diagnosticAttempts + 1;
  const shouldEscalate = input.contradicted || attempts >= MAX_DIAGNOSTIC_ATTEMPTS;
  if (shouldEscalate) {
    return DiagnosticStateSnapshotSchema.parse({
      ...current,
      state: "escalated",
      diagnosticAttempts: attempts,
      escalationReason: input.contradicted
        ? "contradictory-evidence"
        : "diagnostic-ambiguity",
      specialistTeam: specialistTeamForHypotheses(current.hypotheses),
    });
  }

  return DiagnosticStateSnapshotSchema.parse({
    ...current,
    state: "ambiguous",
    diagnosticAttempts: attempts,
  });
}

function specialistTeamForHypotheses(
  hypotheses: readonly DiagnosticHypothesis[],
): z.infer<typeof TeamSchema> {
  if (hypotheses.some(({ id }) => id.includes("integration"))) {
    return "integrations";
  }
  if (
    hypotheses.some(({ id }) =>
      ["browser-session", "frontend-loading", "campaign-editor"].includes(id),
    )
  ) {
    return "product";
  }
  return "support";
}
