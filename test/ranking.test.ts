import { describe, expect, it } from 'vitest'

import {
  computePool,
  computeRewardAmount,
  currentPeriodStart,
  DEFAULT_RANKING_PERIOD,
  getRankingConfig,
  nextPeriodStart,
  normalizeRankingAmount,
  periodRange,
  previousPeriodStart,
  settlementDueAt,
} from '@/modules/ranking/util'

function daily() {
  const config = getRankingConfig('daily')
  if (!config) {
    throw new Error('Daily ranking config is missing')
  }
  return config
}

describe('ranking helpers', () => {
  it('uses daily as the default configured period', () => {
    expect(DEFAULT_RANKING_PERIOD).toBe('daily')
    expect(getRankingConfig('daily')).not.toBeNull()
    expect(getRankingConfig('weekly')).toBeNull()
  })

  it('uses UTC period boundaries', () => {
    const now = new Date('2026-08-12T23:30:00.000Z')

    expect(currentPeriodStart('daily', now)).toBe('2026-08-12')
    expect(previousPeriodStart('daily', now)).toBe('2026-08-11')
    expect(periodRange('daily', '2026-08-12').to.toISOString()).toBe(
      '2026-08-13T00:00:00.000Z',
    )
  })

  it('advances periods and applies the freeze delay', () => {
    expect(nextPeriodStart('daily', '2026-08-12')).toBe('2026-08-13')
    expect(settlementDueAt('daily', '2026-08-12', 30).toISOString()).toBe(
      '2026-08-13T00:30:00.000Z',
    )
  })

  it('normalizes pooled currencies to the ranking precision', () => {
    expect(normalizeRankingAmount(1_000_000n, 6, 2)).toBe(100n)
    expect(normalizeRankingAmount(100n, 2, 2)).toBe(100n)
  })

  it('computes the prize pool with a configured floor', () => {
    const config = daily()

    expect(computePool(0n, config)).toBe(10_000n)
    expect(computePool(20_000_000n, config)).toBe(40_000n)
  })

  it('floors reward amounts and uses exactly 100% rank shares', () => {
    const config = daily()

    expect(computeRewardAmount(999n, 5000)).toBe(499n)
    expect(config.rankPercentagesBps.reduce((sum, bps) => sum + bps, 0)).toBe(
      10_000,
    )
  })
})

describe('ranking routes', () => {
  it('guards the player reward history endpoint', async () => {
    const { build } = await import('@test/helper')
    const { vi } = await import('vitest')
    const app = await build()
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(null)
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/ranking/rewards',
    })
    expect(response.statusCode).toBe(401)
  })
})
