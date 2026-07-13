import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ApprovalSchema,
  AuditEventSchema,
  CategorySchema,
  DraftCustomerResponseCheckSchema,
  DraftCustomerResponseSourceSchema,
  DraftCustomerResponseStyleSchema,
  DuplicateCandidateSchema,
  EvidenceRequirementSchema,
  GptAssistSchema,
  IsoTimestampSchema,
  PrioritySchema,
  RequiredEscalationSchema,
  RiskSchema,
  SupportStateSchema,
  TeamSchema,
  TicketIdSchema,
  TicketStatusSchema,
  TriageRecommendationSchema,
  type Approval,
  type ApprovedField,
  type AuditEvent,
  type Category,
  type DuplicateCandidate,
  type EvidenceRequirement,
  type GptAssist,
  type Priority,
  type RequiredEscalation,
  type Risk,
  type SupportState,
  type Team,
  type Ticket,
  type TicketId,
  type TicketStatus,
  type TriageRecommendation,
} from "./domain.js";
import { DomainError } from "./errors.js";
import { evaluateEscalation, validateApprovedFields } from "./policy.js";

const NonBlankStringSchema = z.string().trim().min(1);
const recommendationOperations = new Map<string, Promise<void>>();

const SubmitRecommendationInputSchema = z
  .object({
    ticketId: TicketIdSchema,
    sourceRevision: z.number().int().nonnegative(),
    category: CategorySchema,
    priority: PrioritySchema,
    team: TeamSchema,
    assignee: NonBlankStringSchema.nullable().optional(),
    ticketStatus: TicketStatusSchema.optional(),
    tags: z.array(NonBlankStringSchema).optional(),
    duplicateCandidates: z.array(DuplicateCandidateSchema),
    outageRisk: RiskSchema,
    securityRisk: RiskSchema,
    slaRisk: RiskSchema,
    missingInformation: z.array(NonBlankStringSchema),
    supportState: SupportStateSchema.optional(),
    knownCause: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable().optional(),
    requiredEvidence: z.array(EvidenceRequirementSchema).optional(),
    providedEvidence: z.array(EvidenceRequirementSchema).optional(),
    missingEvidence: z.array(EvidenceRequirementSchema).optional(),
    nextInvestigationSteps: z.array(NonBlankStringSchema).optional(),
    knowledgeArticleIds: z.array(
      z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    ),
    draftCustomerResponse: NonBlankStringSchema,
    draftCustomerResponseSource: DraftCustomerResponseSourceSchema.optional(),
    draftCustomerResponseStyle: DraftCustomerResponseStyleSchema.optional(),
    draftCustomerResponseChecks: z
      .array(DraftCustomerResponseCheckSchema)
      .optional(),
    gptAssist: GptAssistSchema.optional(),
    rationale: NonBlankStringSchema.max(500),
    confidence: z.number().min(0).max(1),
    recommendedNextAction: NonBlankStringSchema,
    escalationRequired: z.boolean().optional(),
    escalationReasons: z.array(RequiredEscalationSchema).optional(),
    actor: NonBlankStringSchema,
    submittedAt: IsoTimestampSchema,
  })
  .strict();

const RejectRecommendationInputSchema = z
  .object({
    recommendationId: z.uuid(),
    ticketId: TicketIdSchema,
    actor: NonBlankStringSchema,
    feedback: NonBlankStringSchema,
    rejectedAt: IsoTimestampSchema,
  })
  .strict();

const CancelApprovalInputSchema = z
  .object({
    recommendationId: z.uuid(),
    ticketId: TicketIdSchema,
    actor: NonBlankStringSchema,
    reason: NonBlankStringSchema,
    canceledAt: IsoTimestampSchema,
  })
  .strict();

export interface SubmitRecommendationInput {
  ticketId: TicketId;
  sourceRevision: number;
  category: Category;
  priority: Priority;
  team: Team;
  assignee?: string | null;
  ticketStatus?: TicketStatus;
  tags?: string[];
  duplicateCandidates: DuplicateCandidate[];
  outageRisk: Risk;
  securityRisk: Risk;
  slaRisk: Risk;
  missingInformation: string[];
  supportState?: SupportState;
  knownCause?: string | null;
  requiredEvidence?: EvidenceRequirement[];
  providedEvidence?: EvidenceRequirement[];
  missingEvidence?: EvidenceRequirement[];
  nextInvestigationSteps?: string[];
  knowledgeArticleIds: string[];
  draftCustomerResponse: string;
  draftCustomerResponseSource?: z.infer<
    typeof DraftCustomerResponseSourceSchema
  >;
  draftCustomerResponseStyle?: z.infer<
    typeof DraftCustomerResponseStyleSchema
  >;
  draftCustomerResponseChecks?: z.infer<
    typeof DraftCustomerResponseCheckSchema
  >[];
  gptAssist?: GptAssist;
  rationale: string;
  confidence: number;
  recommendedNextAction: string;
  escalationRequired?: boolean;
  escalationReasons?: RequiredEscalation[];
  actor: string;
  submittedAt: string;
}

