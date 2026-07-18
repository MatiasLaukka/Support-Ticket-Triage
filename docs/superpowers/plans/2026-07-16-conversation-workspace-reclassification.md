# Conversation Workspace Reclassification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a conversation workspace where typed customer replies cause classification, evidence requirements, lifecycle state, and recommendation drafts to adapt from the full ticket timeline.

**Architecture:** Add a combined conversation context that feeds classifier, evidence readiness, draft generation, and optional GPT advisory classification signals. Keep deterministic resolver and guardrails as final authority while allowing GPT reasoning to contribute bounded, auditable signals for ambiguous evolving tickets.

**Tech Stack:** TypeScript, Node.js HTTP server, Zod schemas, Vitest, existing Approval Desk browser UI in `src/approval-desk/ui.ts`.

## Global Constraints

- The original ticket is not frozen truth; every recommendation uses current conversation context.
- Manual customer replies are the primary demo path; synthetic replies remain collapsed helpers.
- Classification, evidence readiness, lifecycle state, and drafts must update after replies.
- GPT reasoning can affect classification only through structured advisory `classificationSignals`.
- Deterministic security, outage, SLA, secret, and approval guardrails override GPT reasoning.
- Do not train or fine-tune a model.
- Do not make GPT the owner of approval fields.
- Do not remove existing approval, audit, queue, and recommendation history behavior.
- Use TDD for every behavior change.

---

## File Structure

- Modify `src/approval-desk/classifier.ts`: accept conversation context and advisory GPT signals, emit auditable combined classification signals.
- Create `src/approval-desk/conversation-context.ts`: normalize original ticket, replies, sent responses, latest customer reply, and helper facts for classifier/evidence/drafts.
- Modify `src/approval-desk/evidence-readiness.ts`: recalculate evidence from combined context, add specific vague-to-product evidence rules.
- Modify `src/approval-desk/recommendation-builder.ts`: build combined context, classify from context, run optional GPT reasoning provider, and draft from updated classification/lifecycle.
- Modify `src/approval-desk/draft-response-provider.ts`: ensure GPT drafting receives full timeline and add structured advisory reasoning input/type/provider.
- Modify `src/approval-desk/http.ts`: pass persisted timeline replies into recommendation builder without UI-supplied classification state.
- Modify `src/approval-desk/ui.ts`: add prominent timeline composer, demote sample replies, add recommendation change summary.
- Modify tests:
  - `test/classifier.test.ts`
  - `test/evidence-readiness.test.ts`
  - `test/approval-desk-recommendation.test.ts`
  - `test/approval-desk-http.test.ts`
  - `test/approval-desk-ui.test.ts`
  - `test/openai-draft-provider.test.ts`

---

### Task 1: Combined Conversation Context And Classifier Reclassification

**Files:**
- Create: `src/approval-desk/conversation-context.ts`
- Modify: `src/approval-desk/classifier.ts`
- Test: `test/classifier.test.ts`

**Interfaces:**
- Produces:
  - `ConversationContextInput`
  - `ConversationContext`
  - `buildConversationContextForTicket(input: ConversationContextInput): ConversationContext`
  - `classifyTicketFromContext(context: ConversationContext, advisorySignals?: readonly ClassificationSignal[]): TicketClassification`
- Consumes:
  - Existing `Ticket`, `ClassificationSignal`, `TicketClassification`.

- [ ] **Step 1: Write failing classifier tests for evolving vague tickets**

Add these tests to `test/classifier.test.ts`:

