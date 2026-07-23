import { z } from "zod";

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
  })
  .strict();

export type DiagnosticState = z.infer<typeof DiagnosticStateSchema>;
export type DiagnosticHypothesis = z.infer<typeof DiagnosticHypothesisSchema>;
export type DiagnosticStateSnapshot = z.infer<
  typeof DiagnosticStateSnapshotSchema
>;