export interface RejectRecommendationInput {
  recommendationId: string;
  ticketId: TicketId;
  actor: string;
  feedback: string;
  rejectedAt: string;
}

export interface CancelApprovalInput {
  recommendationId: string;
  ticketId: TicketId;
  actor: string;
  reason: string;
  canceledAt: string;
}

export interface TicketStore {
  get(id: TicketId): Promise<Ticket>;
  update(
    id: TicketId,
    expectedRevision: number,
    mutate: (ticket: Ticket) => Ticket,
  ): Promise<Ticket>;
  updateWithCommit<T>(
    id: TicketId,
    expectedRevision: number,
    mutate: (ticket: Ticket) => Ticket,
    commit: (updated: Ticket, previous: Ticket) => Promise<T>,
  ): Promise<{ ticket: Ticket; result: T }>;
}

export interface RecommendationStore {
  create(value: TriageRecommendation): Promise<void>;
  get(id: string): Promise<TriageRecommendation>;
  deletePending(id: string): Promise<void>;
  transitionResolution(
    id: string,
    expected: TriageRecommendation["resolution"],
    next: TriageRecommendation["resolution"],
  ): Promise<void>;
  markResolved(
    id: string,
    resolution: "approved" | "rejected",
  ): Promise<void>;
}

export interface AuditStore {
  append(event: AuditEvent): Promise<void>;
}

export interface TriageServiceDependencies {
  tickets: TicketStore;
  recommendations: RecommendationStore;
  audit: AuditStore;
  now?: () => Date;
  uuid?: () => string;
}

export class TriageService {
  private readonly now: () => Date;
  private readonly uuid: () => string;

  constructor(private readonly dependencies: TriageServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.uuid = dependencies.uuid ?? randomUUID;
  }

  async submit(
    input: SubmitRecommendationInput,
  ): Promise<TriageRecommendation> {
    const parsed = SubmitRecommendationInputSchema.parse(input);
    const ticket = await this.dependencies.tickets.get(parsed.ticketId);
    if (ticket.revision !== parsed.sourceRevision) {
      throw stale("Recommendation source revision is stale.");
    }

    const unevaluated = TriageRecommendationSchema.parse({
      id: this.uuid(),
      ticketId: parsed.ticketId,
      sourceRevision: parsed.sourceRevision,
      category: parsed.category,
      priority: parsed.priority,
      team: parsed.team,
      ...(parsed.assignee === undefined ? {} : { assignee: parsed.assignee }),
      ...(parsed.ticketStatus === undefined
        ? {}
        : { ticketStatus: parsed.ticketStatus }),
      ...(parsed.tags === undefined ? {} : { tags: parsed.tags }),
      duplicateCandidates: parsed.duplicateCandidates,
      outageRisk: parsed.outageRisk,
      securityRisk: parsed.securityRisk,
      slaRisk: parsed.slaRisk,
      missingInformation: parsed.missingInformation,
      ...(parsed.supportState === undefined
        ? {}
        : { supportState: parsed.supportState }),
      ...(parsed.knownCause === undefined
        ? {}
        : { knownCause: parsed.knownCause }),
      ...(parsed.requiredEvidence === undefined
        ? {}
        : { requiredEvidence: parsed.requiredEvidence }),
      ...(parsed.providedEvidence === undefined
        ? {}
        : { providedEvidence: parsed.providedEvidence }),
      ...(parsed.missingEvidence === undefined
        ? {}
        : { missingEvidence: parsed.missingEvidence }),
      ...(parsed.nextInvestigationSteps === undefined
        ? {}
        : { nextInvestigationSteps: parsed.nextInvestigationSteps }),
      knowledgeArticleIds: parsed.knowledgeArticleIds,
      draftCustomerResponse: parsed.draftCustomerResponse,
      ...(parsed.draftCustomerResponseSource === undefined
        ? {}
        : { draftCustomerResponseSource: parsed.draftCustomerResponseSource }),
      ...(parsed.draftCustomerResponseStyle === undefined
        ? {}
        : { draftCustomerResponseStyle: parsed.draftCustomerResponseStyle }),
      ...(parsed.draftCustomerResponseChecks === undefined
        ? {}
        : { draftCustomerResponseChecks: parsed.draftCustomerResponseChecks }),
      ...(parsed.gptAssist === undefined ? {} : { gptAssist: parsed.gptAssist }),
      rationale: parsed.rationale,
      confidence: parsed.confidence,
      recommendedNextAction: parsed.recommendedNextAction,
      escalationRequired: false,
      escalationReasons: [],
      resolution: "pending",
      createdAt: parsed.submittedAt,
    });
    const decision = evaluateEscalation(unevaluated, this.now(), ticket);
    const recommendation = TriageRecommendationSchema.parse({
      ...unevaluated,
      escalationRequired: decision.required,
      escalationReasons: decision.reasons,
    });

    const auditEvent = AuditEventSchema.parse({
      id: this.uuid(),
      timestamp: parsed.submittedAt,
      actor: parsed.actor,
      action: "recommendation-submitted",
      ticketId: ticket.id,
      recommendationId: recommendation.id,
      before: {},
      after: {
        sourceRevision: recommendation.sourceRevision,
        category: recommendation.category,
        priority: recommendation.priority,
        team: recommendation.team,
        escalationRequired: recommendation.escalationRequired,
        escalationReasons: recommendation.escalationReasons,
      },
      rationale: recommendation.rationale,
      knowledgeArticleIds: recommendation.knowledgeArticleIds,
      result: "success",
    });

    await this.dependencies.recommendations.create(recommendation);
    try {
      await this.dependencies.audit.append(auditEvent);
    } catch (auditError) {
      try {
        await this.dependencies.recommendations.deletePending(recommendation.id);
      } catch {
        throw domainErrorWithCause(
          "Submission audit failed and recommendation rollback was not safe.",
          auditError,
        );
      }
      throw domainErrorWithCause(
        "Submission audit failed; recommendation was compensated.",
        auditError,
      );
    }
    return recommendation;
  }

