import type {
  AuditEvent,
  EvidenceRequirement,
  Ticket,
  TriageRecommendation,
} from "../domain.js";

export function automaticReplyForTicket(input: {
  ticket: Ticket;
  recommendation: TriageRecommendation;
  auditsBeforeSent: readonly AuditEvent[];
}): string | undefined {
  const fixEvent = latestAuditByAction(input.auditsBeforeSent, "fix-available");
  if (fixEvent !== undefined && input.recommendation.createdAt >= fixEvent.timestamp) {
    const latestReplyAt = latestAuditTimestamp(
      input.auditsBeforeSent,
      "customer-reply-received",
    );
    if (latestReplyAt !== undefined && latestReplyAt > fixEvent.timestamp) {
      return undefined;
    }
    return automaticResolvedReply(input.ticket);
  }

  const diagnosticReply = automaticDiagnosticFollowUpReply(input);
  if (diagnosticReply !== undefined) {
    return diagnosticReply;
  }

  if (
    input.recommendation.supportState === "needs-information" ||
    input.recommendation.supportState === "information-received"
  ) {
    return automaticEvidenceReply(input);
  }

  return undefined;
}

function automaticResolvedReply(ticket: Ticket): string {
  if (/\bcampaign editor\b/i.test(ticketText(ticket))) {
    return "It works now. The campaign editor loads normally again. Thanks for the help!";
  }
  return "It works now. Thanks for the help!";
}

function automaticDiagnosticFollowUpReply(input: {
  ticket: Ticket;
  recommendation: TriageRecommendation;
  auditsBeforeSent: readonly AuditEvent[];
}): string | undefined {
  const diagnosisEvent = latestDiagnosticAudit(input.auditsBeforeSent);
  if (
    diagnosisEvent === undefined ||
    input.recommendation.createdAt < diagnosisEvent.timestamp
  ) {
    return undefined;
  }
  if (diagnosisEvent.action === "diagnostic-escalated") {
    return undefined;
  }

  const latestReplyAt = latestAuditTimestamp(
    input.auditsBeforeSent,
    "customer-reply-received",
  );
  if (latestReplyAt !== undefined && latestReplyAt > diagnosisEvent.timestamp) {
    return undefined;
  }

  const diagnosis = diagnosisFromAudit(diagnosisEvent);
  if (diagnosis?.confidence === "confirmed") {
    return undefined;
  }

  if (isCampaignEditorRecommendation(input)) {
    return [
      "I tried a private window, Microsoft Edge, and asked another admin to open the same campaign.",
      "The editor is still blank for all of us.",
      "The browser console shows ChunkLoadError at 2026-06-10 09:50 UTC.",
    ].join(" ");
  }

  return undefined;
}

function isCampaignEditorRecommendation(input: {
  ticket: Ticket;
  recommendation: TriageRecommendation;
}): boolean {
  return (
    input.recommendation.category === "performance" &&
    input.recommendation.team === "product" &&
    (input.recommendation.knowledgeArticleIds.includes("performance-troubleshooting") ||
      /\bcampaign editor\b/i.test(ticketText(input.ticket)))
  );
}

function automaticEvidenceReply(input: {
  ticket: Ticket;
  recommendation: TriageRecommendation;
  auditsBeforeSent: readonly AuditEvent[];
}): string | undefined {
  const missingEvidence = input.recommendation.missingEvidence ?? [];
  if (missingEvidence.length === 0) {
    return knownCauseConfirmationReply(input.ticket, input.recommendation);
  }

  const priorCustomerReplies = input.auditsBeforeSent.filter(
    (event) => event.action === "customer-reply-received",
  ).length;
  const evidenceToSend =
    priorCustomerReplies === 0 && missingEvidence.length > 3
      ? missingEvidence.slice(0, 2)
      : missingEvidence;
  const sentences = contextualEvidenceSentences(input.ticket, evidenceToSend);
  if (sentences.length === 0) {
    return undefined;
  }

  if (priorCustomerReplies === 0 && evidenceToSend.length < missingEvidence.length) {
    return [
      "Thanks, here are the first details I can share now:",
      ...sentences.map((sentence) => `- ${stripTrailingPeriod(sentence)}`),
      "I am still checking the remaining examples and IDs.",
    ].join("\n");
  }

  if (priorCustomerReplies > 0) {
    return [
      "I found the remaining details:",
      ...sentences.map((sentence) => `- ${stripTrailingPeriod(sentence)}`),
    ].join("\n");
  }

  return sentences.join(" ");
}

