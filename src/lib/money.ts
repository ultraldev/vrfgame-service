export function formatAmount(amount: bigint, decimals: number) {
  const negative = amount < 0n
  const absolute = negative ? -amount : amount
  const factor = 10n ** BigInt(decimals)
  const whole = absolute / factor
  const fraction = absolute % factor

  if (decimals === 0) {
    return negative ? `-${whole}` : whole.toString()
  }

  const fractionText = fraction
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/u, '')
    .padEnd(Math.min(2, decimals), '0')
  const formatted = `${whole}.${fractionText}`

  return negative ? `-${formatted}` : formatted
}
