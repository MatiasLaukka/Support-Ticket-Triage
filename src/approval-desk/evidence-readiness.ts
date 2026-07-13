import type {
  EvidenceRequirement,
  ExpectedOutcome,
  SupportState,
  Ticket,
} from "../domain.js";
import { detectKnownCause, getKnownCause } from "./known-cause-catalog.js";

type EvidenceSource = EvidenceRequirement["source"];

export interface EvidenceReadiness {
  supportState: SupportState;
  knownCause?: string | null;
  requiredEvidence: EvidenceRequirement[];
  providedEvidence: EvidenceRequirement[];
  missingEvidence: EvidenceRequirement[];
  nextInvestigationSteps: string[];
}

const EVIDENCE_CATALOG: Readonly<Record<string, Omit<EvidenceRequirement, "source">>> = {
  "affected-recipient-domains": {
    id: "affected-recipient-domains",
    label: "Affected recipient domains",
    customerQuestion: "Affected recipient domains",
    aliases: ["recipient domains", "affected domains"],
  },
  "audience-size": {
    id: "audience-size",
    label: "Expected audience size",
    customerQuestion: "Expected audience size",
    aliases: ["audience size", "expected recipients"],
  },
  "bounce-samples": {
    id: "bounce-samples",
    label: "Bounce samples",
    customerQuestion: "Bounce samples or bounce codes",
    aliases: ["bounce sample", "bounce code", "bounce reason"],
  },
  "campaign-name": {
    id: "campaign-name",
    label: "Campaign or flow name",
    customerQuestion: "Campaign or flow name",
    aliases: ["campaign name", "flow name"],
  },
  "catalog-sync-time": {
    id: "catalog-sync-time",
    label: "Last catalog sync time",
    customerQuestion: "Last catalog sync time",
    aliases: ["last catalog sync", "catalog sync time"],
  },
  "compliance-banner": {
    id: "compliance-banner",
    label: "Compliance banner",
    customerQuestion: "Compliance banner shown in the dashboard",
    aliases: ["compliance banner", "dashboard banner"],
  },
  "coupon-pool-name": {
    id: "coupon-pool-name",
    label: "Coupon pool name",
    customerQuestion: "Coupon pool name",
    aliases: ["coupon pool", "coupon set"],
  },
  "delivery-id": {
    id: "delivery-id",
    label: "Delivery ID",
    customerQuestion: "delivery ID",
    aliases: ["delivery id", "webhook delivery"],
  },
  "endpoint-response-code": {
    id: "endpoint-response-code",
    label: "Endpoint response code",
    customerQuestion: "endpoint response code",
    aliases: ["response code", "http status"],
  },
  "endpoint-url": {
    id: "endpoint-url",
    label: "Endpoint URL",
    customerQuestion: "endpoint URL",
    aliases: ["endpoint url", "webhook url"],
  },
  "error-banner": {
    id: "error-banner",
    label: "Error banner",
    customerQuestion: "Any error banner shown in the dashboard",
    aliases: ["error banner", "error message"],
  },
  "event-id": {
    id: "event-id",
    label: "Event ID or event time",
    customerQuestion: "event ID or event time",
    aliases: ["event id", "event time", "event timestamp"],
  },
  "failure-timestamp": {
    id: "failure-timestamp",
    label: "Failure timestamp",
    customerQuestion: "failure timestamp with time zone",
    aliases: ["failure timestamp", "failure time"],
  },
  "flow-id": {
    id: "flow-id",
    label: "Flow name or flow ID",
    customerQuestion: "flow name or flow ID",
    aliases: ["flow id", "flow name"],
  },
  "object-id": {
    id: "object-id",
    label: "Affected object ID",
    customerQuestion: "Affected object ID, SKU, order number, or profile ID",
    aliases: ["object id", "sku", "order number", "profile id"],
  },
  "platform": {
    id: "platform",
    label: "Ecommerce platform",
    customerQuestion:
      "ecommerce platform, such as Shopify, Magento, WooCommerce, or custom",
    aliases: ["ecommerce platform", "shopify", "magento", "woocommerce"],
  },
  "profile-email": {
    id: "profile-email",
    label: "Affected profile email or customer ID",
    customerQuestion: "One affected profile email or customer ID",
    aliases: ["profile email", "customer id", "affected customer"],
  },
  "product-reference": {
    id: "product-reference",
    label: "Product or cart reference",
    customerQuestion:
      "product URL or product ID, or product or cart URL if this is a cart flow",
    aliases: ["product url", "product id", "cart url"],
  },
  "raw-body-change-status": {
    id: "raw-body-change-status",
    label: "Raw body handling changes",
    customerQuestion: "whether raw body handling changed recently",
    aliases: ["raw body", "body parser"],
  },
  "recipient-region": {
    id: "recipient-region",
    label: "Recipient region",
    customerQuestion: "Recipient region",
    aliases: ["recipient region", "country", "region"],
  },
  "request-id": {
    id: "request-id",
    label: "Request ID",
    customerQuestion: "request ID if available",
    aliases: ["request id", "api request"],
  },
  "sample-payload": {
    id: "sample-payload",
    label: "Sample payload",
    customerQuestion: "Sample payload with secrets removed",
    aliases: ["sample payload", "payload"],
  },
  "scheduled-send-time": {
    id: "scheduled-send-time",
    label: "Scheduled send time",
    customerQuestion: "Scheduled send time with time zone",
    aliases: ["scheduled send time", "send time"],
  },
  "segment-name": {
    id: "segment-name",
    label: "Segment name",
    customerQuestion: "Segment name",
    aliases: ["segment name", "audience name"],
  },
  "sending-domain": {
    id: "sending-domain",
    label: "Sending domain",
    customerQuestion: "Sending domain",
    aliases: ["sending domain", "domain"],
  },
  "signing-secret-rotation-time": {
    id: "signing-secret-rotation-time",
    label: "Signing secret rotation time",
    customerQuestion:
      "signing secret rotation time, without sharing the secret value",
    aliases: ["secret rotation", "signing secret rotation"],
  },
  "store-url": {
    id: "store-url",
    label: "Store URL",
    customerQuestion: "Affected store URL",
    aliases: ["store url", "site url", "store domain"],
  },
  "timestamp-tolerance": {
    id: "timestamp-tolerance",
    label: "Timestamp tolerance",
    customerQuestion: "timestamp tolerance configured for verification",
    aliases: ["timestamp tolerance", "clock skew"],
  },
  "unused-coupon-status": {
    id: "unused-coupon-status",
    label: "Unused coupon code availability",
    customerQuestion: "Whether unused coupon codes remain available",
    aliases: ["unused coupon", "available codes"],
  },
};

