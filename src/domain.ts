import { z } from "zod";

const NonBlankStringSchema = z.string().trim().min(1);
const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const IsoTimestampSchema = z.iso.datetime({ offset: true });
export const TicketIdSchema = z.string().regex(/^TKT-\d{4}$/);

export const CategorySchema = z.enum([
  "account-access",
  "authentication",
  "billing",
  "api",
  "integration",
  "performance",
  "incident",
  "security",
  "feature-request",
  "other",
]);

export const PrioritySchema = z.enum(["P1", "P2", "P3", "P4"]);

export const TeamSchema = z.enum([
  "support",
  "billing",
  "identity",
  "api-platform",
  "integrations",
  "incident-response",
  "security",
  "product",
]);

export const TicketStatusSchema = z.enum([
  "new",
  "triage",
  "waiting-customer",
  "in-progress",
  "resolved",
]);

export const RiskSchema = z.enum([
  "none",
  "possible",
  "likely",
  "confirmed",
]);

export const DraftCustomerResponseSourceSchema = z.enum([
  "deterministic",
  "openai",
  "fallback",
]);

export const DraftCustomerResponseStyleSchema = z.enum([
  "balanced",
  "concise",
  "empathetic",
  "technical",
  "executive-update",
]);

export const DraftCustomerResponseStyleInputSchema = z.enum([
  "auto",
  "balanced",
  "concise",
  "empathetic",
  "technical",
  "executive-update",
]);

export const DraftCustomerResponseCheckSchema = z
  .object({
    id: SlugSchema,
    label: NonBlankStringSchema,
    status: z.enum(["pass", "warn"]),
    message: NonBlankStringSchema,
  })
  .strict();

const UniqueNonBlankStringsSchema = z
  .array(NonBlankStringSchema)
  .refine((values) => new Set(values).size === values.length, {
    message: "Values must be unique.",
  });

export const GptAssistAudienceSchema = z.enum([
  "merchant-admin",
  "developer",
  "executive",
]);

export const GptAssistSchema = z
  .object({
    source: DraftCustomerResponseSourceSchema,
    missingInfoSuggestions: UniqueNonBlankStringsSchema.min(1),
    investigationSteps: UniqueNonBlankStringsSchema.min(1),
    tone: DraftCustomerResponseStyleSchema,
    recommendedTone: DraftCustomerResponseStyleSchema,
    selectedTone: DraftCustomerResponseStyleSchema,
    toneReason: NonBlankStringSchema,
    audience: GptAssistAudienceSchema,
    checks: z.array(DraftCustomerResponseCheckSchema),
  })
  .strict();

export const RequiredEscalationSchema = z.enum([
  "security",
  "outage",
  "low-confidence",
  "sla",
  "missing-information",
  "policy-conflict",
]);

export const SupportStateSchema = z.enum([
  "needs-information",
  "information-received",
  "diagnosing",
  "known-cause",
  "no-known-cause",
  "waiting-on-platform-fix",
  "waiting-on-customer-action",
  "ready-for-approval",
]);

export const EvidenceRequirementSchema = z
  .object({
    id: SlugSchema,
    label: NonBlankStringSchema,
    customerQuestion: NonBlankStringSchema,
    aliases: UniqueNonBlankStringsSchema,
    source: z.enum(["knowledge", "known-cause", "policy"]),
  })
  .strict();

export const CustomerSchema = z
  .object({
    name: NonBlankStringSchema,
    plan: NonBlankStringSchema,
    region: NonBlankStringSchema,
    vip: z.boolean(),
  })
  .strict();

export const RequesterTechnicalLevelSchema = z.enum([
  "non-technical",
  "technical",
  "developer",
]);

export const RequesterSenioritySchema = z.enum([
  "individual-contributor",
  "manager",
  "executive",
]);

export const RequesterSchema = z
  .object({
    name: NonBlankStringSchema,
    role: NonBlankStringSchema,
    department: NonBlankStringSchema,
    technicalLevel: RequesterTechnicalLevelSchema,
    seniority: RequesterSenioritySchema,
  })
  .strict();

export const SLASchema = z
  .object({
    responseDueAt: IsoTimestampSchema,
    breached: z.boolean(),
  })
  .strict();

