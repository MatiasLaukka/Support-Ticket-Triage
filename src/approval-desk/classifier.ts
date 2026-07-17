import type {
  Category,
  ClassificationSignal,
  Priority,
  RequiredEscalation,
  Team,
  Ticket,
} from "../domain.js";
import type { ConversationContext } from "./conversation-context.js";
import { detectKnownCause } from "./known-cause-catalog.js";

export interface TicketClassification {
  category: Category;
  priority: Priority;
  team: Team;
  knowledgeArticleIds: string[];
  requiredEscalations: RequiredEscalation[];
  confidence: number;
  signals: ClassificationSignal[];
}

type ScoreTarget =
  | `category:${Category}`
  | `priority:${Priority}`
  | `team:${Team}`
  | `knowledge:${string}`
  | `escalation:${RequiredEscalation}`
  | `knownCause:${string}`
  | `risk:${"security" | "outage" | "sla"}`
  | `disagreement:${"category" | "priority" | "team"}`;

interface ClassifierContext {
  ticket: Ticket;
  content: string;
}

interface Rule {
  id: string;
  knowledgeCategory?: Category;
  when: (context: ClassifierContext) => boolean;
  emit: (context: ClassifierContext) => ClassificationSignal[];
}

interface RuleMatch {
  rule: Rule;
  signals: ClassificationSignal[];
}

const CATEGORY_DEFAULT_TEAMS: Record<Category, Team> = {
  "account-access": "identity",
  authentication: "identity",
  billing: "billing",
  api: "api-platform",
  integration: "integrations",
  performance: "api-platform",
  incident: "incident-response",
  security: "security",
  "feature-request": "product",
  other: "support",
};

const PRIORITY_ORDER: Priority[] = ["P1", "P2", "P3", "P4"];

const CREDENTIAL_EXPOSURE_PATTERN = new RegExp(
  "(?:api[ -]?key|access token|auth(?:entication)? token|bearer token|token|credential|private key|secret[ -]key|signing[ -]secret|password)" +
    ".{0,80}(?:exposed?|exposure|leak(?:ed|age)?|shared|pasted|published|disclosed|visible|logged|in (?:the )?(?:application |shared )?logs?)" +
    "|(?:exposed?|exposure|leak(?:ed|age)?|shared|pasted|published|disclosed|visible|logged)" +
    ".{0,80}(?:api[ -]?key|access token|auth(?:entication)? token|bearer token|token|credential|private key|secret[ -]key|signing[ -]secret|password)",
);

const EVENT_PROCESSING_DELAY_PATTERN =
  /(?:activity timeline|profiles?).*(?:missing|not showing).*(?:events?|checkout)|(?:events?|checkout).*(?:missing|delay|not showing)/;

const BROAD_EVENT_IMPACT_PATTERN =
  /\bmulti-(?:account|customer|profile|store)\b|\b(?:accounts|customers|profiles|stores|regions|events)\b|\b(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:accounts?|customers?|profiles?|stores?|regions?|events?)\b|\b(?:across|all|broad(?:ly)?|correlated|entire|global|multiple|numerous|regional|region-wide|several|store-wide|widespread)\b.{0,48}\b(?:accounts|customers|profiles|stores|regions|events)\b|\b(?:accounts|customers|profiles|stores|regions|events)\b.{0,48}\b(?:across|all|broad(?:ly)?|correlated|entire|global|multiple|numerous|regional|region-wide|several|store-wide|widespread)\b/;

const SAFETY_KNOWLEDGE_ARTICLES = {
  security: new Set(["security-incident-response"]),
  outage: new Set(["event-tracking-debugging", "shopify-integration-sync"]),
} as const;

const FALLBACK_KNOWLEDGE_ARTICLES = new Set([
  "api-reference",
  "product-feedback",
]);

const TAG_CLASSIFICATIONS: Readonly<Record<string, { category: Category; team: Team }>> = {
  api: { category: "api", team: "api-platform" },
  billing: { category: "billing", team: "billing" },
  campaign: { category: "api", team: "api-platform" },
  catalog: { category: "integration", team: "integrations" },
  connector: { category: "integration", team: "integrations" },
  flow: { category: "integration", team: "integrations" },
  integration: { category: "integration", team: "integrations" },
  shopify: { category: "integration", team: "integrations" },
  sms: { category: "api", team: "api-platform" },
  sync: { category: "integration", team: "integrations" },
  webhook: { category: "integration", team: "integrations" },
};