```ts
import { buildConversationContextForTicket } from "../src/approval-desk/conversation-context.js";
import { classifyTicketFromContext } from "../src/approval-desk/classifier.js";

it("reclassifies a vague ticket as product performance after campaign editor blank-page reply", async () => {
  const ticket = {
    ...(await loadSeedTicket("TKT-1010")),
    subject: "Problem",
    description: "It does not work.",
    category: "other",
    team: "support",
    tags: [],
  };
  const context = buildConversationContextForTicket({
    ticket,
    customerReplies: [
      {
        id: "reply-1",
        ticketId: ticket.id,
        createdAt: "2026-06-10T09:05:00.000Z",
        body:
          "I was trying to open the campaign editor, but the page stayed blank. The steps were: I opened the campaign, clicked Edit, and then the page stayed blank.",
      },
    ],
  });

  const classification = classifyTicketFromContext(context);

  expect(classification.category).toBe("performance");
  expect(classification.team).toBe("product");
  expect(classification.knowledgeArticleIds).toEqual(
    expect.arrayContaining(["campaign-send-failures"]),
  );
  expect(classification.signals).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ruleId: "conversation-campaign-editor-blank-page-category",
        target: "category:performance",
      }),
    ]),
  );
});

it("reclassifies a vague ticket as API after Track API timestamp reply", async () => {
  const ticket = {
    ...(await loadSeedTicket("TKT-1010")),
    subject: "Problem",
    description: "It does not work.",
    category: "other",
    team: "support",
    tags: [],
  };
  const context = buildConversationContextForTicket({
    ticket,
    customerReplies: [
      {
        id: "reply-1",
        ticketId: ticket.id,
        createdAt: "2026-06-10T09:05:00.000Z",
        body:
          "The Track API returns a 400 validation error when our event timestamp uses Europe/Helsinki local time.",
      },
    ],
  });

  const classification = classifyTicketFromContext(context);

  expect(classification.category).toBe("api");
  expect(classification.team).toBe("api-platform");
  expect(classification.knowledgeArticleIds).toEqual(
    expect.arrayContaining(["event-tracking-debugging"]),
  );
});

it("keeps deterministic security precedence over conflicting advisory signals", async () => {
  const ticket = {
    ...(await loadSeedTicket("TKT-1010")),
    subject: "Problem",
    description: "It does not work.",
    category: "other",
    team: "support",
    tags: [],
  };
  const context = buildConversationContextForTicket({
    ticket,
    customerReplies: [
      {
        id: "reply-1",
        ticketId: ticket.id,
        createdAt: "2026-06-10T09:05:00.000Z",
        body: "A private API key was pasted into shared logs.",
      },
    ],
  });
  const advisorySignals = [
    {
      ruleId: "gpt-advisory-performance-category",
      target: "category:performance",
      weight: 4,
      reason: "GPT guessed a performance issue.",
    },
    {
      ruleId: "gpt-advisory-performance-team",
      target: "team:product",
      weight: 4,
      reason: "GPT guessed product routing.",
    },
  ];

  const classification = classifyTicketFromContext(context, advisorySignals);

  expect(classification.category).toBe("security");
  expect(classification.team).toBe("security");
  expect(classification.priority).toBe("P1");
  expect(classification.requiredEscalations).toContain("security");
});
```

- [ ] **Step 2: Run classifier tests to verify failure**

Run:

```powershell
npx vitest run test/classifier.test.ts -t "reclassifies a vague ticket|security precedence"
```

Expected: fail because `conversation-context.ts` and `classifyTicketFromContext` do not exist.

- [ ] **Step 3: Create conversation context module**

Create `src/approval-desk/conversation-context.ts`:

```ts
import type { Ticket } from "../domain.js";

export interface ConversationCustomerReply {
  id: string;
  ticketId: string;
  createdAt: string;
  body: string;
}

export interface ConversationSupportResponse {
  sentAt: string;
  body: string;
}

export interface ConversationContextInput {
  ticket: Ticket;
  customerReplies?: readonly ConversationCustomerReply[];
  previousSupportResponses?: readonly ConversationSupportResponse[];
}

export interface ConversationContext {
  ticket: Ticket;
  originalText: string;
  customerReplyText: string;
  latestCustomerReply?: ConversationCustomerReply;
  previousSupportResponseText: string;
  combinedText: string;
}

export function buildConversationContextForTicket(
  input: ConversationContextInput,
): ConversationContext {
  const customerReplies = [...(input.customerReplies ?? [])]
    .filter((reply) => reply.ticketId === input.ticket.id)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
  const supportResponses = [...(input.previousSupportResponses ?? [])].sort(
    (left, right) => left.sentAt.localeCompare(right.sentAt),
  );
  const originalText = [
    input.ticket.subject,
    input.ticket.description,
    input.ticket.category,
    input.ticket.priority,
    input.ticket.team,
    ...input.ticket.tags,
  ]
    .filter(Boolean)
    .join("\n");
  const customerReplyText = customerReplies
    .map((reply) => reply.body)
    .join("\n\n");
  const previousSupportResponseText = supportResponses
    .map((response) => response.body)
    .join("\n\n");

  return {
    ticket: input.ticket,
    originalText,
    customerReplyText,
    latestCustomerReply: customerReplies[customerReplies.length - 1],
    previousSupportResponseText,
    combinedText: [originalText, previousSupportResponseText, customerReplyText]
      .filter((value) => value.trim() !== "")
      .join("\n\n")
      .toLowerCase(),
  };
}
```

- [ ] **Step 4: Extend classifier with context API and conversation rules**

Modify `src/approval-desk/classifier.ts`:

```ts
import type { ConversationContext } from "./conversation-context.js";
```

Add:

```ts
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
```

Refactor existing `classifyTicket` to call:

```ts
export function classifyTicket(ticket: Ticket): TicketClassification {
  return classifyTicketWithContent({
    ticket,
    content: ticketContent(ticket),
  });
}
```

Add rules before generic product rules:

