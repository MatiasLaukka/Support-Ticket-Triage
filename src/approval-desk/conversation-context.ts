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
    latestCustomerReply: customerReplies.at(-1),
    previousSupportResponseText,
    combinedText: [originalText, previousSupportResponseText, customerReplyText]
      .filter((value) => value.trim() !== "")
      .join("\n\n")
      .toLowerCase(),
  };
}
