import { pfUint32 } from '@/modules/game/fairness'

export const CASE_OPEN_MAX_BATCH = 10
const UINT32_RANGE = 0x1_00_00_00_00

interface WeightedItem {
  weight: number
}

export function totalCrateWeight(items: WeightedItem[]) {
  return items.reduce((sum, item) => sum + item.weight, 0)
}

export function caseUnitInterval(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
) {
  return pfUint32(serverSeed, clientSeed, nonce, 0) / UINT32_RANGE
}

export function pickCrateItemIndex(
  items: WeightedItem[],
  unitInterval: number,
) {
  if (items.length === 0) {
    throw new Error('Crate drop table is empty')
  }
  const weight = totalCrateWeight(items)
  if (weight <= 0) {
    throw new Error('Crate drop table has no weight')
  }

  const target = unitInterval * weight
  let cumulative = 0
  for (const [index, item] of items.entries()) {
    cumulative += item.weight
    if (cumulative > target) {
      return index
    }
  }
  return items.length - 1
}

export function convertCratePayout(
  itemPayout: bigint,
  basePrice: bigint,
  targetPrice: bigint,
) {
  if (basePrice <= 0n || targetPrice <= 0n) {
    return 0n
  }
  return (itemPayout * targetPrice) / basePrice
}

export function crateMultiplier(payout: bigint, price: bigint) {
  if (price <= 0n) {
    return '0.00'
  }
  const centi = (payout * 100n) / price
  return `${centi / 100n}.${(centi % 100n).toString().padStart(2, '0')}`
}

export function computeCrateRtpBps(
  items: { payout: bigint; weight: number }[],
  basePrice: bigint,
) {
  const weight = totalCrateWeight(items)
  if (weight <= 0 || basePrice <= 0n) {
    return 0
  }
  const weighted = items.reduce(
    (sum, item) => sum + BigInt(item.weight) * item.payout,
    0n,
  )
  return Number((weighted * 10_000n) / (basePrice * BigInt(weight)))
}
