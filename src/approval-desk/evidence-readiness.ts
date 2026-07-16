import type {
  EvidenceRequirement,
  ExpectedOutcome,
  SupportState,
  Ticket,
} from "../domain.js";
import { extractAccountFacts, type AccountFacts } from "./account-facts.js";
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
  "affected-scope": {
    id: "affected-scope",
    label: "Affected scope",
    customerQuestion:
      "affected scope, such as profiles, logs, accounts, or actions that may have been exposed",
    aliases: ["affected scope", "affected profiles", "profiles were accessed"],
  },
  "api-response-status": {
    id: "api-response-status",
    label: "API response status",
    customerQuestion: "API response status or validation error",
    aliases: ["api response", "response status", "validation error", "400"],
  },
  "audit-source": {
    id: "audit-source",
    label: "Audit source",
    customerQuestion: "audit source, source IP, or actor if available",
    aliases: ["audit source", "source address", "source ip", "actor"],
  },
  "bounce-samples": {
    id: "bounce-samples",
    label: "Bounce samples",
    customerQuestion: "Bounce samples or bounce codes",
    aliases: ["bounce sample", "bounce code", "bounce reason"],
  },
  "browser-session-details": {
    id: "browser-session-details",
    label: "Browser or session details",
    customerQuestion:
      "browser and whether the same issue happens after signing out and back in",
    aliases: ["browser", "session", "signed out", "signing out", "cache"],
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
  "delivery-attempt-time": {
    id: "delivery-attempt-time",
    label: "Delivery attempt time",
    customerQuestion: "webhook delivery attempt time with time zone",
    aliases: ["delivery attempt", "delivery timestamp", "delivered at"],
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
  "event-created-time": {
    id: "event-created-time",
    label: "Event creation time",
    customerQuestion: "source event creation time with time zone",
    aliases: ["event creation time", "event created", "source event time"],
  },
  "expected-field": {
    id: "expected-field",
    label: "Expected field",
    customerQuestion: "expected custom field name",
    aliases: ["expected field", "custom field", "material field"],
  },
  "exposure-location": {
    id: "exposure-location",
    label: "Exposure location",
    customerQuestion: "where the key or credential was shared",
    aliases: ["shared", "log bundle", "pasted", "exposed"],
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
  "key-identifier": {
    id: "key-identifier",
    label: "Key identifier",
    customerQuestion: "key identifier or last four characters, not the secret value",
    aliases: ["api key", "private key", "key id", "key identifier"],
  },
  "key-usage-status": {
    id: "key-usage-status",
    label: "Key usage status",
    customerQuestion: "whether the key was used after exposure",
    aliases: ["was used", "used", "actions taken"],
  },
  "masked-recipient": {
    id: "masked-recipient",
    label: "Masked recipient",
    customerQuestion: "masked recipient phone number or profile identifier",
    aliases: ["masked recipient", "recipient", "subscriber"],
  },
  "object-id": {
    id: "object-id",
    label: "Affected object ID",
    customerQuestion: "Affected object ID, SKU, order number, or profile ID",
    aliases: ["object id", "sku", "order number", "profile id"],
  },
  "problem-summary": {
    id: "problem-summary",
    label: "Problem summary",
    customerQuestion:
      "what you were trying to do, what happened, and where it happened",
    aliases: ["not working", "does not work", "problem", "expected to happen"],
  },
  "reproduction-steps": {
    id: "reproduction-steps",
    label: "Steps taken",
    customerQuestion: "steps you took, if you remember them",
    aliases: ["steps", "clicked", "opened", "selected", "tried"],
  },
  "screenshot-or-error": {
    id: "screenshot-or-error",
    label: "Screenshot or error",
    customerQuestion: "screenshot or exact message, if you can share one",
    aliases: ["screenshot", "screen recording", "error message", "error"],
  },
  "opt-out-timestamp": {
    id: "opt-out-timestamp",
    label: "Opt-out timestamp",
    customerQuestion: "STOP reply or opt-out timestamp with time zone",
    aliases: ["stop timestamp", "opt-out timestamp"],
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
  "consent-timeline": {
    id: "consent-timeline",
    label: "Consent timeline",
    customerQuestion: "profile consent timeline or opt-out history",
    aliases: ["consent timeline", "consent state", "opt-out history"],
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
  "retry-history": {
    id: "retry-history",
    label: "Retry history",
    customerQuestion: "webhook retry history",
    aliases: ["retry history", "retries", "eventually succeed"],
  },
  "rotation-status": {
    id: "rotation-status",
    label: "Rotation status",
    customerQuestion: "whether the exposed key has been rotated or revoked",
    aliases: ["rotated", "rotation", "revoked"],
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
  "source-update-time": {
    id: "source-update-time",
    label: "Source update time",
    customerQuestion: "source-system update time with time zone",
    aliases: ["source update", "last update", "updated in shopify"],
  },
  "timestamp-tolerance": {
    id: "timestamp-tolerance",
    label: "Timestamp tolerance",
    customerQuestion: "timestamp tolerance configured for verification",
    aliases: ["timestamp tolerance", "clock skew"],
  },
  "timeline-visibility": {
    id: "timeline-visibility",
    label: "Timeline visibility",
    customerQuestion:
      "whether the API accepted events are still missing from profile timelines",
    aliases: ["activity timeline", "profile timeline", "missing from timelines"],
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
  "security-incident-response": [
    "key-identifier",
    "exposure-location",
    "key-usage-status",
    "rotation-status",
    "audit-source",
    "affected-scope",
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
  const accountFacts = extractAccountFacts(input.ticket);
  const requiredEvidence =
    knownCauseDefinition !== undefined
      ? evidenceForKnownCause(knownCauseDefinition.requiredEvidenceIds)
      : evidenceForIssuePattern(input) ??
        evidenceForKnowledge(
          relevantKnowledgeArticleIds(input.ticket, input.outcome),
          "knowledge",
        );
  const providedEvidence = requiredEvidence.filter((requirement) =>
    isEvidenceProvided(requirement, input.ticket, accountFacts),
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

function evidenceForIssuePattern(input: {
  ticket: Ticket;
  outcome: ExpectedOutcome;
}): EvidenceRequirement[] | undefined {
  if (input.outcome.knowledgeArticleIds.includes("security-incident-response")) {
    return evidenceForKnowledge(["security-incident-response"], "policy");
  }
  if (
    input.outcome.category === "other" &&
    input.outcome.knowledgeArticleIds.length === 0
  ) {
    return evidenceForIds(
      ["problem-summary", "reproduction-steps", "screenshot-or-error"],
      "policy",
    );
  }
  if (
    input.outcome.category === "performance" &&
    input.outcome.team === "product" &&
    /\bcampaign editor\b.{0,80}\b(?:blank|not loading|stayed blank|empty page)|\b(?:blank|stayed blank|empty page)\b.{0,80}\bcampaign editor\b/i.test(
      ticketText(input.ticket),
    )
  ) {
    return evidenceForIds(
      [
        "campaign-name",
        "failure-timestamp",
        "browser-session-details",
        "affected-scope",
        "problem-summary",
        "reproduction-steps",
      ],
      "policy",
    );
  }
  if (
    input.outcome.requiredEscalations.includes("outage") &&
    input.outcome.knowledgeArticleIds.includes("event-tracking-debugging")
  ) {
    return evidenceForIds(
      [
      "store-url",
      "profile-email",
      "event-id",
      "request-id",
      "api-response-status",
      "timeline-visibility",
      ],
      "policy",
    );
  }
  if (
    input.outcome.knowledgeArticleIds.includes("shopify-integration-sync") &&
    input.outcome.knowledgeArticleIds.includes("coupon-catalog-sync") &&
    /\b(?:product|catalog|sku)\b/i.test(ticketText(input.ticket)) &&
    !/\b(?:coupon|promo(?:tion)? code|discount code)\b/i.test(ticketText(input.ticket))
  ) {
    return evidenceForIds(
      ["store-url", "object-id", "catalog-sync-time", "product-reference"],
      "policy",
    );
  }
  return undefined;
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
  return evidenceForIds(ids, "known-cause");
}

function evidenceForIds(
  ids: readonly string[],
  source: EvidenceSource,
): EvidenceRequirement[] {
  return unique(ids).map((id) => evidenceRequirement(id, source));
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
  accountFacts: AccountFacts,
): boolean {
  const text = ticketText(ticket);
  switch (requirement.id) {
    case "api-response-status":
    case "endpoint-response-code":
      return /\b(api response|response status|response code|http status|400|401|403|404|429|500|validation error|accepted by the api)\b/i.test(
        text,
      );
    case "platform":
      if (accountFacts.ecommercePlatform !== undefined) {
        return true;
      }
      return /\b(shopify|magento|woocommerce|custom store|custom setup)\b/i.test(
        text,
      );
    case "store-url":
    case "endpoint-url":
    case "product-reference":
      if (requirement.id === "store-url" && accountFacts.storeUrls.length > 0) {
        return true;
      }
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
    case "problem-summary":
      return hasSpecificProblemSummary(
        [ticket.subject, ticket.description].join(" "),
      );
    case "reproduction-steps":
      return /\b(?:steps?|clicked|opened|selected|submitted|tried|attempted|when i|when we|after i|after we)\b/i.test(
        text,
      );
    case "screenshot-or-error":
      return /\b(?:screenshot|screen recording|recording|error message|error code|banner says|message says)\b/i.test(
        text,
      );
    case "browser-session-details":
      return /\b(?:chrome|firefox|safari|edge|browser|incognito|cache|signed out|signing out|session)\b/i.test(
        text,
      );
    case "key-identifier":
      return hasConcreteKeyIdentifier(text);
    case "exposure-location":
      return hasExposureLocation(text);
    case "key-usage-status":
      return hasKnownKeyUsageStatus(text);
    case "rotation-status":
      return hasKnownRotationStatus(text);
    case "audit-source":
      return hasConcreteAuditSource(text);
    case "affected-scope":
      return hasKnownAffectedScope(text);
    case "failure-timestamp":
      return /\b(failure timestamp|failure time|failed at|fails at)\b/i.test(
        text,
      );
    case "scheduled-send-time":
    case "catalog-sync-time":
    case "source-update-time":
    case "event-created-time":
    case "delivery-attempt-time":
      return /\b\d{1,2}:\d{2}\b|\b\d{4}-\d{2}-\d{2}\b|\b(am|pm|utc|gmt|eet|est|pst)\b/i.test(
        text,
      );
    case "opt-out-timestamp":
      return /\b(stop|opt-out).*(\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|am|pm|utc|gmt|eet|est|pst)\b/i.test(
        text,
      );
    default:
      return requirement.aliases.some((alias) =>
        hasAffirmativeAliasMention(text, alias),
      );
  }
}

function hasConcreteKeyIdentifier(text: string): boolean {
  return /\b(?:key (?:id|identifier)|last (?:four|4)(?: characters)?|ending in)\s*(?:is|was|:)?\s*[a-z0-9][a-z0-9_-]{2,}\b/i.test(
    text,
  );
}

function hasExposureLocation(text: string): boolean {
  if (
    /\b(?:do not know|don't know|not known|unknown|unclear)\b.{0,60}\b(?:where|location)\b|\b(?:where|location)\b.{0,40}\b(?:not known|unknown|unclear)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  return /\b(?:shared|pasted|posted|published|included|exposed|leaked)\b.{0,80}\b(?:logs?|log bundle|ticket|chat|email|repository|repo|document|file)\b|\b(?:logs?|log bundle|ticket|chat|email|repository|repo|document|file)\b.{0,80}\b(?:contained|included|exposed|leaked|showed)\b/i.test(
    text,
  );
}

function hasKnownKeyUsageStatus(text: string): boolean {
  const subject = "(?:used|usage|actions taken)";
  const hasConcreteUsageStatus =
    /\b(?:key|credential|token|secret|password)\b.{0,50}\b(?:was|has been|had been|was not|has not been|never) used\b|\bno (?:post-exposure )?usage\b|\bactions taken (?:were|include|included|:)\b/i.test(
    text,
    ) ||
    /\b(?:cannot|can't|could not|couldn't)\s+see\s+any\b.{0,40}\b(?:post-exposure\s+)?(?:key\s+)?usage\b/i.test(
      text,
    );
  if (hasConcreteUsageStatus) return true;
  if (hasUnknownQualification(text, subject)) return false;
  return false;
}

function hasKnownRotationStatus(text: string): boolean {
  const subject = "(?:rotated|rotation|revoked|revocation)";
  if (hasUnknownQualification(text, subject)) return false;
  return /\b(?:key|credential|token|secret|password)\b.{0,50}\b(?:(?:was|has been|had been|is) (?:not )?(?:rotated|revoked)|remains active)\b|\b(?:rotated|revoked)\b.{0,50}\b(?:key|credential|token|secret|password)\b/i.test(
    text,
  );
}

function hasConcreteAuditSource(text: string): boolean {
  const subject = "(?:audit source|source address|source ip|actor)";
  if (hasUnknownQualification(text, subject)) return false;
  return /\bsource (?:ip|address)\s*(?:is|was|:)?\s*(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:audit source|actor)\s*(?:is|was|:)\s*[a-z0-9][a-z0-9@._-]{2,}\b/i.test(
    text,
  );
}

function hasKnownAffectedScope(text: string): boolean {
  const subject = "(?:affected scope|affected profiles|profiles? (?:were )?accessed|accounts? (?:were )?accessed)";
  if (hasUnknownQualification(text, subject)) return false;
  return /\b\d+\s+(?:profiles?|accounts?|logs?|actions?)\b|\b(?:affected|accessed|exposed|impacted)\s+(?:profiles?|accounts?|logs?|actions?)\b|\b(?:profiles?|accounts?) were (?:accessed|exposed|affected)\b/i.test(
    text,
  );
}

function hasSpecificProblemSummary(text: string): boolean {
  const trimmed = text.trim().replace(/\s+/g, " ");
  const vagueOnly =
    /^(?:(?:problem|issue|bug)[.!?\s]*)?(?:it (?:does not|doesn'?t|isn'?t|won'?t) work|not working|broken|problem|issue|bug)[.!?\s]*$/i;
  if (vagueOnly.test(trimmed)) {
    return false;
  }
  return (
    /\b(?:cannot|can'?t|failed|fails|missing|delayed|blocked|stuck|invalid|not showing|not sending|not syncing|not loading|error|broken)\b/i.test(
      text,
    ) ||
    /\b(?:blank page|page (?:stayed|is|was) blank|screen (?:stayed|is|was) blank|nothing (?:loaded|loads|happened)|stayed blank)\b/i.test(
      text,
    )
  );
}

function hasAffirmativeAliasMention(text: string, alias: string): boolean {
  const normalizedAlias = alias.toLowerCase();
  let offset = text.indexOf(normalizedAlias);
  while (offset !== -1) {
    const start = Math.max(0, offset - 80);
    const end = Math.min(text.length, offset + normalizedAlias.length + 50);
    const window = text.slice(start, end);
    if (!hasUnknownQualification(window, escapeRegExp(normalizedAlias))) {
      return true;
    }
    offset = text.indexOf(normalizedAlias, offset + normalizedAlias.length);
  }
  return false;
}

function hasUnknownQualification(text: string, subjectPattern: string): boolean {
  const unknown =
    "(?:do not know|don't know|not known|not yet known|unknown|unclear|not sure|cannot confirm|can't confirm|unable to confirm)";
  return new RegExp(
    `(?:${unknown}.{0,100}${subjectPattern}|${subjectPattern}.{0,60}${unknown})`,
    "i",
  ).test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