export function classifyTicket(ticket: Ticket): TicketClassification {
  return classifyTicketWithContent({
    ticket,
    content: ticketContent(ticket),
  });
}

export function classifyTicketFromContext(
  context: ConversationContext,
  advisorySignals: readonly ClassificationSignal[] = [],
): TicketClassification {
  return classifyTicketWithContent({
    ticket: context.ticket,
    content: context.combinedText,
    advisorySignals,
  });
}

function classifyTicketWithContent(input: {
  ticket: Ticket;
  content: string;
  advisorySignals?: readonly ClassificationSignal[];
}): TicketClassification {
  const context = { ticket: input.ticket, content: input.content };
  const matches: RuleMatch[] = RULES.flatMap((rule) =>
    rule.when(context) ? [{ rule, signals: rule.emit(context) }] : [],
  );
  const signals = [
    ...matches.flatMap(({ signals: matchedSignals }) => matchedSignals),
    ...(input.advisorySignals ?? []),
  ];
  const preliminaryCategory = chooseCategory(signals);
  const knownCause = detectKnownCause({
    ticket: ticketForKnownCause({
      ...input.ticket,
      description: input.content,
    }),
    outcome: {
      ticketId: input.ticket.id,
      category: preliminaryCategory,
      acceptablePriorities: [choosePriority(signals, [], input.ticket)],
      team: chooseTeam(signals, preliminaryCategory, []),
      requiredEscalations: [],
      knowledgeArticleIds: chooseKnowledgeArticles(
        matches,
        signals,
        preliminaryCategory,
      ),
    },
  });

  if (knownCause !== undefined) {
    signals.push(
      signal(
        `known-cause-${knownCause.id}`,
        `knownCause:${knownCause.id}`,
        6,
        `Matched deterministic known cause: ${knownCause.label}.`,
      ),
      ...knownCause.knowledgeArticleIds.map((articleId) =>
        signal(
          `known-cause-article-${articleId}`,
          `knowledge:${articleId}`,
          6,
          `Known cause provides ${articleId}.`,
        ),
      ),
    );
  }

  return resolveClassification(
    input.ticket,
    signals,
    matches,
    knownCause?.knowledgeArticleIds ?? [],
  );
}

function ticketContent(ticket: Ticket): string {
  return [ticket.subject, ticket.description].join(" ").toLowerCase();
}

function ticketForKnownCause(ticket: Ticket): Ticket {
  return {
    ...ticket,
    category: undefined,
    priority: undefined,
    team: undefined,
    tags: [],
  };
}

function signal(
  ruleId: string,
  target: ScoreTarget,
  weight: number,
  reason: string,
): ClassificationSignal {
  return { ruleId, target, weight, reason };
}