  async approve(
    input: Approval,
  ): Promise<{ ticket: Ticket; auditEvent: AuditEvent }> {
    const approval = ApprovalSchema.parse(input);
    return serializeRecommendation(approval.recommendationId, () =>
      this.approveValidated(approval),
    );
  }

  async reject(input: RejectRecommendationInput): Promise<AuditEvent> {
    const rejection = RejectRecommendationInputSchema.parse(input);
    return serializeRecommendation(rejection.recommendationId, () =>
      this.rejectValidated(rejection),
    );
  }

  async cancelApproval(input: CancelApprovalInput): Promise<AuditEvent> {
    const cancellation = CancelApprovalInputSchema.parse(input);
    return serializeRecommendation(cancellation.recommendationId, () =>
      this.cancelApprovalValidated(cancellation),
    );
  }

  private async approveValidated(
    approval: Approval,
  ): Promise<{ ticket: Ticket; auditEvent: AuditEvent }> {
    const recommendation = await this.dependencies.recommendations.get(
      approval.recommendationId,
    );
    if (
      recommendation.resolution !== "pending" ||
      recommendation.ticketId !== approval.ticketId
    ) {
      const error = stale("Recommendation cannot be applied.");
      await this.appendApprovalRejectedAudit(approval, recommendation, error);
      throw error;
    }

    const ticketBefore = await this.dependencies.tickets.get(
      recommendation.ticketId,
    );
    if (
      ticketBefore.revision !== approval.expectedRevision ||
      recommendation.sourceRevision !== approval.expectedRevision
    ) {
      const error = stale("Approval revision is stale.");
      await this.appendApprovalRejectedAudit(approval, recommendation, error);
      throw error;
    }

    validateApprovedFields(recommendation, approval.approvedFields);
    const decision = evaluateEscalation(
      recommendation,
      this.now(),
      ticketBefore,
    );
    const resultingTeam = approval.approvedFields.includes("team")
      ? approvedFieldValue(recommendation, approval, "team")
      : ticketBefore.team;
    if (
      decision.requiredTeam !== undefined &&
      resultingTeam !== decision.requiredTeam
    ) {
      throw new DomainError(
        `Resulting ticket must route to ${decision.requiredTeam}.`,
        "INVALID_APPROVAL_FIELDS",
      );
    }

    const { before, after } = approvedValues(
      ticketBefore,
      recommendation,
      approval,
    );
    const auditEvent = AuditEventSchema.parse({
      id: this.uuid(),
      timestamp: approval.approvedAt,
      actor: approval.actor,
      action: "recommendation-approved",
      ticketId: ticketBefore.id,
      recommendationId: recommendation.id,
      before,
      after,
      rationale: recommendation.rationale,
      knowledgeArticleIds: recommendation.knowledgeArticleIds,
      result: "success",
    });

    const { ticket: updated, result: committedAuditEvent } =
      await this.dependencies.tickets.updateWithCommit(
        ticketBefore.id,
        approval.expectedRevision,
        (ticket) =>
          applyApprovedFields(
            ticket,
            recommendation,
            approval,
            approval.approvedAt,
          ),
        async () => {
          await this.dependencies.recommendations.transitionResolution(
            recommendation.id,
            "pending",
            "approved",
          );
          try {
            await this.dependencies.audit.append(auditEvent);
          } catch (auditError) {
            try {
              await this.dependencies.recommendations.transitionResolution(
                recommendation.id,
                "approved",
                "pending",
              );
            } catch {
              throw domainErrorWithCause(
                "Approval audit failed and recommendation rollback was not safe.",
                auditError,
              );
            }
            throw domainErrorWithCause(
              "Approval audit failed; recommendation was compensated.",
              auditError,
            );
          }
          return auditEvent;
        },
      );

    return { ticket: updated, auditEvent: committedAuditEvent };
  }