```ts
issueRule(
  "performance",
  /\bcampaign editor\b.{0,80}\b(?:blank|not loading|stayed blank|empty page)|\b(?:blank|stayed blank|empty page)\b.{0,80}\bcampaign editor\b/,
  "product",
  "P3",
  ["campaign-send-failures"],
  "Campaign editor blank-page symptoms route to product performance diagnosis.",
  10,
),
issueRule(
  "api",
  /\btrack api\b.{0,100}\b(?:400|validation error|timestamp|local time)|\b(?:400|validation error)\b.{0,100}\b(?:track api|timestamp|local time)\b/,
  "api-platform",
  "P3",
  ["event-tracking-debugging"],
  "Track API timestamp validation routes to API platform.",
  10,
),
```

- [ ] **Step 5: Run classifier tests to verify pass**

Run:

```powershell
npx vitest run test/classifier.test.ts -t "reclassifies a vague ticket|security precedence"
```

Expected: pass.

- [ ] **Step 6: Commit Task 1**

Run:

```powershell
git add -- src/approval-desk/conversation-context.ts src/approval-desk/classifier.ts test/classifier.test.ts
git commit -m "feat: classify tickets from conversation context"
```

---

### Task 2: Evidence Recalculation And Draft Adaptation After Reclassification

**Files:**
- Modify: `src/approval-desk/recommendation-builder.ts`
- Modify: `src/approval-desk/evidence-readiness.ts`
- Modify: `src/approval-desk/ui.ts`
- Test: `test/approval-desk-recommendation.test.ts`
- Test: `test/evidence-readiness.test.ts`
- Test: `test/approval-desk-ui.test.ts`

**Interfaces:**
- Consumes:
  - `buildConversationContextForTicket`
  - `classifyTicketFromContext`
- Produces:
  - recommendations whose `category`, `team`, `missingEvidence`, `supportState`, and `draftCustomerResponse` come from the updated conversation classification.

- [ ] **Step 1: Write failing recommendation test for TKT-1010 blank editor reply**

Add to `test/approval-desk-recommendation.test.ts`:

```ts
it("adapts vague ticket classification and draft after campaign editor blank-page reply", async () => {
  const ticket = await loadSeedTicket("TKT-1010");
  const input = buildApprovalDeskRecommendationInput({
    ticket,
    actor: "approval-desk",
    customerReplies: [
      {
        id: "reply-1",
        ticketId: "TKT-1010",
        createdAt: "2026-06-10T09:05:00.000Z",
        body:
          "I was trying to open the campaign editor, but the page stayed blank. The steps were: I opened the campaign, clicked Edit, and then the page stayed blank.",
      },
    ],
  });

  expect(input.category).toBe("performance");
  expect(input.team).toBe("product");
  expect(input.supportState).toMatch(/diagnosing|information-received/);
  expect(input.providedEvidence?.map((requirement) => requirement.id)).toEqual(
    expect.arrayContaining(["problem-summary", "reproduction-steps"]),
  );
  expect(input.missingEvidence?.map((requirement) => requirement.id)).not.toContain(
    "screenshot-or-error",
  );
  expect(input.missingEvidence?.map((requirement) => requirement.id)).toEqual(
    expect.arrayContaining([
      "campaign-name",
      "failure-timestamp",
      "browser-session-details",
      "affected-scope",
    ]),
  );
  expect(input.draftCustomerResponse).toContain("campaign editor");
  expect(input.draftCustomerResponse).toContain("loading");
  expect(input.draftCustomerResponse).not.toContain("screenshot or exact message");
});
```

- [ ] **Step 2: Write failing evidence readiness test for campaign editor diagnosis**

Add to `test/evidence-readiness.test.ts`:

```ts
it("uses app-loading evidence after campaign editor blank-page context", async () => {
  const ticket = TicketSchema.parse({
    ...(await loadSeedTicket("TKT-1010")),
    description:
      "It does not work.\n\nCustomer follow-up:\nI was trying to open the campaign editor, but the page stayed blank. The steps were: I opened the campaign, clicked Edit, and then the page stayed blank.",
  });
  const readiness = analyzeEvidenceReadiness({
    ticket,
    outcome: {
      ticketId: "TKT-1010",
      category: "performance",
      acceptablePriorities: ["P3"],
      team: "product",
      requiredEscalations: [],
      knowledgeArticleIds: ["campaign-send-failures"],
    },
  });

  expect(readiness.providedEvidence.map((requirement) => requirement.id)).toEqual(
    expect.arrayContaining(["problem-summary", "reproduction-steps"]),
  );
  expect(readiness.requiredEvidence.map((requirement) => requirement.id)).toEqual([
    "campaign-name",
    "failure-timestamp",
    "browser-session-details",
    "affected-scope",
    "problem-summary",
    "reproduction-steps",
  ]);
  expect(readiness.missingEvidence.map((requirement) => requirement.id)).not.toContain(
    "screenshot-or-error",
  );
});
```

- [ ] **Step 3: Run targeted tests to verify failure**