const RULES: readonly Rule[] = [
  ...(["category", "priority", "team"] as const).map((field) => ({
    id: `metadata-${field}`,
    when: ({ ticket }: ClassifierContext) => ticket[field] !== undefined,
    emit: ({ ticket }: ClassifierContext) => {
      const value = ticket[field]!;
      return [
        signal(
          `metadata-${field}-${String(value).toLowerCase()}`,
          `${field}:${value}` as ScoreTarget,
          1,
          `Submitted ${field} is retained as weak evidence.`,
        ),
      ];
    },
  })),
  {
    id: "metadata-tags",
    when: ({ ticket }) => ticket.tags.some((tag) => TAG_CLASSIFICATIONS[tag.toLowerCase()] !== undefined),
    emit: ({ ticket }) => ticket.tags.flatMap((tag) => tagSignals(tag)),
  },
  {
    id: "security-exposure",
    knowledgeCategory: "security",
    when: ({ content }) => CREDENTIAL_EXPOSURE_PATTERN.test(content),
    emit: () => [
      signal("security-exposure", "risk:security", 10, "Potential credential exposure requires security handling."),
      signal("security-exposure-category", "category:security", 10, "Credential exposure routes to security."),
      signal("security-exposure-team", "team:security", 10, "Credential exposure routes to the security team."),
      signal("security-exposure-priority", "priority:P1", 10, "Credential exposure is P1."),
      signal("security-exposure-escalation", "escalation:security", 10, "Credential exposure requires security escalation."),
      signal("security-exposure-article", "knowledge:security-incident-response", 10, "Use the security incident response guidance."),
    ],
  },
  {
    id: "security-unknown-key",
    knowledgeCategory: "security",
    when: ({ content }) => /private key.*(?:no authorized owner|not yet known)|audit history.*private key/.test(content),
    emit: () => securitySignals("security-unknown-key", "An unrecognized private key requires security containment.", true),
  },
  {
    id: "security-missing-information",
    when: ({ content }) => CREDENTIAL_EXPOSURE_PATTERN.test(content) && /(?:do not know|not yet known|which profiles|source address)/.test(content),
    emit: () => [
      signal("security-missing-information", "escalation:missing-information", 8, "Security containment needs the missing exposure scope."),
    ],
  },
  {
    id: "prompt-injection",
    when: ({ content }) => /ignore (?:the )?(?:security |previous )?(?:warning|instructions)|system prompt|developer message/.test(content),
    emit: () => [
      signal("prompt-injection", "risk:security", 8, "Instruction manipulation attempt requires security review."),
      signal("prompt-injection-category", "category:security", 8, "Instruction manipulation routes to security."),
      signal("prompt-injection-team", "team:security", 8, "Instruction manipulation routes to the security team."),
      signal("prompt-injection-priority", "priority:P1", 8, "Instruction manipulation is P1."),
      signal("prompt-injection-escalation", "escalation:security", 8, "Instruction manipulation requires security escalation."),
    ],
  },
  {
    id: "event-processing-delay",
    knowledgeCategory: "incident",
    when: ({ content }) =>
      EVENT_PROCESSING_DELAY_PATTERN.test(content) &&
      BROAD_EVENT_IMPACT_PATTERN.test(content),
    emit: () => [
      signal("event-processing-delay", "risk:outage", 9, "Widespread event-processing delay may be a platform incident."),
      signal("event-processing-delay-category", "category:incident", 9, "Potential platform delay routes to incident response."),
      signal("event-processing-delay-team", "team:incident-response", 9, "Potential platform delay routes to incident response."),
      signal("event-processing-delay-priority", "priority:P1", 9, "Correlated checkout event delays are a P1 incident."),
      signal("event-processing-delay-escalation", "escalation:outage", 9, "Potential platform delay requires outage escalation."),
      signal("event-processing-delay-sla", "escalation:sla", 8, "Correlated event delays require incident SLA escalation."),
      signal("event-processing-delay-article", "knowledge:event-tracking-debugging", 7, "Use event tracking debugging guidance."),
      signal("event-processing-delay-sync-article", "knowledge:shopify-integration-sync", 5, "Review sync timing while investigating missing checkout events."),
    ],
  },
  issueRule(
    "api",
    EVENT_PROCESSING_DELAY_PATTERN,
    "api-platform",
    "P2",
    ["event-tracking-debugging"],
    "Isolated missing events require normal API event-tracking diagnosis.",
  ),
  issueRule("billing", /\bcoupon (?:codes?|pool)|expired coupon\b/, "billing", "P3", ["coupon-catalog-sync"], "Coupon lifecycle issues are billing-owned."),
  issueRule("performance", /\b(?:deliverability|hard-bounce|bounce rate|spam complaint|branded sending domain)\b/, "product", "P2", ["email-deliverability"], "Deliverability symptoms require product performance investigation."),
  issueRule("account-access", /\bduplicate profiles?.*\bcsv import|csv import.*\bduplicate profiles?\b/, "identity", "P3", ["profile-sync-issues"], "CSV profile reconciliation routes to identity."),
  issueRule("authentication", /\b(?:consent state|email consent).*\b(?:not updating|old)\b/, "identity", "P2", ["profile-sync-issues", "sms-compliance"], "Consent state synchronization routes to identity."),
  issueRule("account-access", /\b(?:replied stop|sms opt-out).*\b(?:profile|eligible)\b/, "identity", "P3", ["sms-compliance", "profile-sync-issues"], "SMS opt-out state must synchronize to the profile.", 11),
  issueRule("other", /\bno campaign name, profile, timestamp, error, or screenshot\b/, "support", "P3", [], "Missing diagnostic context keeps the ticket in support triage."),
  {
    id: "conversation-campaign-editor-blank-page",
    knowledgeCategory: "performance",
    when: ({ content }) =>
      /\bcampaign editor\b.{0,80}\b(?:blank|not loading|stayed blank|empty page)|\b(?:blank|stayed blank|empty page)\b.{0,80}\bcampaign editor\b/.test(
        content,
      ),
    emit: () => [
      signal(
        "conversation-campaign-editor-blank-page-category",
        "category:performance",
        10,
        "Campaign editor blank-page symptoms route to product performance diagnosis.",
      ),
      signal(
        "conversation-campaign-editor-blank-page-team",
        "team:product",
        10,
        "Campaign editor blank-page symptoms route to product performance diagnosis.",
      ),
      signal(
        "conversation-campaign-editor-blank-page-priority",
        "priority:P3",
        10,
        "Campaign editor blank-page symptoms route to product performance diagnosis.",
      ),
      signal(
        "conversation-campaign-editor-blank-page-article",
        "knowledge:performance-troubleshooting",
        9,
        "Campaign editor blank-page symptoms route to product performance diagnosis.",
      ),
    ],
  },
  {
    id: "conversation-app-blank-page",
    knowledgeCategory: "performance",
    when: ({ content }) =>
      /\b(?:blank page|page (?:stayed|is|was)(?: still)? blank|screen (?:stayed|is|was)(?: still)? blank|nothing (?:loaded|loads|happened))\b/.test(
        content,
      ) &&
      /\b(?:chrome|firefox|safari|edge|browser|signing out|signed out|session|failure timestamp|campaign name)\b/.test(
        content,
      ),
    emit: () => [
      signal(
        "conversation-app-blank-page-category",
        "category:performance",
        10,
        "Blank-page application symptoms route to product performance diagnosis.",
      ),
      signal(
        "conversation-app-blank-page-team",
        "team:product",
        10,
        "Blank-page application symptoms route to product performance diagnosis.",
      ),
      signal(
        "conversation-app-blank-page-priority",
        "priority:P3",
        10,
        "Blank-page application symptoms route to product performance diagnosis.",
      ),
      signal(
        "conversation-app-blank-page-article",
        "knowledge:performance-troubleshooting",
        9,
        "Use performance troubleshooting guidance for blank-page symptoms.",
      ),
    ],
  },
  issueRule("performance", /\bproduct catalog sync.*\b(?:six hours|campaign product block)|\bnew products.*\bcampaign product block\b/, "product", "P3", ["shopify-integration-sync", "coupon-catalog-sync"], "Delayed catalog availability is a product performance issue."),
  issueRule("incident", /\bcampaign audience snapshot.*\b(?:stuck|not finished|calculating)\b/, "incident-response", "P2", ["campaign-send-failures", "segmentation-audience-rules"], "A stuck audience calculation requires incident response."),
  issueRule("account-access", /\bsegment count differs|\bsaved export.*\bprofiles\b/, "support", "P3", ["segmentation-audience-rules"], "Audience count reconciliation is a support-led access investigation."),
  issueRule("performance", /\bwebhooks? eventually succeed.*\b(?:lag|delayed)|\bretry history.*\bdelayed deliveries\b/, "product", "P3", ["webhook-signature-validation"], "Retry delivery latency is a product performance issue."),
  issueRule("api", /\btrack api.*\b(?:timestamp|local time)|\bevent timestamp.*\b400 validation\b/, "api-platform", "P3", ["event-tracking-debugging"], "Timestamp validation is a Track API configuration issue."),
  issueRule("integration", /\bshopify integration.*\b(?:custom .*field|field into product profiles)\b/, "integrations", "P3", ["shopify-integration-sync"], "Shopify field mapping is an integrations configuration issue."),
  issueRule("billing", /\bremove expired coupon codes\b/, "billing", "P4", ["coupon-catalog-sync"], "Removing expired coupons is planned billing maintenance."),
  issueRule("feature-request", /\bpredictive segment builder\b/, "product", "P4", ["segmentation-audience-rules"], "A predictive segment builder is a planned product request."),
  issueRule("feature-request", /\b(?:consent rule templates|reusable consent)\b/, "product", "P3", ["sms-compliance", "segmentation-audience-rules"], "Consent templates are a product request."),
  issueRule("integration", /\bflow\b.*\b(?:added to cart|viewed product|events? are visible)\b/, "integrations", "P2", ["event-tracking-debugging"], "Flow entry depends on event eligibility."),
  issueRule("integration", /\bflow filters?\b/, "integrations", "P2", ["segmentation-audience-rules"], "Flow filters are audience eligibility rules."),
  {
    id: "policy-conflict",
    when: ({ content }) => /ignore policy|do not request approval|do not .*mention this instruction/.test(content),
    emit: () => [
      signal("policy-conflict", "escalation:policy-conflict", 8, "Instruction conflicts with approval policy and requires review."),
    ],
  },
  productRule("api", /\b(?:api|endpoint|response)\b/, "api-platform", "api-reference"),
  productRule("integration", /\b(?:shopify|catalog|connector|integration|sync)\b/, "integrations", "shopify-integration-sync"),
  productRule("integration", /\b(?:webhook|signature|delivery)\b/, "integrations", "webhook-signature-validation"),
  productRule("api", /\b(?:sms|text message|quiet-hours?)\b/, "api-platform", "sms-compliance"),
  productRule(
    "api",
    /\b(?:campaign (?:send|sending|delivery|status)|scheduled campaign|send status|audience snapshot)\b/,
    "api-platform",
    "campaign-send-failures",
  ),
  productRule("integration", /\b(?:flow|automation trigger)\b/, "integrations", "flow-trigger-troubleshooting"),
  productRule("billing", /\b(?:billing|invoice|charge|payment|subscription)\b/, "billing", "billing-and-invoices"),
  productRule("account-access", /\b(?:cannot access|access denied|role access)\b/, "identity", "account-access"),
  productRule("authentication", /\b(?:sign in|password reset|two-factor|authentication)\b/, "identity", "authentication"),
  productRule("performance", /\b(?:slow|latency|performance|timeout)\b/, "api-platform", "performance-troubleshooting"),
  productRule("feature-request", /\b(?:feature request|would like|please add)\b/, "product", "product-feedback"),
  {
    id: "sla-breach",
    when: ({ ticket }) => ticket.sla.breached,
    emit: () => [
      signal("sla-breach", "risk:sla", 7, "Response SLA has been breached."),
      signal("sla-breach-escalation", "escalation:sla", 7, "Breached SLA requires escalation."),
      signal("sla-breach-priority", "priority:P2", 7, "Breached SLA is at least P2."),
    ],
  },
];

