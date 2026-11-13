export type KuCoinPayFailureClass =
  | 'transport'
  | 'server'
  | 'rejected'
  | 'throttled'

export class KuCoinPayRequestError extends Error {
  readonly code?: string
  readonly failureClass: KuCoinPayFailureClass

  constructor(
    message: string,
    failureClass: KuCoinPayFailureClass,
    code?: string,
  ) {
    super(message)
    this.name = 'KuCoinPayRequestError'
    this.failureClass = failureClass
    this.code = code
  }
}
