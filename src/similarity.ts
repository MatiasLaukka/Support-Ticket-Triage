import type { DuplicateCandidate, Ticket } from "./domain.js";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "in",
  "is",
  "of",
  "on",
  "our",
  "the",
  "to",
  "with",
]);

export function normalizeTokens(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
      (token) => !STOP_WORDS.has(token),
    ),
  );
}

export function jaccardSimilarity(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  if (left.size === 0 && right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  return intersection / (left.size + right.size - intersection);
}

export function findSimilarTickets(
  source: Ticket,
  tickets: readonly Ticket[],
): DuplicateCandidate[] {
  const sourceTokens = ticketTokens(source);
  return tickets
    .filter((candidate) => candidate.id !== source.id)
    .map((candidate) => ({
      ticketId: candidate.id,
      confidence: jaccardSimilarity(sourceTokens, ticketTokens(candidate)),
    }))
    .filter(({ confidence }) => confidence > 0.2)
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        left.ticketId.localeCompare(right.ticketId),
    )
    .slice(0, 5)
    .map(({ ticketId, confidence }) => ({
      ticketId,
      confidence,
      evidence: `Jaccard token similarity ${confidence.toFixed(3)}.`,
    }));
}

function ticketTokens(ticket: Ticket): Set<string> {
  return normalizeTokens(
    [ticket.subject, ticket.description, ...ticket.tags].join(" "),
  );
}
