import type {
  Category,
  ClassificationSignal,
  Priority,
  RequiredEscalation,
  Team,
  Ticket,
} from "../domain.js";
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
  text: string;
  content: string;
}

interface Rule {
  id: string;
  when: (context: ClassifierContext) => boolean;
  emit: (context: ClassifierContext) => ClassificationSignal[];
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

export function classifyTicket(ticket: Ticket): TicketClassification {
  const context = { ticket, text: normalizeTicket(ticket), content: ticketContent(ticket) };
  const signals = RULES.flatMap((rule) => (rule.when(context) ? rule.emit(context) : []));
  const knownCause = detectKnownCause({
    ticket,
    outcome: {
      ticketId: ticket.id,
      category: chooseCategory(signals),
      acceptablePriorities: [choosePriority(signals, [], ticket)],
      team: chooseTeam(signals, chooseCategory(signals), []),
      requiredEscalations: [],
      knowledgeArticleIds: chooseKnowledgeArticles(signals, chooseCategory(signals)),
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

  return resolveClassification(ticket, signals);
}

function normalizeTicket(ticket: Ticket): string {
  return [
    ticket.subject,
    ticket.description,
    ticket.category ?? "",
    ticket.priority ?? "",
    ticket.team ?? "",
    ticket.customer.name,
    ticket.customer.plan,
    ticket.customer.region,
    ticket.requester?.role ?? "",
    ticket.requester?.department ?? "",
    ticket.requester?.technicalLevel ?? "",
    ...ticket.tags,
  ]
    .join(" ")
    .toLowerCase();
}

function ticketContent(ticket: Ticket): string {
  return [ticket.subject, ticket.description, ...ticket.tags].join(" ").toLowerCase();
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
          `metadata-${field}-${value}`,
          `${field}:${value}` as ScoreTarget,
          1,
          `Submitted ${field} is retained as weak evidence.`,
        ),
      ];
    },
  })),
  {
    id: "security-exposure",
    when: ({ text }) => /(?:private |secret |exposed |leaked ).*(?:api key|token|credential)|(?:api key|token|credential).*(?:exposed|leaked|logs)/.test(text),
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
    id: "prompt-injection",
    when: ({ text }) => /ignore (?:the )?(?:security |previous )?(?:warning|instructions)|system prompt|developer message/.test(text),
    emit: () => [signal("prompt-injection", "risk:security", 8, "Instruction manipulation attempt requires security review.")],
  },
  {
    id: "event-processing-delay",
    when: ({ text }) => /(?:activity timeline|profiles?).*(?:missing|not showing).*(?:events?|checkout)|(?:events?|checkout).*(?:missing|delay|not showing)/.test(text),
    emit: () => [
      signal("event-processing-delay", "risk:outage", 9, "Widespread event-processing delay may be a platform incident."),
      signal("event-processing-delay-category", "category:incident", 9, "Potential platform delay routes to incident response."),
      signal("event-processing-delay-team", "team:incident-response", 9, "Potential platform delay routes to incident response."),
      signal("event-processing-delay-priority", "priority:P2", 8, "Potential platform delay is at least P2."),
      signal("event-processing-delay-escalation", "escalation:outage", 9, "Potential platform delay requires outage escalation."),
      signal("event-processing-delay-article", "knowledge:event-tracking-debugging", 7, "Use event tracking debugging guidance."),
      signal("event-processing-delay-sync-article", "knowledge:shopify-integration-sync", 5, "Review sync timing while investigating missing checkout events."),
    ],
  },
  productRule("api", /\b(?:api|endpoint|request|response)\b/, "api-platform", "api-reference"),
  productRule("integration", /\b(?:shopify|catalog|connector|integration|sync)\b/, "integrations", "shopify-integration-sync"),
  productRule("integration", /\b(?:webhook|signature|delivery)\b/, "integrations", "webhook-signature-validation"),
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

function resolveClassification(ticket: Ticket, signals: ClassificationSignal[]): TicketClassification {
  const category = chooseCategory(signals);
  const requiredEscalations = chooseEscalations(signals, ticket);
  const team = chooseTeam(signals, category, requiredEscalations);
  const priority = choosePriority(signals, requiredEscalations, ticket);
  const knowledgeArticleIds = chooseKnowledgeArticles(signals, category);
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

function chooseKnowledgeArticles(signals: ClassificationSignal[], _category: Category): string[] {
  return [...new Set(signals.filter(({ target }) => target.startsWith("knowledge:")).map(({ target }) => target.slice("knowledge:".length)))];
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
  for (const { target, weight } of signals) {
    if (target.startsWith(`${kind}:`)) {
      const value = target.slice(kind.length + 1);
      scores.set(value, (scores.get(value) ?? 0) + weight);
    }
  }
  return [...scores.entries()].sort(([leftValue, leftScore], [rightValue, rightScore]) => rightScore - leftScore || leftValue.localeCompare(rightValue))[0]?.[0] ?? fallback;
}

function hasStrongRisk(signals: ClassificationSignal[], risk: "security" | "outage"): boolean {
  return signals.some(({ target, weight }) => target === `risk:${risk}` && weight >= 8);
}

function atLeast(priority: Priority, minimum: Priority): Priority {
  return PRIORITY_ORDER.indexOf(priority) <= PRIORITY_ORDER.indexOf(minimum) ? priority : minimum;
}