export const TicketSchema = z
  .object({
    id: TicketIdSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    customer: CustomerSchema,
    requester: RequesterSchema.optional(),
    subject: NonBlankStringSchema,
    description: NonBlankStringSchema,
    status: TicketStatusSchema,
    category: CategorySchema.optional(),
    priority: PrioritySchema.optional(),
    team: TeamSchema.optional(),
    assignee: NonBlankStringSchema.optional(),
    tags: z.array(NonBlankStringSchema),
    sla: SLASchema,
    relatedTicketIds: z
      .array(TicketIdSchema)
      .refine((ticketIds) => new Set(ticketIds).size === ticketIds.length, {
        message: "Related ticket IDs must be unique.",
      })
      .default([]),
    revision: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (ticket) =>
      new Date(ticket.updatedAt).getTime() >=
      new Date(ticket.createdAt).getTime(),
    {
      message: "updatedAt must be at or after createdAt.",
      path: ["updatedAt"],
    },
  )
  .refine(
    (ticket) =>
      new Date(ticket.sla.responseDueAt).getTime() >=
      new Date(ticket.createdAt).getTime(),
    {
      message: "sla.responseDueAt must be at or after createdAt.",
      path: ["sla", "responseDueAt"],
    },
  );

export const KnowledgeArticleSchema = z
  .object({
    id: SlugSchema,
    title: NonBlankStringSchema,
    tags: z.array(NonBlankStringSchema),
    body: NonBlankStringSchema,
  })
  .strict();

export const DuplicateCandidateSchema = z
  .object({
    ticketId: TicketIdSchema,
    confidence: z.number().min(0).max(1),
    evidence: NonBlankStringSchema,
  })
  .strict();

export const TriageRecommendationSchema = z
  .object({
    id: z.uuid(),
    ticketId: TicketIdSchema,
    sourceRevision: z.number().int().nonnegative(),
    category: CategorySchema,
    priority: PrioritySchema,
    team: TeamSchema,
    assignee: NonBlankStringSchema.nullable().optional(),
    ticketStatus: TicketStatusSchema.optional(),
    tags: UniqueNonBlankStringsSchema.optional(),
    duplicateCandidates: z.array(DuplicateCandidateSchema),
    outageRisk: RiskSchema,
    securityRisk: RiskSchema,
    slaRisk: RiskSchema,
    missingInformation: z.array(NonBlankStringSchema),
    supportState: SupportStateSchema.optional(),
    knownCause: SlugSchema.nullable().optional(),
    requiredEvidence: z.array(EvidenceRequirementSchema).optional(),
    providedEvidence: z.array(EvidenceRequirementSchema).optional(),
    missingEvidence: z.array(EvidenceRequirementSchema).optional(),
    nextInvestigationSteps: UniqueNonBlankStringsSchema.optional(),
    knowledgeArticleIds: z.array(SlugSchema),
    draftCustomerResponse: NonBlankStringSchema,
    draftCustomerResponseSource: DraftCustomerResponseSourceSchema.optional(),
    draftCustomerResponseStyle: DraftCustomerResponseStyleSchema.optional(),
    draftCustomerResponseChecks: z
      .array(DraftCustomerResponseCheckSchema)
      .optional(),
    gptAssist: GptAssistSchema.optional(),
    rationale: NonBlankStringSchema,
    confidence: z.number().min(0).max(1),
    recommendedNextAction: NonBlankStringSchema,
    escalationRequired: z.boolean(),
    escalationReasons: z
      .array(RequiredEscalationSchema)
      .refine((reasons) => new Set(reasons).size === reasons.length, {
        message: "Escalation reasons must be unique.",
      }),
    resolution: z.enum(["pending", "approved", "rejected", "canceled"]),
    createdAt: IsoTimestampSchema,
  })
  .strict()
  .refine(
    (recommendation) =>
      recommendation.escalationRequired ===
      (recommendation.escalationReasons.length > 0),
    {
      message:
        "escalationRequired must match whether escalationReasons is non-empty.",
      path: ["escalationRequired"],
    },
  );

export const RecommendationSchema = TriageRecommendationSchema;

export const ApprovedFieldSchema = z.enum([
  "category",
  "priority",
  "team",
  "assignee",
  "status",
  "tags",
  "customerResponse",
]);

const ApprovedFieldsSchema = z
  .array(ApprovedFieldSchema)
  .min(1)
  .refine((fields) => new Set(fields).size === fields.length, {
    message: "Approved fields must be unique.",
  });

const ApprovalFieldOverridesSchema = z
  .object({
    category: CategorySchema.optional(),
    priority: PrioritySchema.optional(),
    team: TeamSchema.optional(),
    assignee: NonBlankStringSchema.nullable().optional(),
    status: TicketStatusSchema.optional(),
    tags: UniqueNonBlankStringsSchema.optional(),
  })
  .strict();

export const ApprovalSchema = z
  .object({
    recommendationId: z.uuid(),
    ticketId: TicketIdSchema,
    expectedRevision: z.number().int().nonnegative(),
    approvedFields: ApprovedFieldsSchema,
    fieldOverrides: ApprovalFieldOverridesSchema.optional(),
    editedCustomerResponse: NonBlankStringSchema.optional(),
    actor: NonBlankStringSchema,
    confirm: z.literal(true),
    approvedAt: IsoTimestampSchema,
  })
  .strict()
  .refine(
    (approval) =>
      approval.editedCustomerResponse === undefined ||
      approval.approvedFields.includes("customerResponse"),
    {
      message:
        "editedCustomerResponse requires customerResponse to be approved.",
      path: ["editedCustomerResponse"],
    },
  )
  .refine(
    (approval) =>
      !approval.approvedFields.includes("customerResponse") ||
      approval.editedCustomerResponse !== undefined,
    {
      message:
        "editedCustomerResponse is required when customerResponse is approved.",
      path: ["editedCustomerResponse"],
    },
  )
  .refine(
    (approval) =>
      approval.fieldOverrides === undefined ||
      Object.keys(approval.fieldOverrides).every((field) =>
        approval.approvedFields.includes(field as ApprovedField),
      ),
    {
      message: "Field overrides require the matching field to be approved.",
      path: ["fieldOverrides"],
    },
  );

export const AuditActionSchema = z.enum([
  "recommendation-submitted",
  "recommendation-approved",
  "recommendation-rejected",
  "recommendation-canceled",
  "ticket-updated",
  "approval-rejected",
]);

export const AuditEventSchema = z
  .object({
    id: z.uuid(),
    timestamp: IsoTimestampSchema,
    actor: NonBlankStringSchema,
    action: AuditActionSchema,
    ticketId: TicketIdSchema,
    recommendationId: z.uuid().optional(),
    before: z.record(z.string(), z.unknown()),
    after: z.record(z.string(), z.unknown()),
    rationale: NonBlankStringSchema,
    knowledgeArticleIds: z.array(SlugSchema),
    result: z.enum(["success", "rejected"]),
    rejectionReason: NonBlankStringSchema.optional(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.result === "rejected" && event.rejectionReason === undefined) {
      context.addIssue({
        code: "custom",
        message: "Rejected audit events require a rejectionReason.",
        path: ["rejectionReason"],
      });
    }

    if (event.result === "success" && event.rejectionReason !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Successful audit events must not include rejectionReason.",
        path: ["rejectionReason"],
      });
    }

    const expectedResult =
      event.action === "approval-rejected" ? "rejected" : "success";
    if (event.result !== expectedResult) {
      context.addIssue({
        code: "custom",
        message: "Audit action and result are inconsistent.",
        path: ["result"],
      });
    }
  });

