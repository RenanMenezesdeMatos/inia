export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 422,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = "DomainError"
  }
}
