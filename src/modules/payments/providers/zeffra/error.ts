/**
 * `retryable` is true only when Zeffra definitively rejected the request, so
 * reusing the same merchant order number is safe. False means the outcome is
 * ambiguous (network failure, timeout, or 429) and funds must stay held until
 * reconciliation.
 */
export class ZeffraRequestError extends Error {
  readonly retryable: boolean
  readonly statusCode: number

  constructor(message: string, retryable: boolean, statusCode = 502) {
    super(message)
    this.name = 'ZeffraRequestError'
    this.retryable = retryable
    this.statusCode = statusCode
  }
}