export const ExpectedOutcomeSchema = z
  .object({
    ticketId: TicketIdSchema,
    category: CategorySchema,
    acceptablePriorities: z.array(PrioritySchema).min(1),
    team: TeamSchema,
    requiredEscalations: z.array(RequiredEscalationSchema),
    knowledgeArticleIds: z.array(SlugSchema),
    duplicateGroup: NonBlankStringSchema.optional(),
  })
  .strict();

export type IsoTimestamp = z.infer<typeof IsoTimestampSchema>;
export type TicketId = z.infer<typeof TicketIdSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type Team = z.infer<typeof TeamSchema>;
export type TicketStatus = z.infer<typeof TicketStatusSchema>;
export type Risk = z.infer<typeof RiskSchema>;
export type DraftCustomerResponseSource = z.infer<
  typeof DraftCustomerResponseSourceSchema
>;
export type DraftCustomerResponseStyle = z.infer<
  typeof DraftCustomerResponseStyleSchema
>;
export type DraftCustomerResponseStyleInput = z.infer<
  typeof DraftCustomerResponseStyleInputSchema
>;
export type DraftCustomerResponseCheck = z.infer<
  typeof DraftCustomerResponseCheckSchema
>;
export type GptAssistAudience = z.infer<typeof GptAssistAudienceSchema>;
export type GptAssist = z.infer<typeof GptAssistSchema>;
export type Customer = z.infer<typeof CustomerSchema>;
export type RequesterTechnicalLevel = z.infer<
  typeof RequesterTechnicalLevelSchema
>;
export type RequesterSeniority = z.infer<typeof RequesterSenioritySchema>;
export type Requester = z.infer<typeof RequesterSchema>;
export type SLA = z.infer<typeof SLASchema>;
export type Ticket = z.infer<typeof TicketSchema>;
export type KnowledgeArticle = z.infer<typeof KnowledgeArticleSchema>;
export type DuplicateCandidate = z.infer<typeof DuplicateCandidateSchema>;
export type TriageRecommendation = z.infer<typeof TriageRecommendationSchema>;
export type Recommendation = TriageRecommendation;
export type ApprovedField = z.infer<typeof ApprovedFieldSchema>;
export type Approval = z.infer<typeof ApprovalSchema>;
export type AuditAction = z.infer<typeof AuditActionSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type RequiredEscalation = z.infer<typeof RequiredEscalationSchema>;
export type SupportState = z.infer<typeof SupportStateSchema>;
export type EvidenceRequirement = z.infer<typeof EvidenceRequirementSchema>;
export type ExpectedOutcome = z.infer<typeof ExpectedOutcomeSchema>;