Run:

```powershell
npx vitest run test/approval-desk-recommendation.test.ts test/evidence-readiness.test.ts -t "campaign editor"
```

Expected: fail because evidence IDs and context classification are not wired.

- [ ] **Step 4: Add evidence requirements for app loading failures**

Modify `src/approval-desk/evidence-readiness.ts` inside `EVIDENCE_CATALOG`:

```ts
"browser-session-details": {
  id: "browser-session-details",
  label: "Browser or session details",
  customerQuestion:
    "browser and whether the same issue happens after signing out and back in",
  aliases: ["browser", "session", "signed out", "signing out", "cache"],
},
```

Add to `evidenceForIssuePattern` before generic knowledge evidence:

```ts
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
```

Extend `isEvidenceProvided`:

```ts
case "browser-session-details":
  return /\b(?:chrome|firefox|safari|edge|browser|incognito|cache|signed out|signing out|session)\b/i.test(
    text,
  );
```

- [ ] **Step 5: Add UI sample helper coverage for the new evidence ID**

Modify `src/approval-desk/ui.ts` where evidence helper markers and sample reply fragments are defined:

```ts
"browser-session-details": ["browser", "session", "signed out"],
```

Add the matching sample reply value:

```ts
"browser-session-details":
  "I use Chrome, and the page is still blank after signing out and back in.",
```

This keeps `test/approval-desk-ui.test.ts` passing for the existing "has demo reply samples for every evidence requirement" coverage while sample replies remain secondary helpers.

- [ ] **Step 6: Make recommendation builder classify from conversation context**

Modify imports in `src/approval-desk/recommendation-builder.ts`:

```ts
import { buildConversationContextForTicket } from "./conversation-context.js";
import {
  classifyTicket,
  classifyTicketFromContext,
  type TicketClassification,
} from "./classifier.js";
```

In `buildApprovalDeskRecommendationInput`, replace:

```ts
const classification = outcome === undefined ? classifyTicket(ticket) : undefined;
```

with:

```ts
const conversationContextForClassification = buildConversationContextForTicket({
  ticket,
  customerReplies: input.customerReplies ?? [],
  previousSupportResponses:
    input.previousSupportResponse === undefined
      ? []
      : [input.previousSupportResponse],
});
const classification =
  outcome === undefined
    ? classifyTicketFromContext(conversationContextForClassification)
    : undefined;
```

When calling `analyzeCustomerReplyLifecycle`, use `resolvedOutcome` from the updated classification. Keep existing fixture tests that inject explicit `outcome` unchanged.

- [ ] **Step 7: Add campaign editor draft wording**

Modify `buildDraftCustomerResponse` before generic support issue handling:

```ts
if (
  input.outcome.category === "performance" &&
  input.outcome.team === "product" &&
  /\bcampaign editor\b.{0,80}\b(?:blank|not loading|stayed blank|empty page)|\b(?:blank|stayed blank|empty page)\b.{0,80}\bcampaign editor\b/i.test(
    ticketText(ticket),
  )
) {
  return buildStructuredDiagnosticResponse({
    ticket,
    evidenceReadiness,
    replyStage: input.replyStage,
    problemSummary:
      "The details you sent narrow this down to the campaign editor loading path rather than a general support issue.",
    nextStep:
      "We are checking the editor load path, account session state, and whether the behavior is isolated to one campaign or affecting other users before recommending the next action.",
  });
}
```

- [ ] **Step 8: Run targeted tests to verify pass**

Run:

```powershell
npx vitest run test/approval-desk-recommendation.test.ts test/evidence-readiness.test.ts -t "campaign editor"
```

Expected: pass.

- [ ] **Step 9: Run UI sample coverage test**

Run:

```powershell
npx vitest run test/approval-desk-ui.test.ts -t "evidence requirement"
```

Expected: pass.

- [ ] **Step 10: Commit Task 2**

Run:

```powershell
git add -- src/approval-desk/recommendation-builder.ts src/approval-desk/evidence-readiness.ts src/approval-desk/ui.ts test/approval-desk-recommendation.test.ts test/evidence-readiness.test.ts test/approval-desk-ui.test.ts
git commit -m "feat: adapt evidence and drafts after reclassification"
```

---

### Task 3: GPT Advisory Classification Signals

**Files:**
- Modify: `src/approval-desk/draft-response-provider.ts`
- Modify: `src/approval-desk/recommendation-builder.ts`
- Modify: `src/approval-desk/http.ts`
- Modify: `src/domain.ts`
- Test: `test/openai-draft-provider.test.ts`
- Test: `test/approval-desk-recommendation.test.ts`
- Test: `test/approval-desk-http.test.ts`

**Interfaces:**
- Produces:
  - `GptClassificationReasoning`
  - `GptClassificationReasoningInput`
  - `GptClassificationReasoningProvider`
  - `classificationSignals` entries with `ruleId` prefix `gpt-advisory-`.
