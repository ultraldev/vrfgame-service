const BPS_DENOMINATOR = 10_000n

export const RANKING_CURRENCY = 'USD'
export const RANKING_PERIOD_TYPES = ['daily', 'weekly', 'monthly'] as const
export type RankingPeriod = (typeof RANKING_PERIOD_TYPES)[number]

export interface RankingPeriodConfig {
  freezeDelayMinutes: number
  poolMinAmount: bigint
  poolRateBps: bigint
  rankPercentagesBps: readonly number[]
  type: RankingPeriod
}

const rankingPeriods: Partial<Record<RankingPeriod, RankingPeriodConfig>> = {
  daily: {
    freezeDelayMinutes: 30,
    poolMinAmount: 10_000n,
    poolRateBps: 20n,
    rankPercentagesBps: [3500, 2000, 1300, 900, 700, 500, 400, 300, 250, 150],
    type: 'daily',
  },
}

export const DEFAULT_RANKING_PERIOD: RankingPeriod = 'daily'

export function getRankingConfig(type: RankingPeriod) {
  return rankingPeriods[type] ?? null
}

export function toBucketDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function periodStart(type: RankingPeriod, date: Date) {
  const day = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )

  if (type === 'monthly') {
    return toBucketDate(
      new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1)),
    )
  }
  if (type === 'weekly') {
    const weekday = day.getUTCDay() || 7
    day.setUTCDate(day.getUTCDate() - (weekday - 1))
  }
  return toBucketDate(day)
}

export function periodRange(type: RankingPeriod, startKey: string) {
  const from = new Date(`${startKey}T00:00:00.000Z`)
  const to = new Date(from)

  if (type === 'monthly') {
    to.setUTCMonth(to.getUTCMonth() + 1)
  } else if (type === 'weekly') {
    to.setUTCDate(to.getUTCDate() + 7)
  } else {
    to.setUTCDate(to.getUTCDate() + 1)
  }

  return { from, to }
}

export function currentPeriodStart(type: RankingPeriod, now = new Date()) {
  return periodStart(type, now)
}

export function previousPeriodStart(type: RankingPeriod, now = new Date()) {
  const { from } = periodRange(type, currentPeriodStart(type, now))
  return periodStart(type, new Date(from.getTime() - 1))
}

export function computePool(totalWagered: bigint, config: RankingPeriodConfig) {
  const fromWagering = (totalWagered * config.poolRateBps) / BPS_DENOMINATOR
  return fromWagering > config.poolMinAmount
    ? fromWagering
    : config.poolMinAmount
}

export function computeRewardAmount(poolAmount: bigint, percentageBps: number) {
  return (poolAmount * BigInt(percentageBps)) / BPS_DENOMINATOR
}