function knownCauseConfirmationReply(
  ticket: Ticket,
  recommendation: TriageRecommendation,
): string | undefined {
  if (recommendation.knownCause === "sms-quiet-hours") {
    return "That makes sense. The campaign was scheduled during quiet hours for US recipients, so we will adjust the send time and try again after the quiet-hours window.";
  }
  if (recommendation.knownCause === "webhook-secret-rotation") {
    return "That matches what we saw after the signing secret rotation. We will update the active webhook secret and retry the affected deliveries.";
  }
  if (recommendation.knownCause === "track-api-local-time-timestamp") {
    return "The sample payload uses local time for the event timestamp. We can resend it using an ISO timestamp in UTC.";
  }
  if (recommendation.knownCause === "sms-stop-sync-delay") {
    return "The STOP reply is visible in the opt-out history, but the profile still appears eligible for SMS. We can wait for the consent sync to finish before retrying.";
  }
  return undefined;
}

function contextualEvidenceSentences(
  ticket: Ticket,
  evidence: readonly EvidenceRequirement[],
): string[] {
  const text = ticketText(ticket);
  return evidence.map((requirement) => evidenceSentence(requirement.id, text));
}

function evidenceSentence(id: string, ticketTextValue: string): string {
  const samples: Record<string, string> = {
    "affected-recipient-domains":
      "The affected recipient domains are gmail.com and outlook.com.",
    "audience-size": "The expected audience size is about 2,100 profiles.",
    "affected-scope": ticketTextValue.includes("campaign editor")
      ? "The affected scope is 12 profiles in the latest export."
      : "The affected scope is 12 profiles in the account.",
    "api-response-status": "The API response status is 202 accepted.",
    "audit-source": "The audit source shown is IP 198.51.100.24.",
    "billing-account": "The billing account is the main workspace for this account.",
    "bounce-samples": "A sample bounce code is 550 5.1.1 user unknown.",
    "browser-session-details":
      "I use Chrome, and the issue still happens after signing out and back in.",
    "campaign-name": "The campaign name is Summer Flash Sale.",
    "catalog-sync-time":
      "The last catalog sync time I can see is 2026-06-10 09:20 UTC.",
    "compliance-banner":
      "The dashboard banner says quiet-hour protection blocked delivery.",
    "coupon-pool-name": "The coupon pool name is summer-launch-2026.",
    "delivery-id": "The webhook delivery ID is deliv_7788.",
    "delivery-attempt-time":
      "The webhook delivery attempt time was 2026-06-10 09:12 UTC.",
    "endpoint-response-code": "The endpoint response code is HTTP 401.",
    "endpoint-url":
      "The webhook endpoint URL is https://hooks.example.test/webhooks/orders.",
    "consent-timeline":
      "The consent timeline shows the STOP reply, but the profile still appears eligible.",
    "error-banner": 'The error banner says "Something went wrong".',
    "event-created-time":
      "The source event creation time was 2026-06-10 08:54 UTC.",
    "event-id": "The event ID is evt_checkout_7788 at 2026-06-10 09:15 UTC.",
    "expected-field": "The expected custom field name is material.",
    "exposure-location":
      "The key may have been shared in a connector log bundle attached to the ticket.",
    "failure-timestamp": "The failure timestamp was 2026-06-10 09:15 UTC.",
    "feature-description":
      "We would like reusable approval workflows for campaign launches.",
    "flow-id": "The flow name is Browse Abandonment, flow ID flow_12345.",
    "invoice-number": "The invoice number is INV-2026-1042.",
    "key-identifier": "The key identifier ends in 4f8a; I am not sending the secret value.",
    "key-usage-status":
      "I cannot see any post-exposure key usage in the audit view.",
    "masked-recipient": "The masked recipient is +1 *** *** 0134.",
    "object-id": ticketTextValue.includes("product")
      ? "The affected product ID is sku-7788."
      : "The affected object ID is sku-7788.",
    "opt-out-timestamp": "The STOP reply timestamp was 2026-06-10 18:42 UTC.",
    platform: platformEvidenceSentence(ticketTextValue),
    "plan-or-promotion":
      "The affected plan or promotion is the Summer Launch coupon campaign.",
    "problem-summary":
      "I was trying to open the campaign editor, but the page stayed blank.",
    "product-reference":
      "The product URL is https://store.example.test/products/linen-shirt.",
    "profile-email": "One affected profile is customer@example.test.",
    "raw-body-change-status":
      "Raw body handling has not changed since yesterday.",
    "recipient-region": "The recipient region is US.",
    "request-id": "The request ID is req_12345.",
    "reproduction-steps":
      "The steps were: I opened the campaign, clicked Edit, and then the page stayed blank.",
    "retry-history":
      "The retry history shows the delivery eventually succeeded after three retries.",
    "rotation-status": "The exposed key has been rotated and the old key was revoked.",
    "sample-payload":
      'The redacted sample payload is {"event":"Checkout Started","timestamp":"2026-06-10T09:15:00Z","profile_id":"customer_123"}.',
    "scheduled-send-time": "The scheduled send time was 8:30 PM US Eastern.",
    "screenshot-or-error":
      "There is no error code; the editor area stays blank.",
    "segment-name": "The segment name is Engaged Subscribers - 30 days.",
    "sending-domain": "The sending domain is mail.example.test.",
    "signing-secret-rotation-time":
      "We rotated the signing secret yesterday at 08:10 UTC.",
    "source-update-time":
      "The source-system update time was 2026-06-10 07:30 UTC.",
    "store-url": "The affected store is https://store.example.test.",
    "timestamp-tolerance":
      "The timestamp tolerance configured for verification is five minutes.",
    "timeline-visibility":
      "The event is still missing from the profile activity timeline.",
    "unused-coupon-status":
      "Unused coupon codes remain available in the pool.",
    "use-case":
      "The use case is letting a marketing manager review and approve campaign launch steps before send time.",
  };
  return samples[id] ?? `The ${humanizeEvidenceId(id)} is example-${id}.`;
}