- Consumes:
  - `ConversationContext`
  - deterministic classification output.

- [ ] **Step 1: Write failing test for advisory signals affecting ambiguous classification**

Add to `test/approval-desk-recommendation.test.ts`:

```ts
it("uses bounded GPT advisory signals to classify ambiguous vague replies", async () => {
  const ticket = {
    ...(await loadSeedTicket("TKT-1010")),
    subject: "Problem",
    description: "It does not work.",
    category: "other",
    team: "support",
    tags: [],
  };
  const input = buildApprovalDeskRecommendationInput({
    ticket,
    actor: "approval-desk",
    customerReplies: [
      {
        id: "reply-1",
        ticketId: "TKT-1010",
        createdAt: "2026-06-10T09:05:00.000Z",
        body:
          "The editor opens but the content area never finishes loading after I click edit.",
      },
    ],
    advisoryClassificationSignals: [
      {
        ruleId: "gpt-advisory-campaign-editor-category",
        target: "category:performance",
        weight: 4,
        reason:
          "GPT interpreted the content area never finishing loading as a campaign editor loading issue.",
      },
      {
        ruleId: "gpt-advisory-campaign-editor-team",
        target: "team:product",
        weight: 4,
        reason:
          "GPT suggested product routing because the editor UI fails after opening.",
      },
      {
        ruleId: "gpt-advisory-campaign-editor-knowledge",
        target: "knowledge:campaign-send-failures",
        weight: 3,
        reason:
          "GPT suggested campaign troubleshooting context for the editor failure.",
      },
    ],
  });

  expect(input.category).toBe("performance");
  expect(input.team).toBe("product");
  expect(input.classificationSignals).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ruleId: "gpt-advisory-campaign-editor-category",
        target: "category:performance",
      }),
    ]),
  );
});
```

- [ ] **Step 2: Write failing security override test**

Add:

```ts
it("does not let GPT advisory signals override deterministic security classification", async () => {
  const ticket = {
    ...(await loadSeedTicket("TKT-1010")),
    subject: "Problem",
    description: "It does not work.",
    category: "other",
    team: "support",
    tags: [],
  };
  const input = buildApprovalDeskRecommendationInput({
    ticket,
    actor: "approval-desk",
    customerReplies: [
      {
        id: "reply-1",
        ticketId: "TKT-1010",
        createdAt: "2026-06-10T09:05:00.000Z",
        body: "A private API key was pasted into shared logs.",
      },
    ],
    advisoryClassificationSignals: [
      {
        ruleId: "gpt-advisory-performance-category",
        target: "category:performance",
        weight: 4,
        reason: "GPT guessed performance.",
      },
    ],
  });

  expect(input.category).toBe("security");
  expect(input.team).toBe("security");
  expect(input.priority).toBe("P1");
  expect(input.escalationReasons).toContain("security");
});
```

- [ ] **Step 3: Run targeted tests to verify failure**

Run:

```powershell
npx vitest run test/approval-desk-recommendation.test.ts -t "GPT advisory"
```

Expected: fail because `advisoryClassificationSignals` is not accepted.

- [ ] **Step 4: Add advisory signal input to recommendation builder**

Modify `buildApprovalDeskRecommendationInput` input type in `src/approval-desk/recommendation-builder.ts`:

```ts
advisoryClassificationSignals?: readonly ClassificationSignal[];
```

Pass to classifier:

```ts
const classification =
  outcome === undefined
    ? classifyTicketFromContext(
        conversationContextForClassification,
        input.advisoryClassificationSignals ?? [],
      )
    : undefined;
```

Modify `buildApprovalDeskRecommendationInputWithDrafting` input type:

```ts
advisoryClassificationSignals?: readonly ClassificationSignal[];
```

Forward it into `buildApprovalDeskRecommendationInput(input)`.

- [ ] **Step 5: Define GPT reasoning provider contract**

In `src/approval-desk/draft-response-provider.ts`, add:

```ts
export interface GptClassificationReasoning {
  issueType: string;
  candidateCategory?: string;
  candidateTeam?: string;
  candidatePriority?: string;
  knowledgeArticleIds: string[];
  confidence: number;
  evidence: string[];
  missingEvidenceThatWouldChangeClassification: string[];
  explanation: string;
}

export interface GptClassificationReasoningInput {
  ticket: Ticket;
  conversationContext: ConversationContext;
  deterministicClassification: TicketClassification;
}

export interface GptClassificationReasoningProvider {
  reason(input: GptClassificationReasoningInput): Promise<GptClassificationReasoning>;
}
```

Add type-only imports at the top of `src/approval-desk/draft-response-provider.ts`:

