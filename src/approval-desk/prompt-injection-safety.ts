export type PromptInjectionAssessment = {
  detected: boolean;
  matchedRules: string[];
  warning: string;
};

export function assessPromptInjection(text: string): PromptInjectionAssessment {
  const normalized = text.trim().toLowerCase();
  const matchedRules = [
    /\bdo not request approval\b/.test(normalized) ? "approval-bypass" : undefined,
    /\bignore (?:the )?policy\b/.test(normalized) ? "policy-override" : undefined,
    /\bdo not .*mention (?:this|the) instruction\b/.test(normalized)
      ? "concealment"
      : undefined,
    /\b(?:system prompt|developer message|ignore .*instructions)\b/.test(normalized)
      ? "model-manipulation"
      : undefined,
  ].filter((rule): rule is string => rule !== undefined);

  return {
    detected: matchedRules.length > 0,
    matchedRules,
    warning: "Untrusted instruction-like ticket content detected; deterministic triage was used.",
  };
}