function platformEvidenceSentence(ticketTextValue: string): string {
  if (ticketTextValue.includes("magento")) {
    return "The ecommerce platform is Magento.";
  }
  if (ticketTextValue.includes("woocommerce")) {
    return "The ecommerce platform is WooCommerce.";
  }
  return "The ecommerce platform is Shopify.";
}

function ticketText(ticket: Ticket): string {
  return [
    ticket.subject,
    ticket.description,
    ...(Array.isArray(ticket.tags) ? ticket.tags : []),
  ]
    .join(" ")
    .toLowerCase();
}

function latestAuditByAction(
  audits: readonly AuditEvent[],
  action: string,
): AuditEvent | undefined {
  return audits
    .filter((event) => event.action === action)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0];
}

function latestDiagnosticAudit(
  audits: readonly AuditEvent[],
): AuditEvent | undefined {
  return audits
    .filter(
      (event) =>
        event.action === "diagnosis-completed" ||
        event.action === "diagnostic-escalated",
    )
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0];
}

function latestAuditTimestamp(
  audits: readonly AuditEvent[],
  action: string,
): string | undefined {
  return latestAuditByAction(audits, action)?.timestamp;
}

function diagnosisFromAudit(event: AuditEvent): { confidence?: string } | undefined {
  const after = event.after;
  if (typeof after !== "object" || after === null || !("diagnosis" in after)) {
    return undefined;
  }
  const diagnosis = (after as { diagnosis?: unknown }).diagnosis;
  return typeof diagnosis === "object" && diagnosis !== null
    ? (diagnosis as { confidence?: string })
    : undefined;
}

function stripTrailingPeriod(value: string): string {
  return value.replace(/\.$/, "");
}

function humanizeEvidenceId(id: string): string {
  return id.replaceAll("-", " ");
}
