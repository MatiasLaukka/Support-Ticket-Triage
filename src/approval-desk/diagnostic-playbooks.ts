import type { Ticket, TriageRecommendation } from "../domain.js";
import type { DiagnosisContext } from "../triage-service.js";

export function diagnoseFromPlaybook(input: {
  ticket: Ticket;
  recommendation: TriageRecommendation;
  customerReplyText: string;
}): DiagnosisContext | undefined {
  if (input.recommendation.supportState === "waiting-on-platform-fix") {
    const eventProcessingDiagnosis = diagnoseEventProcessingDelay(
      input.customerReplyText,
    );
    if (eventProcessingDiagnosis !== undefined) {
      return eventProcessingDiagnosis;
    }
  }
  if (input.recommendation.knowledgeArticleIds.includes("performance-troubleshooting")) {
    return diagnoseCampaignEditorLoading(input.customerReplyText);
  }
  return undefined;
}

function diagnoseEventProcessingDelay(
  customerReplyText: string,
): DiagnosisContext | undefined {
  const text = customerReplyText.toLowerCase();
  if (!confirmsPlatformEventProcessingDelay(text)) {
    return undefined;
  }
  return {
    status: "completed",
    causeType: "platform-delay",
    customerSafeSummary:
      "The evidence confirms a platform-side processing delay affecting accepted checkout events and profile timeline updates.",
    evidenceUsed: [
      "multiple affected store examples",
      "accepted event or API evidence",
      "missing profile timeline updates",
    ],
    confidence: "confirmed",
    owner: "engineering",
    recommendedNextAction:
      "Prepare the event-processing mitigation and ask the customer to verify the affected profile timelines after it is available.",
    doNotSay: ["Do not ask the customer to resend the same examples."],
  };
}

function diagnoseCampaignEditorLoading(customerReplyText: string): DiagnosisContext {
  const text = customerReplyText.toLowerCase();
  if (confirmsFrontendLoadingIssue(text)) {
    return {
      status: "completed",
      causeType: "performance",
      customerSafeSummary:
        "The browser-session checks point to a frontend loading issue in the campaign editor for the affected campaign.",
      evidenceUsed: [
        "private or incognito window check",
        "different browser check",
        "another admin check",
        "browser console error",
      ],
      confidence: "confirmed",
      owner: "engineering",
      recommendedNextAction:
        "Prepare the frontend loading mitigation and ask the customer to verify the campaign editor after it is available.",
      doNotSay: [
        "Do not ask for another screenshot of the blank page.",
        "Do not call this a browser-session issue after the customer confirmed cross-browser and another-admin impact.",
      ],
      diagnosticState: campaignEditorDiagnosticState("confirmed", "frontend-loading"),
    };
  }

  if (confirmsBrowserSessionIssue(text)) {
    return {
      status: "completed",
      causeType: "performance",
      customerSafeSummary:
        "The editor works after browser-session isolation, so this points to local browser session state rather than a platform-side frontend loading issue.",
      evidenceUsed: ["private or incognito window check", "browser/session isolation"],
      confidence: "confirmed",
      owner: "customer",
      recommendedNextAction:
        "Ask the customer to clear site data or continue in the working browser session; no platform fix is needed.",
      doNotSay: [
        "Do not claim engineering has applied a platform mitigation.",
        "Do not ask for frontend console evidence after the browser-session issue is confirmed.",
      ],
      diagnosticState: campaignEditorDiagnosticState("confirmed", "browser-session"),
    };
  }

  return {
    status: "completed",
    causeType: "performance",
    customerSafeSummary:
      "The details narrow the issue to campaign editor loading, but browser/session checks are needed before treating this as a frontend loading issue.",
    evidenceUsed: [
      "campaign name",
      "failure timestamp",
      "browser/session details",
      "affected scope",
    ],
    confidence: "likely",
    owner: "engineering",
    recommendedNextAction:
      "We will use the result of those checks to decide whether this can be resolved as a browser/session issue or needs frontend engineering investigation.",
    doNotSay: [
      "Do not claim the issue is fixed until a fix event is recorded.",
      "Do not ask for another screenshot of the blank page.",
      "Do not claim this is a confirmed frontend issue until browser/session checks fail.",
    ],
    diagnosticState: {
      state: "ambiguous",
      diagnosticAttempts: 0,
      hypotheses: [
        {
          id: "browser-session",
          label: "Browser/session issue",
          status: "plausible",
          evidenceUsed: ["campaign editor loading symptoms"],
          evidenceToConfirm: [
            "The editor works in a private window, another browser, or after clearing site data.",
          ],
        },
        {
          id: "frontend-loading",
          label: "Frontend loading issue",
          status: "plausible",
          evidenceUsed: ["campaign editor loading symptoms"],
          evidenceToConfirm: [
            "The editor fails across browser sessions and admins with a browser console loading error.",
          ],
        },
      ],
      evidenceToRequest: [
        "Try the editor in a private or incognito window.",
        "Try another browser and ask another admin to open the same campaign.",
        "Share any browser console loading error and retry time if it remains blank.",
      ],
    },
  };
}