function productRule(category: Category, matcher: RegExp, team: Team, articleId: string): Rule {
  return {
    id: `product-${category}-${articleId}`,
    knowledgeCategory: category,
    when: ({ content }) =>
      !/\b(?:not sure whether|not sure if|unclear whether)\b/.test(content) &&
      matcher.test(content),
    emit: () => [
      signal(`product-${category}-${articleId}-category`, `category:${category}`, 5, `Product terms match ${category}.`),
      signal(`product-${category}-${articleId}-team`, `team:${team}`, 5, `Product terms route to ${team}.`),
      signal(`product-${category}-${articleId}-priority`, "priority:P2", 3, "Product issue needs timely investigation."),
      signal(`product-${category}-${articleId}-article`, `knowledge:${articleId}`, 5, `Use ${articleId} guidance.`),
    ],
  };
}

function issueRule(
  category: Category,
  matcher: RegExp,
  team: Team,
  priority: Priority,
  articleIds: readonly string[],
  reason: string,
  weight = 9,
): Rule {
  const id = `issue-${category}-${articleIds[0] ?? "routing"}`;
  return {
    id,
    knowledgeCategory: category,
    when: ({ content }) => matcher.test(content),
    emit: () => [
      signal(`${id}-category`, `category:${category}`, weight, reason),
      signal(`${id}-team`, `team:${team}`, weight, reason),
      signal(`${id}-priority`, `priority:${priority}`, weight, reason),
      ...articleIds.map((articleId) => signal(`${id}-${articleId}`, `knowledge:${articleId}`, weight - 1, reason)),
    ],
  };
}