```ts
import type { ConversationContext } from "./conversation-context.js";
import type { TicketClassification } from "./classifier.js";
import type { Ticket } from "../domain.js";
```

Export this converter in `recommendation-builder.ts`:

```ts
export function advisorySignalsFromGptReasoning(
  reasoning: GptClassificationReasoning,
): ClassificationSignal[] {
  const signals: ClassificationSignal[] = [];
  const weight = Math.max(1, Math.min(4, Math.round(reasoning.confidence * 4)));
  if (reasoning.candidateCategory !== undefined) {
    signals.push({
      ruleId: `gpt-advisory-${reasoning.issueType}-category`,
      target: `category:${reasoning.candidateCategory}`,
      weight,
      reason: reasoning.explanation,
    });
  }
  if (reasoning.candidateTeam !== undefined) {
    signals.push({
      ruleId: `gpt-advisory-${reasoning.issueType}-team`,
      target: `team:${reasoning.candidateTeam}`,
      weight,
      reason: reasoning.explanation,
    });
  }
  if (reasoning.candidatePriority !== undefined) {
    signals.push({
      ruleId: `gpt-advisory-${reasoning.issueType}-priority`,
      target: `priority:${reasoning.candidatePriority}`,
      weight,
      reason: reasoning.explanation,
    });
  }
  for (const articleId of reasoning.knowledgeArticleIds) {
    signals.push({
      ruleId: `gpt-advisory-${reasoning.issueType}-${articleId}`,
      target: `knowledge:${articleId}`,
      weight: Math.max(1, weight - 1),
      reason: reasoning.explanation,
    });
  }
  return signals;
}
```

- [ ] **Step 6: Wire an optional GPT classification reasoning provider through HTTP**

Modify `ApprovalDeskHttpOptions` in `src/approval-desk/http.ts`:

```ts
classificationReasoningProvider?: GptClassificationReasoningProvider;
```

In the recommendation creation handler, after `conversationContextForTicket` is built and before `buildApprovalDeskRecommendationInputWithDrafting` is called, add:

```ts
const deterministicClassification = classifyTicketFromContext(conversationContextForTicket);
const gptReasoning =
  options.classificationReasoningProvider === undefined || outcome !== undefined
    ? undefined
    : await options.classificationReasoningProvider.reason({
        ticket,
        conversationContext: conversationContextForTicket,
        deterministicClassification,
      });
const advisoryClassificationSignals =
  gptReasoning === undefined
    ? undefined
    : advisorySignalsFromGptReasoning(gptReasoning);
```

Pass `advisoryClassificationSignals` into `buildApprovalDeskRecommendationInputWithDrafting`.

- [ ] **Step 7: Write HTTP test for provider wiring**

Add to `test/approval-desk-http.test.ts`:

```ts
it("passes GPT advisory classification signals from the reasoning provider into recommendation creation", async () => {
  const app = await startApprovalDeskServer({
    classificationReasoningProvider: {
      async reason() {
        return {
          issueType: "campaign-editor",
          candidateCategory: "performance",
          candidateTeam: "product",
          knowledgeArticleIds: ["campaign-send-failures"],
          confidence: 0.9,
          evidence: ["customer says the campaign editor page stays blank"],
          missingEvidenceThatWouldChangeClassification: [],
          explanation: "The reply describes a campaign editor loading failure.",
        };
      },
    },
  });

  await app.postCustomerReply("TKT-1010", {
    actor: "approval-desk",
    body: "The campaign editor page stays blank after I click Edit.",
    source: "manual",
  });
  const response = await app.createRecommendation("TKT-1010");

  expect(response.recommendation.category).toBe("performance");
  expect(response.recommendation.team).toBe("product");
  expect(response.recommendation.classificationSignals).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ruleId: "gpt-advisory-campaign-editor-category",
        target: "category:performance",
      }),
    ]),
  );
});
```

- [ ] **Step 8: Run targeted tests to verify pass**

Run:

```powershell
npx vitest run test/approval-desk-recommendation.test.ts test/approval-desk-http.test.ts -t "GPT advisory|reasoning provider"
```

Expected: pass.

- [ ] **Step 9: Commit Task 3**

Run:

```powershell
git add -- src/approval-desk/draft-response-provider.ts src/approval-desk/recommendation-builder.ts src/approval-desk/http.ts test/approval-desk-recommendation.test.ts test/approval-desk-http.test.ts
git commit -m "feat: add bounded GPT advisory classification signals"
```

---

### Task 4: Conversation Workspace UI And Recommendation Change Summary

**Files:**
- Modify: `src/approval-desk/ui.ts`
- Modify: `test/approval-desk-ui.test.ts`
- Modify: `test/approval-desk-http.test.ts`

**Interfaces:**
- Consumes:
  - Existing `POST /api/tickets/:id/customer-replies`
  - `conversationTimeline`
  - `recommendationHistory`
  - latest recommendation fields and `classificationSignals`