function campaignEditorDiagnosticState(
  state: "confirmed",
  confirmedHypothesisId: "browser-session" | "frontend-loading",
) {
  return {
    state,
    diagnosticAttempts: 0,
    hypotheses: [
      {
        id: "browser-session",
        label: "Browser/session issue",
        status: confirmedHypothesisId === "browser-session"
          ? "confirmed" as const
          : "ruled-out" as const,
        evidenceUsed: ["browser/session isolation evidence"],
        evidenceToConfirm: [
          "The editor works in a private window, another browser, or after clearing site data.",
        ],
      },
      {
        id: "frontend-loading",
        label: "Frontend loading issue",
        status: confirmedHypothesisId === "frontend-loading"
          ? "confirmed" as const
          : "ruled-out" as const,
        evidenceUsed: ["cross-browser or cross-admin loading evidence"],
        evidenceToConfirm: [
          "The editor fails across browser sessions and admins with a browser console loading error.",
        ],
      },
    ],
    evidenceToRequest: [],
  };
}

function confirmsPlatformEventProcessingDelay(text: string): boolean {
  const broadImpact = /\b(?:all|multiple|several|both)\b.{0,48}\b(?:eu\s+)?stores?\b|\b(?:eu\s+)?stores?\b.{0,48}\b(?:all|multiple|several|both)\b/.test(text);
  const acceptedEvent = /\b(?:api|event|events|tracking call|tracking calls)\b.{0,48}\b(?:accepted|successful|success|200|202)\b|\b(?:accepted|successful|success|200|202)\b.{0,48}\b(?:api|event|events|tracking call|tracking calls)\b/.test(text);
  const missingTimeline = /\b(?:profile timeline|profile timelines|timeline|timelines)\b.{0,48}\b(?:missing|not showing|not appearing|absent|still missing)\b|\b(?:missing|not showing|not appearing|absent|still missing)\b.{0,48}\b(?:profile timeline|profile timelines|timeline|timelines)\b/.test(text);
  return broadImpact && acceptedEvent && missingTimeline;
}

function confirmsFrontendLoadingIssue(text: string): boolean {
  const triedPrivate = /\b(?:incognito|private)\b/.test(text);
  const triedDifferentBrowser = /\b(?:different browser|another browser|edge|firefox|safari)\b/.test(text);
  const triedAnotherAdmin = /\b(?:another admin|other admin|teammate|team member|coworker)\b/.test(text);
  const stillBlank = /\b(?:still|also|same)\b.{0,32}\b(?:blank|not loading|won't load|does not load|doesn't load)\b/.test(text);
  const consoleError = /\b(?:console|chunkloaderror|chunk load|javascript error|loading error)\b/.test(text);
  return triedPrivate && triedDifferentBrowser && triedAnotherAdmin && stillBlank && consoleError;
}

function confirmsBrowserSessionIssue(text: string): boolean {
  const positiveBrowserIsolation =
    /\b(?:works|loads|opens|is working)\b.{0,40}\b(?:incognito|private|different browser|another browser|after clearing|cleared site data|cleared cache)\b/.test(text) ||
    /\b(?:incognito|private|different browser|another browser|after clearing|cleared site data|cleared cache)\b.{0,40}\b(?:works|loads|opens|is working)\b/.test(text);
  const contradictedByIsolationFailure =
    /\b(?:incognito|private|different browser|another browser)\b.{0,60}\b(?:still|also|same)\b.{0,32}\b(?:blank|not loading|won't load|does not load|doesn't load)\b|\b(?:still|also|same)\b.{0,32}\b(?:blank|not loading|won't load|does not load|doesn't load)\b.{0,60}\b(?:incognito|private|different browser|another browser)\b/.test(text);
  return positiveBrowserIsolation && !contradictedByIsolationFailure;
}
