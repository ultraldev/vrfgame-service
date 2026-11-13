import { createHash } from 'node:crypto'

export type PaymentDirection = 'deposit' | 'withdrawal'

interface PaymentAvailabilityInput {
  currencyEnabled: boolean
  currencyWalletEnabled: boolean
  direction: PaymentDirection
  providerDepositEnabled: boolean
  providerEnabled: boolean
  providerWithdrawalEnabled: boolean
  routeDepositEnabled: boolean
  routeEnabled: boolean
  routeWithdrawalEnabled: boolean
}

export function paymentRouteAvailable(input: PaymentAvailabilityInput) {
  const providerCapability =
    input.direction === 'deposit'
      ? input.providerDepositEnabled
      : input.providerWithdrawalEnabled
  const routeCapability =
    input.direction === 'deposit'
      ? input.routeDepositEnabled
      : input.routeWithdrawalEnabled

  return (
    input.currencyEnabled &&
    input.currencyWalletEnabled &&
    input.providerEnabled &&
    providerCapability &&
    input.routeEnabled &&
    routeCapability
  )
}

export function hashPaymentRequest(
  values: Record<string, bigint | number | string>,
) {
  const payload = Object.keys(values)
    .toSorted()
    .map((key) => {
      const value = values[key]
      return [key, typeof value === 'bigint' ? value.toString() : value]
    })
  return `v1:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`
}

export function ceilBps(amount: bigint, bps: number) {
  if (amount === 0n || bps === 0) {
    return 0n
  }
  return (amount * BigInt(bps) + 9999n) / 10_000n
}