const KNOWLEDGE_EVIDENCE: Readonly<Record<string, readonly string[]>> = {
  "campaign-send-failures": [
    "campaign-name",
    "scheduled-send-time",
    "audience-size",
    "error-banner",
  ],
  "coupon-catalog-sync": [
    "store-url",
    "product-reference",
    "coupon-pool-name",
    "catalog-sync-time",
    "unused-coupon-status",
  ],
  "email-deliverability": [
    "campaign-name",
    "scheduled-send-time",
    "sending-domain",
    "affected-recipient-domains",
    "bounce-samples",
  ],
  "event-tracking-debugging": [
    "platform",
    "profile-email",
    "event-id",
    "request-id",
    "sample-payload",
  ],
  "flow-trigger-troubleshooting": [
    "platform",
    "flow-id",
    "profile-email",
    "event-id",
    "product-reference",
  ],
  "profile-sync-issues": [
    "profile-email",
    "object-id",
    "request-id",
    "catalog-sync-time",
  ],
  "segmentation-audience-rules": [
    "segment-name",
    "audience-size",
    "profile-email",
  ],
  "shopify-integration-sync": [
    "store-url",
    "platform",
    "object-id",
    "catalog-sync-time",
  ],
  "sms-compliance": [
    "campaign-name",
    "scheduled-send-time",
    "recipient-region",
    "compliance-banner",
  ],
  "webhook-signature-validation": [
    "delivery-id",
    "endpoint-url",
    "failure-timestamp",
    "signing-secret-rotation-time",
    "timestamp-tolerance",
    "endpoint-response-code",
    "raw-body-change-status",
  ],
};

export function analyzeEvidenceReadiness(input: {
  ticket: Ticket;
  outcome: ExpectedOutcome;
}): EvidenceReadiness {
  const knownCauseDefinition = detectKnownCause(input);
  const knownCause = knownCauseDefinition?.id ?? null;
  const requiredEvidence =
    knownCauseDefinition !== undefined
      ? evidenceForKnownCause(knownCauseDefinition.requiredEvidenceIds)
      : evidenceForKnowledge(
          relevantKnowledgeArticleIds(input.ticket, input.outcome),
          "knowledge",
        );
  const providedEvidence = requiredEvidence.filter((requirement) =>
    isEvidenceProvided(requirement, input.ticket),
  );
  const providedIds = new Set(providedEvidence.map((requirement) => requirement.id));
  const missingEvidence = requiredEvidence.filter(
    (requirement) => !providedIds.has(requirement.id),
  );

  return {
    supportState: chooseSupportState({
      knownCause,
      missingEvidence,
      outcome: input.outcome,
    }),
    knownCause,
    requiredEvidence,
    providedEvidence,
    missingEvidence,
    nextInvestigationSteps: buildNextInvestigationSteps({
      knownCause,
      missingEvidence,
      outcome: input.outcome,
    }),
  };
}