- Produces:
  - Manual `Add customer reply` composer.
  - Collapsed `Insert sample reply` helper.
  - Compact recommendation change summary.

- [ ] **Step 1: Write failing UI test for manual reply composer**

Add to `test/approval-desk-ui.test.ts`:

```ts
it("adds a manual customer reply from the conversation workspace", async () => {
  const app = await startApprovalDeskApp();
  await app.selectFirstTicket();

  app.el("customerReplyBody").value =
    "The campaign editor opens, but the page stays blank after I click Edit.";
  app.el("customerReplyBody").dispatch("input");
  await app.addCustomerReply();

  const replyRequest = app.requests.find((request) =>
    request.path.endsWith("/customer-replies"),
  );
  expect(replyRequest?.path).toBe("/api/tickets/TKT-1001/customer-replies");
  expect(JSON.parse(String(replyRequest?.init?.body))).toMatchObject({
    actor: "approval-desk",
    body:
      "The campaign editor opens, but the page stays blank after I click Edit.",
    source: "manual",
  });
  expect(app.ticketDetailRequests()).toBe(2);
  expect(app.queueRequests()).toBe(2);
  expect(app.evidenceRequests()).toBe(2);
});
```

- [ ] **Step 2: Write failing UI test for sample helper demotion**

Add:

```ts
it("renders sample replies as collapsed helpers below the manual composer", async () => {
  const app = await startApprovalDeskApp();
  await app.selectFirstTicket();

  const html = app.el("conversationContextPanel").innerHTML;
  expect(html).toContain("Add customer reply");
  expect(html).toContain("Paste or type the customer");
  expect(html).toContain("<details");
  expect(html).toContain("Insert sample reply");
  expect(html).toContain("Insert partial evidence sample");
});
```

- [ ] **Step 3: Write failing UI test for recommendation change summary**

Add:

```ts
it("shows what changed between previous and latest recommendations", async () => {
  const previous = {
    ...fixtureRecommendation,
    id: "22222222-2222-4222-8222-222222222222",
    category: "other",
    team: "support",
    priority: "P3",
    supportState: "needs-information",
    missingEvidence: [
      evidenceRequirement(
        "problem-summary",
        "Problem summary",
        "what happened",
      ),
    ],
    createdAt: "2026-06-10T08:20:00.000Z",
  };
  const latest = {
    ...fixtureRecommendation,
    category: "performance",
    team: "product",
    priority: "P3",
    supportState: "diagnosing",
    missingEvidence: [
      evidenceRequirement(
        "campaign-name",
        "Campaign or flow name",
        "Campaign or flow name",
      ),
    ],
  };
  const app = await startApprovalDeskApp({
    ticketDetailRecommendation: latest,
    ticketDetail: {
      recommendationHistory: [latest, previous],
    },
  });
  await app.selectFirstTicket();

  const html = app.el("recommendationPanel").innerHTML;
  expect(html).toContain("What changed");
  expect(html).toContain("Category: other -> performance");
  expect(html).toContain("Team: support -> product");
  expect(html).toContain("State: needs-information -> diagnosing");
});
```

- [ ] **Step 4: Run UI tests to verify failure**

Run:

```powershell
npx vitest run test/approval-desk-ui.test.ts -t "manual customer reply|sample replies|what changed"
```

Expected: fail because composer and change summary do not exist.

- [ ] **Step 5: Add UI elements to fake test harness**

Modify `createElements()` in `test/approval-desk-ui.test.ts` element list:

```ts
"customerReplyBody",
"addCustomerReply",
```

Add helper:

```ts
addCustomerReply: async () => {
  elements.addCustomerReply.dispatch("click");
  await settle();
},
```

- [ ] **Step 6: Add composer markup**

Modify `src/approval-desk/ui.ts` in the Conversation Context section to include:

```html
<label for="customerReplyBody">Add customer reply</label>
<textarea id="customerReplyBody" rows="4" placeholder="Paste the customer's latest reply here"></textarea>
<p class="meta">Paste or type the customer's latest message. The next recommendation will use the full timeline.</p>
<button id="addCustomerReply" type="button" class="secondary">Add customer reply</button>
```

Move synthetic controls into:

```html
<details>
  <summary>Insert sample reply</summary>
  ...
</details>
```

Rename sample button labels to:

```ts
scenarioButton("vague-reply", "Insert vague sample")
scenarioButton("partial-evidence", "Insert partial evidence sample")
scenarioButton("complete-evidence", "Insert complete evidence sample")
scenarioButton("known-cause-evidence", "Insert known-cause sample")
scenarioButton("resolved-confirmation", "Insert resolved sample")
```

- [ ] **Step 7: Add manual reply submit handler**

Add to `src/approval-desk/ui.ts`:

