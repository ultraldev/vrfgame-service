export type KuCoinPayoutFailureClass = 'rejected' | 'retry_later' | 'unknown'

export class KuCoinPayoutError extends Error {
  readonly failureClass: KuCoinPayoutFailureClass

  constructor(message: string, failureClass: KuCoinPayoutFailureClass) {
    super(message)
    this.name = 'KuCoinPayoutError'
    this.failureClass = failureClass
  }
}