function relevantKnowledgeArticleIds(
  ticket: Ticket,
  outcome: ExpectedOutcome,
): readonly string[] {
  if (
    outcome.knowledgeArticleIds.includes("flow-trigger-troubleshooting") &&
    outcome.knowledgeArticleIds.includes("event-tracking-debugging") &&
    classifyTicketAudience(ticket) === "merchant-admin"
  ) {
    return outcome.knowledgeArticleIds.filter(
      (articleId) => articleId !== "event-tracking-debugging",
    );
  }
  return outcome.knowledgeArticleIds;
}

function evidenceForKnowledge(
  knowledgeArticleIds: readonly string[],
  source: EvidenceSource,
): EvidenceRequirement[] {
  const ids = unique(
    knowledgeArticleIds.flatMap((articleId) => KNOWLEDGE_EVIDENCE[articleId] ?? []),
  );
  return ids.map((id) => evidenceRequirement(id, source));
}

function evidenceForKnownCause(ids: readonly string[]): EvidenceRequirement[] {
  return unique(ids).map((id) => evidenceRequirement(id, "known-cause"));
}

function evidenceRequirement(id: string, source: EvidenceSource): EvidenceRequirement {
  const base = EVIDENCE_CATALOG[id];
  if (base === undefined) {
    throw new Error(`Evidence requirement ${id} is not registered.`);
  }
  return { ...base, source };
}

function chooseSupportState(input: {
  knownCause: string | null;
  missingEvidence: readonly EvidenceRequirement[];
  outcome: ExpectedOutcome;
}): SupportState {
  if (input.knownCause !== null) {
    return "known-cause";
  }
  if (input.outcome.requiredEscalations.includes("outage")) {
    return "waiting-on-platform-fix";
  }
  if (input.missingEvidence.length > 0) {
    return "needs-information";
  }
  return "diagnosing";
}

function buildNextInvestigationSteps(input: {
  knownCause: string | null;
  missingEvidence: readonly EvidenceRequirement[];
  outcome: ExpectedOutcome;
}): string[] {
  const knownCause = getKnownCause(input.knownCause);
  if (knownCause !== undefined) {
    return [...knownCause.investigationSteps];
  }
  if (input.outcome.requiredEscalations.includes("outage")) {
    return [
      "Correlate affected region, event timing, ingestion delay, and profile timeline updates.",
      "Confirm whether platform processing delay explains the customer impact.",
    ];
  }
  if (input.outcome.knowledgeArticleIds.includes("flow-trigger-troubleshooting")) {
    return [
      "Collect the missing evidence before recommending a configuration change.",
      "Compare the customer example against the flow setup and profile timeline.",
    ];
  }
  if (input.missingEvidence.length > 0) {
    return [
      "Collect the missing evidence before recommending a configuration change.",
      "Compare the customer example against the relevant platform setup and activity timeline.",
    ];
  }
  return [
    "Review the provided evidence against retrieved knowledge before recommending the next update.",
  ];
}

function isEvidenceProvided(
  requirement: EvidenceRequirement,
  ticket: Ticket,
): boolean {
  const text = ticketText(ticket);
  switch (requirement.id) {
    case "platform":
      return /\b(shopify|magento|woocommerce|custom store|custom setup)\b/i.test(
        text,
      );
    case "store-url":
    case "endpoint-url":
    case "product-reference":
      return /\bhttps?:\/\/\S+|\b[a-z0-9-]+\.(com|net|org|io|co|fi|store)\b/i.test(
        text,
      );
    case "profile-email":
      return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text);
    case "event-id":
      return /\bevent (id|time|timestamp)\b|\bevt[-_a-z0-9]+\b/i.test(text);
    case "request-id":
      return /\b(request id|req[-_][a-z0-9]+)\b/i.test(text);
    case "delivery-id":
      return /\b(delivery id|deliv[-_][a-z0-9]+)\b/i.test(text);
    case "failure-timestamp":
      return /\b(failure timestamp|failure time|failed at|fails at)\b/i.test(
        text,
      );
    case "scheduled-send-time":
    case "catalog-sync-time":
      return /\b\d{1,2}:\d{2}\b|\b\d{4}-\d{2}-\d{2}\b|\b(am|pm|utc|gmt|eet|est|pst)\b/i.test(
        text,
      );
    default:
      return requirement.aliases.some((alias) =>
        text.includes(alias.toLowerCase()),
      );
  }
}

function classifyTicketAudience(ticket: Ticket): "merchant-admin" | "developer" {
  return /\b(api|payload|webhook|endpoint|request id|logs|hmac|signature)\b/i.test(
    ticketText(ticket),
  )
    ? "developer"
    : "merchant-admin";
}

function ticketText(ticket: Ticket): string {
  return [
    ticket.subject,
    ticket.description,
    ticket.category,
    ticket.priority,
    ticket.team,
    ...ticket.tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