```ts
async function addManualCustomerReply() {
  if (state.selectedTicket === null) {
    return;
  }
  const body = els.customerReplyBody.value.trim();
  if (body === "") {
    setResult({ error: "Customer reply cannot be empty." });
    return;
  }
  await requestJson(
    "/api/tickets/" + encodeURIComponent(state.selectedTicket.id) + "/customer-replies",
    {
      method: "POST",
      body: JSON.stringify({
        actor: els.actor.value.trim() || "approval-desk",
        body,
        source: "manual",
      }),
    },
  );
  els.customerReplyBody.value = "";
  await refreshSelectedTicket();
  await refreshQueue();
  await refreshEvidence();
}
```

Wire listener:

```ts
els.addCustomerReply.addEventListener("click", function () {
  void addManualCustomerReply().catch(function (error) {
    setResult({ error: error.message });
  });
});
```

- [ ] **Step 8: Add change summary renderer**

Add:

```ts
function renderRecommendationChangeSummary(recommendation) {
  if (!Array.isArray(state.recommendationHistory) || state.recommendationHistory.length < 2) {
    return "";
  }
  const previous = state.recommendationHistory[1];
  const changes = [];
  if (previous.category !== recommendation.category) {
    changes.push("Category: " + previous.category + " -> " + recommendation.category);
  }
  if (previous.team !== recommendation.team) {
    changes.push("Team: " + previous.team + " -> " + recommendation.team);
  }
  if (previous.priority !== recommendation.priority) {
    changes.push("Priority: " + previous.priority + " -> " + recommendation.priority);
  }
  if (previous.supportState !== recommendation.supportState) {
    changes.push("State: " + (previous.supportState ?? "not assessed") + " -> " + (recommendation.supportState ?? "not assessed"));
  }
  if (changes.length === 0) {
    return "";
  }
  return '<section class="card description"><strong>What changed</strong><ul>' +
    changes.map(function (change) { return "<li>" + escapeHtml(change) + "</li>"; }).join("") +
    "</ul></section>";
}
```

Call it in `renderRecommendation` near the lifecycle summary.

- [ ] **Step 9: Run UI tests to verify pass**

Run:

```powershell
npx vitest run test/approval-desk-ui.test.ts -t "manual customer reply|sample replies|what changed"
```

Expected: pass.

- [ ] **Step 10: Commit Task 4**

Run:

```powershell
git add -- src/approval-desk/ui.ts test/approval-desk-ui.test.ts
git commit -m "feat: add conversation workspace composer"
```

---

### Task 5: Full Integration Verification

**Files:**
- Modify only if failures reveal integration gaps.
- Test: all test suites.

**Interfaces:**
- Consumes all previous tasks.
- Produces verified demo behavior.

- [ ] **Step 1: Run full test suite**

Run:

```powershell
npm test
```

Expected:

```text
Test Files  24 passed
Tests       all passed
```

- [ ] **Step 2: Run local demo**

Run:

```powershell
$env:APPROVAL_DESK_HOST='127.0.0.1'
$env:APPROVAL_DESK_PORT='5182'
npm run demo:approval-desk
```

Expected:

```text
Approval Desk listening at http://127.0.0.1:5182.
```

- [ ] **Step 3: Browser-check TKT-1010 flow**

Manual browser steps:

1. Open `http://127.0.0.1:5182`.
2. Select `TKT-1010`.
3. Create initial recommendation.
4. Add this manual customer reply:

```text
I was trying to open the campaign editor, but the page stayed blank. The steps were: I opened the campaign, clicked Edit, and then the page stayed blank.
```

5. Create updated recommendation.

Expected:

- category is `performance`;
- team is `product`;
- lifecycle is `diagnosing` or `information-received`;
- screenshot is not required evidence;
- draft mentions campaign editor loading path;
- `What changed` summary is visible.

- [ ] **Step 4: Browser-check GPT advisory visibility**

Use a vague reply that deterministic rules do not fully classify:

```text
The editor opens but the content area never finishes loading after I click edit.
```

Expected when GPT reasoning is configured:

- GPT advisory signal appears in `Why this routing?`;
- final routing remains auditable;
- if GPT is not configured, deterministic fallback still produces a safe support draft.

- [ ] **Step 5: Commit verification fixes only if needed**

If integration fixes were required, run:

```powershell
git add -- <changed-files>
git commit -m "fix: stabilize conversation workspace integration"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage: Tasks cover manual reply composer, conversation-aware classification, GPT advisory classification signals, evidence recalculation, draft adaptation, recommendation change summary, and full integration verification.
- Placeholder scan: the plan avoids unresolved placeholder language, and every implementation step names concrete files, functions, commands, and expected results.
- Type consistency: plan uses existing `ClassificationSignal`, `TicketClassification`, `Ticket`, and recommendation builder patterns; new context types are introduced in Task 1 before later tasks consume them.