function securitySignals(ruleId: string, reason: string, needsMissingInformation: boolean): ClassificationSignal[] {
  return [
    signal(ruleId, "risk:security", 10, reason),
    signal(`${ruleId}-category`, "category:security", 10, reason),
    signal(`${ruleId}-team`, "team:security", 10, reason),
    signal(`${ruleId}-priority`, "priority:P1", 10, reason),
    signal(`${ruleId}-escalation`, "escalation:security", 10, reason),
    ...(needsMissingInformation ? [signal(`${ruleId}-missing-information`, "escalation:missing-information", 8, "Security audit details are incomplete.")] : []),
    signal(`${ruleId}-article`, "knowledge:security-incident-response", 10, reason),
  ];
}

function tagSignals(tag: string): ClassificationSignal[] {
  const normalizedTag = tag.toLowerCase();
  const classification = TAG_CLASSIFICATIONS[normalizedTag];
  if (classification === undefined) return [];

  return [
    signal(
      `metadata-tag-${normalizedTag}-category`,
      `category:${classification.category}`,
      1,
      `Submitted tag ${tag} is retained as weak category evidence.`,
    ),
    signal(
      `metadata-tag-${normalizedTag}-team`,
      `team:${classification.team}`,
      1,
      `Submitted tag ${tag} is retained as weak team evidence.`,
    ),
  ];
}