  private async appendApprovalRejectedAudit(
    approval: Approval,
    recommendation: TriageRecommendation,
    error: DomainError,
  ): Promise<void> {
    try {
      await this.dependencies.audit.append(
        AuditEventSchema.parse({
          id: this.uuid(),
          timestamp: approval.approvedAt,
          actor: approval.actor,
          action: "approval-rejected",
          ticketId: recommendation.ticketId,
          recommendationId: recommendation.id,
          before: {
            expectedRevision: approval.expectedRevision,
            sourceRevision: recommendation.sourceRevision,
            resolution: recommendation.resolution,
          },
          after: {},
          rationale: error.message,
          knowledgeArticleIds: recommendation.knowledgeArticleIds,
          result: "rejected",
          rejectionReason: error.message,
        }),
      );
    } catch {
      // Rejected approval telemetry is best-effort; keep the original stale error.
    }
  }

  private async rejectValidated(
    rejection: RejectRecommendationInput,
  ): Promise<AuditEvent> {
    const recommendation = await this.dependencies.recommendations.get(
      rejection.recommendationId,
    );
    if (
      recommendation.resolution !== "pending" ||
      recommendation.ticketId !== rejection.ticketId
    ) {
      throw stale("Recommendation cannot be rejected.");
    }
    await this.dependencies.tickets.get(rejection.ticketId);

    const auditEvent = AuditEventSchema.parse({
      id: this.uuid(),
      timestamp: rejection.rejectedAt,
      actor: rejection.actor,
      action: "recommendation-rejected",
      ticketId: rejection.ticketId,
      recommendationId: recommendation.id,
      before: { resolution: "pending" },
      after: { resolution: "rejected" },
      rationale: rejection.feedback,
      knowledgeArticleIds: recommendation.knowledgeArticleIds,
      result: "success",
    });

    await this.dependencies.recommendations.transitionResolution(
      recommendation.id,
      "pending",
      "rejected",
    );
    try {
      await this.dependencies.audit.append(auditEvent);
    } catch (auditError) {
      try {
        await this.dependencies.recommendations.transitionResolution(
          recommendation.id,
          "rejected",
          "pending",
        );
      } catch {
        throw domainErrorWithCause(
          "Rejection audit failed and recommendation rollback was not safe.",
          auditError,
        );
      }
      throw domainErrorWithCause(
        "Rejection audit failed; recommendation was compensated.",
        auditError,
      );
    }
    return auditEvent;
  }

