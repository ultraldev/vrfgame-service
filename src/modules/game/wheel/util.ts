import { pfRangedInt } from '@/modules/game/fairness'

export const WHEEL_SEGMENTS = [10, 20, 30, 40, 50] as const
export type WheelSegments = (typeof WHEEL_SEGMENTS)[number]

export const WHEEL_RISKS = ['low', 'medium', 'high'] as const
export type WheelRisk = (typeof WHEEL_RISKS)[number]

type MultiplierCounts = Record<number, number>

const LOW_COUNTS: Record<WheelSegments, MultiplierCounts> = {
  10: { 0: 2, 120: 7, 150: 1 },
  20: { 0: 4, 120: 14, 150: 2 },
  30: { 0: 6, 120: 21, 150: 3 },
  40: { 0: 8, 120: 28, 150: 4 },
  50: { 0: 10, 120: 35, 150: 5 },
}

const MEDIUM_COUNTS: Record<WheelSegments, MultiplierCounts> = {
  10: { 0: 5, 150: 2, 190: 1, 200: 1, 300: 1 },
  20: { 0: 10, 150: 2, 180: 1, 200: 6, 300: 1 },
  30: { 0: 15, 150: 6, 170: 1, 200: 6, 300: 1, 400: 1 },
  40: { 0: 20, 150: 8, 160: 1, 200: 7, 300: 4 },
  50: { 0: 25, 150: 13, 200: 8, 300: 3, 500: 1 },
}

function distributeCounts(counts: MultiplierCounts, segments: WheelSegments) {
  const slots: (number | null)[] = Array.from({ length: segments }, () => null)
  const groups = Object.entries(counts)
    .map(([multiplier, count]) => ({ count, multiplier: Number(multiplier) }))
    .toSorted(
      (left, right) =>
        right.count - left.count || right.multiplier - left.multiplier,
    )

  let total = 0
  for (const { count, multiplier } of groups) {
    total += count
    const step = segments / count
    for (let index = 0; index < count; index += 1) {
      let position = Math.round(index * step) % segments
      while (slots[position] !== null) {
        position = (position + 1) % segments
      }
      slots[position] = multiplier
    }
  }

  if (total !== segments) {
    throw new Error(
      `Wheel table length ${total} does not match segments ${segments}`,
    )
  }
  return slots.map((multiplier) => multiplier ?? 0)
}

function baseTable(segments: WheelSegments, risk: WheelRisk) {
  if (risk === 'high') {
    return [segments * 99, ...Array.from({ length: segments - 1 }, () => 0)]
  }
  return distributeCounts(
    risk === 'low' ? LOW_COUNTS[segments] : MEDIUM_COUNTS[segments],
    segments,
  )
}

const multiplierCache = new Map<string, number[]>()

export function getWheelMultipliers(
  segments: WheelSegments,
  risk: WheelRisk,
  rtpBps: number,
) {
  const key = `${segments}:${risk}:${rtpBps}`
  const cached = multiplierCache.get(key)
  if (cached) {
    return cached
  }

  const base = baseTable(segments, risk)
  const currentRtp =
    base.reduce((total, multiplierCenti) => total + multiplierCenti, 0) /
    (segments * 100)
  const scale = currentRtp > 0 ? rtpBps / 10_000 / currentRtp : 1
  const table = base.map((multiplierCenti) =>
    Math.max(0, Math.floor(multiplierCenti * scale)),
  )
  multiplierCache.set(key, table)
  return table
}

export function getWheelMultiplierCenti(
  segments: WheelSegments,
  risk: WheelRisk,
  segmentIndex: number,
  rtpBps: number,
) {
  const multiplier = getWheelMultipliers(segments, risk, rtpBps)[segmentIndex]
  if (multiplier === undefined) {
    throw new Error(`Invalid wheel segment: ${segmentIndex}`)
  }
  return multiplier
}

export function generateWheelSegment(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  segments: WheelSegments,
) {
  return pfRangedInt(serverSeed, clientSeed, nonce, 0, segments)
}

export function calculateWheelPayout(amount: bigint, multiplierCenti: number) {
  return (amount * BigInt(multiplierCenti)) / 100n
}
