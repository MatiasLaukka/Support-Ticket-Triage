import type {
  AiGuardrailCheck,
  DraftCustomerResponseStyle,
} from "../domain.js";
import type { DiagnosisContext, FixContext } from "../triage-service.js";
import type { EvidenceReadiness } from "./evidence-readiness.js";

const WORD_LIMITS: Record<DraftCustomerResponseStyle, number> = {
  concise: 140,
  balanced: 240,
  empathetic: 280,
  technical: 340,
  "executive-update": 200,
};

const REQUEST_PATTERNS = [
  /\bplease\s+(?:share|send|provide)\s+([^.!?]+)/gi,
  /\bwe\s+need\s+([^.!?]+)/gi,
  /\bconfirm\s+whether\s+([^.!?]+)/gi,
] as const;

const HIGH_CONFIDENCE_UNRELATED_REQUEST =
  /\b(?:invoice|billing(?:\s+address)?|payment|card(?:\s+number)?|bank\s+account|account\s+(?:number|details)|password|credential(?:s)?|api\s+key|token|secret|login)\b/i;

export function validateDraftQuality(input: {
  response: string;
  style: DraftCustomerResponseStyle;
  evidenceReadiness?: EvidenceReadiness;
  diagnosisContext?: DiagnosisContext;
  fixContext?: FixContext;
}): { checks: AiGuardrailCheck[]; blockingMessages: string[] } {
  const wordCount = input.response.trim().split(/\s+/).filter(Boolean).length;
  const limit = WORD_LIMITS[input.style];
  const lengthPassed = wordCount <= limit;
  const requestResult = classifyInformationRequests(input);
  const checks: AiGuardrailCheck[] = [
    {
      id: "style-word-limit",
      label: "Style word limit",
      status: lengthPassed ? "pass" : "fail",
      message: lengthPassed
        ? `Draft is within the ${limit} word ${input.style} limit.`
        : `The ${input.style} draft exceeds ${limit} words.`,
    },
    {
      id: "relevant-information-requests",
      label: "Relevant information requests",
      status: requestResult.status,
      message: requestResult.message,
    },
  ];

  return {
    checks,
    blockingMessages: checks
      .filter((check) => check.status === "fail")
      .map((check) => check.message),
  };
}

function classifyInformationRequests(input: {
  response: string;
  evidenceReadiness?: EvidenceReadiness;
  diagnosisContext?: DiagnosisContext;
  fixContext?: FixContext;
}): Pick<AiGuardrailCheck, "status" | "message"> {
  const requests = extractInformationRequests(input.response);
  if (requests.length === 0) {
    return {
      status: "pass",
      message: "Draft contains no customer information requests.",
    };
  }

  const allowedPhrases = allowedInformationPhrases(input);
  if (requests.every((request) => isAllowedRequest(request, allowedPhrases))) {
    return {
      status: "pass",
      message: "Draft requests only currently relevant information.",
    };
  }

  if (requests.some((request) => HIGH_CONFIDENCE_UNRELATED_REQUEST.test(request))) {
    return {
      status: "fail",
      message: "Draft requests unrelated sensitive account or billing information.",
    };
  }

  return {
    status: "warn",
    message: "Draft includes an information request that needs reviewer confirmation.",
  };
}

function extractInformationRequests(response: string): string[] {
  const requests: string[] = [];
  for (const pattern of REQUEST_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of response.matchAll(pattern)) {
      const request = match[1]?.trim();
      const context = response.slice(
        Math.max(0, (match.index ?? 0) - 32),
        (match.index ?? 0) + match[0].length,
      );
      if (
        request !== undefined &&
        isCustomerInformationRequest(request, match[0], context)
      ) {
        requests.push(request);
      }
    }
  }
  return requests;
}

function isCustomerInformationRequest(
  request: string,
  phrase: string,
  context: string,
): boolean {
  const supportOwnedAction =
    "(?:confirm|verify|test|investigate|review|check|look into|compare|work on)";
  if (new RegExp(`^to\\s+${supportOwnedAction}\\b`, "i").test(request)) {
    return false;
  }
  if (
    new RegExp(
      `\\b(?:we|i|our team)\\s+(?:need|will|can|should)\\s+to\\s+${supportOwnedAction}\\b`,
      "i",
    ).test(context)
  ) {
    return false;
  }
  return !/\b(?:we|i|our team)\s+(?:will|can|should)\s+confirm whether\b/i.test(
    phrase,
  );
}

function allowedInformationPhrases(input: {
  evidenceReadiness?: EvidenceReadiness;
  diagnosisContext?: DiagnosisContext;
  fixContext?: FixContext;
}): string[] {
  const evidencePhrases = (input.evidenceReadiness?.missingEvidence ?? []).flatMap(
    (requirement) => [
      requirement.id,
      requirement.label,
      requirement.customerQuestion,
      ...requirement.aliases,
    ],
  );
  return [
    ...evidencePhrases,
    input.diagnosisContext?.recommendedNextAction,
    input.fixContext?.customerAction,
    input.fixContext?.verificationRequest,
  ]
    .filter((phrase): phrase is string => phrase !== undefined)
    .map(normalizePhrase)
    .filter((phrase) => phrase.length > 0);
}

function isAllowedRequest(request: string, allowedPhrases: readonly string[]): boolean {
  const normalizedRequest = normalizePhrase(request);
  return allowedPhrases.some((allowed) =>
    normalizedRequest.includes(allowed) || allowed.includes(normalizedRequest),
  );
}

function normalizePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\b(?:a|an|the|your|our|please|share|send|provide|which|and|are|is|it)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