  private async cancelApprovalValidated(
    cancellation: CancelApprovalInput,
  ): Promise<AuditEvent> {
    const recommendation = await this.dependencies.recommendations.get(
      cancellation.recommendationId,
    );
    if (
      recommendation.resolution !== "approved" ||
      recommendation.ticketId !== cancellation.ticketId
    ) {
      throw stale("Approved recommendation cannot be canceled.");
    }
    await this.dependencies.tickets.get(cancellation.ticketId);

    const auditEvent = AuditEventSchema.parse({
      id: this.uuid(),
      timestamp: cancellation.canceledAt,
      actor: cancellation.actor,
      action: "recommendation-canceled",
      ticketId: cancellation.ticketId,
      recommendationId: recommendation.id,
      before: { resolution: "approved" },
      after: { resolution: "canceled" },
      rationale: cancellation.reason,
      knowledgeArticleIds: recommendation.knowledgeArticleIds,
      result: "success",
    });

    await this.dependencies.recommendations.transitionResolution(
      recommendation.id,
      "approved",
      "canceled",
    );
    try {
      await this.dependencies.audit.append(auditEvent);
    } catch (auditError) {
      try {
        await this.dependencies.recommendations.transitionResolution(
          recommendation.id,
          "canceled",
          "approved",
        );
      } catch {
        throw domainErrorWithCause(
          "Cancellation audit failed and recommendation rollback was not safe.",
          auditError,
        );
      }
      throw domainErrorWithCause(
        "Cancellation audit failed; recommendation was compensated.",
        auditError,
      );
    }
    return auditEvent;
  }
}

async function serializeRecommendation<T>(
  recommendationId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous =
    recommendationOperations.get(recommendationId) ?? Promise.resolve();
  let release = (): void => undefined;
  const current = new Promise<void>((resolveOperation) => {
    release = resolveOperation;
  });
  recommendationOperations.set(recommendationId, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (recommendationOperations.get(recommendationId) === current) {
      recommendationOperations.delete(recommendationId);
    }
  }
}

function stale(message: string): DomainError {
  return new DomainError(message, "STALE_APPROVAL");
}

function domainErrorWithCause(message: string, cause: unknown): DomainError {
  const error = new DomainError(message, "REPOSITORY_ERROR");
  Object.defineProperty(error, "cause", {
    value: cause,
    configurable: true,
  });
  return error;
}

function approvedValues(
  ticket: Ticket,
  recommendation: TriageRecommendation,
  approval: Approval,
): {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
} {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  for (const field of approval.approvedFields) {
    before[field] =
      field === "customerResponse" ? null : ticketValue(ticket, field);
    after[field] = approvedFieldValue(recommendation, approval, field);
  }
  return { before, after };
}

function ticketValue(ticket: Ticket, field: ApprovedField): unknown {
  switch (field) {
    case "category":
    case "priority":
    case "team":
    case "assignee":
    case "tags":
      return ticket[field];
    case "status":
      return ticket.status;
    case "customerResponse":
      return null;
  }
}

function recommendationValue(
  recommendation: TriageRecommendation,
  field: ApprovedField,
): unknown {
  switch (field) {
    case "category":
    case "priority":
    case "team":
    case "assignee":
    case "tags":
      return recommendation[field];
    case "status":
      return recommendation.ticketStatus;
    case "customerResponse":
      return recommendation.draftCustomerResponse;
  }
}

function approvedFieldValue(
  recommendation: TriageRecommendation,
  approval: Approval,
  field: ApprovedField,
): unknown {
  if (field === "customerResponse") {
    return approval.editedCustomerResponse ?? recommendation.draftCustomerResponse;
  }

  if (
    approval.fieldOverrides !== undefined &&
    Object.hasOwn(approval.fieldOverrides, field)
  ) {
    return approval.fieldOverrides[field as keyof typeof approval.fieldOverrides];
  }

  return recommendationValue(recommendation, field);
}

function applyApprovedFields(
  ticket: Ticket,
  recommendation: TriageRecommendation,
  approval: Approval,
  updatedAt: string,
): Ticket {
  const updated = structuredClone(ticket);
  for (const field of approval.approvedFields) {
    switch (field) {
      case "category":
        updated.category = approvedFieldValue(
          recommendation,
          approval,
          field,
        ) as Ticket["category"];
        break;
      case "priority":
        updated.priority = approvedFieldValue(
          recommendation,
          approval,
          field,
        ) as Ticket["priority"];
        break;
      case "team":
        updated.team = approvedFieldValue(
          recommendation,
          approval,
          field,
        ) as Ticket["team"];
        break;
      case "assignee":
        const assignee = approvedFieldValue(
          recommendation,
          approval,
          field,
        ) as Ticket["assignee"] | null;
        if (assignee === null) {
          delete updated.assignee;
        } else {
          updated.assignee = assignee;
        }
        break;
      case "status":
        updated.status = approvedFieldValue(
          recommendation,
          approval,
          field,
        ) as Ticket["status"];
        break;
      case "tags":
        updated.tags = [
          ...(approvedFieldValue(
            recommendation,
            approval,
            field,
          ) as Ticket["tags"]),
        ];
        break;
      case "customerResponse":
        break;
    }
  }
  updated.updatedAt = updatedAt;
  return updated;
}
