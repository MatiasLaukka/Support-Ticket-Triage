export type DomainErrorCode =
  | "INVALID_APPROVAL_FIELDS"
  | "INVALID_NOW"
  | "STALE_APPROVAL"
  | "TICKET_NOT_FOUND"
  | "RECOMMENDATION_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "REPOSITORY_ERROR";

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: DomainErrorCode,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
