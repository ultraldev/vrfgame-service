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

export function parseAmount(value: string, decimals: number) {
  const match = /^(?<whole>\d+)(?:\.(?<fraction>\d+))?$/u.exec(value.trim())
  const whole = match?.groups?.whole
  if (!whole) {
    throw Object.assign(new Error('Invalid amount'), { statusCode: 400 })
  }

  const fraction = match.groups?.fraction ?? ''
  if (fraction.length > decimals) {
    throw Object.assign(
      new Error(`Amount supports at most ${decimals} decimal places`),
      { statusCode: 400 },
    )
  }

  const factor = 10n ** BigInt(decimals)
  const fractionAmount = fraction ? BigInt(fraction.padEnd(decimals, '0')) : 0n
  return BigInt(whole) * factor + fractionAmount
}