function resolveClassification(
  ticket: Ticket,
  signals: ClassificationSignal[],
  matches: readonly RuleMatch[],
  knownCauseArticleIds: readonly string[],
): TicketClassification {
  const category = chooseCategory(signals);
  const requiredEscalations = chooseEscalations(signals, ticket);
  const team = chooseTeam(signals, category, requiredEscalations);
  const priority = choosePriority(signals, requiredEscalations, ticket);
  const knowledgeArticleIds = chooseKnowledgeArticles(
    matches,
    signals,
    category,
    knownCauseArticleIds,
  );
  const disagreementSignals = buildDisagreementSignals(ticket, { category, priority, team });
  const allSignals = [...signals, ...disagreementSignals];
  const confidence = calculateConfidence(allSignals, category);

  return { category, priority, team, knowledgeArticleIds, requiredEscalations, confidence, signals: allSignals };
}

function chooseCategory(signals: ClassificationSignal[]): Category {
  if (hasStrongRisk(signals, "security")) return "security";
  if (hasStrongRisk(signals, "outage")) return "incident";
  return chooseScoredValue(signals, "category", "other") as Category;
}

function chooseEscalations(signals: ClassificationSignal[], ticket: Ticket): RequiredEscalation[] {
  const escalations = new Set<RequiredEscalation>();
  for (const { target } of signals) {
    if (target.startsWith("escalation:")) escalations.add(target.slice("escalation:".length) as RequiredEscalation);
  }
  if (hasStrongRisk(signals, "security")) escalations.add("security");
  if (hasStrongRisk(signals, "outage")) escalations.add("outage");
  if (ticket.sla.breached) escalations.add("sla");
  return [...escalations];
}

function chooseTeam(signals: ClassificationSignal[], category: Category, escalations: RequiredEscalation[]): Team {
  if (escalations.includes("security")) return "security";
  if (escalations.includes("outage")) return "incident-response";
  return chooseScoredValue(signals, "team", CATEGORY_DEFAULT_TEAMS[category]) as Team;
}

function choosePriority(signals: ClassificationSignal[], escalations: RequiredEscalation[], ticket: Ticket): Priority {
  if (escalations.includes("security")) return "P1";
  const scored = chooseScoredValue(signals, "priority", "P3") as Priority;
  if (escalations.includes("outage") || ticket.sla.breached) return atLeast(scored, "P2");
  return scored;
}

function chooseKnowledgeArticles(
  matches: readonly RuleMatch[],
  signals: readonly ClassificationSignal[],
  category: Category,
  knownCauseArticleIds: readonly string[] = [],
): string[] {
  const allowed = new Set(knownCauseArticleIds);
  const allMatchedArticleIds = new Set<string>();
  const hasKnownCauseArticles = knownCauseArticleIds.length > 0;

  for (const match of matches) {
    const articleIds = uniqueKnowledgeArticleIds(match.signals);
    articleIds.forEach((articleId) => allMatchedArticleIds.add(articleId));
    if (!hasKnownCauseArticles && match.rule.knowledgeCategory === category) {
      articleIds.forEach((articleId) => allowed.add(articleId));
    }
  }

  if (!hasKnownCauseArticles) {
    for (const signal of signals) {
      if (
        signal.ruleId.startsWith("gpt-advisory-") &&
        signal.target.startsWith("knowledge:")
      ) {
        allowed.add(signal.target.slice("knowledge:".length));
      }
    }
  }

  for (const risk of ["security", "outage"] as const) {
    if (!hasStrongRisk(signals, risk)) continue;
    for (const articleId of SAFETY_KNOWLEDGE_ARTICLES[risk]) {
      if (allMatchedArticleIds.has(articleId)) allowed.add(articleId);
    }
  }

  if ([...allowed].some((articleId) => !FALLBACK_KNOWLEDGE_ARTICLES.has(articleId))) {
    FALLBACK_KNOWLEDGE_ARTICLES.forEach((articleId) => allowed.delete(articleId));
  }

  return uniqueKnowledgeArticleIds(signals).filter((articleId) =>
    allowed.has(articleId),
  );
}

function uniqueKnowledgeArticleIds(
  signals: readonly ClassificationSignal[],
): string[] {
  return [
    ...new Set(
      signals
        .filter(({ target }) => target.startsWith("knowledge:"))
        .map(({ target }) => target.slice("knowledge:".length)),
    ),
  ];
}

function buildDisagreementSignals(ticket: Ticket, classification: Pick<TicketClassification, "category" | "priority" | "team">): ClassificationSignal[] {
  const disagreements: ClassificationSignal[] = [];
  for (const field of ["category", "priority", "team"] as const) {
    if (ticket[field] !== undefined && ticket[field] !== classification[field]) {
      disagreements.push(signal(`disagreement-${field}`, `disagreement:${field}`, -1, `Submitted ${field} differs from deterministic classification.`));
    }
  }
  return disagreements;
}

function calculateConfidence(signals: ClassificationSignal[], category: Category): number {
  if (category === "other") return 0.5;
  const score = signals.filter(({ target }) => target === `category:${category}`).reduce((total, { weight }) => total + weight, 0);
  return Math.min(0.95, Math.max(0.7, 0.65 + score / 30));
}

function chooseScoredValue(signals: ClassificationSignal[], kind: "category" | "priority" | "team", fallback: string): string {
  const scores = new Map<string, number>();
  const hasIndependentEvidence = signals.some(
    ({ ruleId, target }) =>
      target.startsWith(`${kind}:`) && !ruleId.startsWith("metadata-"),
  );
  for (const { ruleId, target, weight } of signals) {
    if (
      target.startsWith(`${kind}:`) &&
      (hasIndependentEvidence || !ruleId.startsWith("metadata-"))
    ) {
      const value = target.slice(kind.length + 1);
      scores.set(value, (scores.get(value) ?? 0) + weight);
    }
  }
  return [...scores.entries()].sort(([leftValue, leftScore], [rightValue, rightScore]) => rightScore - leftScore || leftValue.localeCompare(rightValue))[0]?.[0] ?? fallback;
}

function hasStrongRisk(
  signals: readonly ClassificationSignal[],
  risk: "security" | "outage",
): boolean {
  return signals.some(({ target, weight }) => target === `risk:${risk}` && weight >= 8);
}

function atLeast(priority: Priority, minimum: Priority): Priority {
  return PRIORITY_ORDER.indexOf(priority) <= PRIORITY_ORDER.indexOf(minimum) ? priority : minimum;
}
