import { describe, expect, it } from 'vitest'

import { formatAmount } from '@/lib/money'
import {
  games,
  gift,
  multiplier,
  ordered,
  outcome,
  rtp,
} from '@/modules/lobby/util'

describe('lobby helpers', () => {
  it('formats minor-unit amounts', () => {
    expect(formatAmount(1000n, 2)).toBe('10.00')
    expect(formatAmount(1_000_000n, 6)).toBe('1.00')
  })

  it('ranks games using tags and stable ordering', () => {
    const ranked = games([
      { id: 'a', sortOrder: 0, tags: {} },
      { id: 'b', sortOrder: 10, tags: { featured: true } },
    ])

    expect(ranked.map((item) => item.id)).toStrictEqual(['b', 'a'])
  })

  it('orders admin shelves by sort order then tags', () => {
    const ranked = ordered([
      { id: 'a', sortOrder: 2, tags: { hot: true } },
      { id: 'b', sortOrder: 1, tags: {} },
    ])

    expect(ranked.map((item) => item.id)).toStrictEqual(['b', 'a'])
  })

  it('formats multipliers and computes crate rtp', () => {
    expect(multiplier(12_345)).toBe('123.45')
    expect(
      rtp(
        [
          { payout: 1000n, weight: 1 },
          { payout: 2000n, weight: 3 },
        ],
        1000n,
      ),
    ).toBe(17_500)
  })

  it('computes gift capacity and outcomes', () => {
    expect(gift(100, 500)).toBe(5)
    expect(
      outcome({
        myShares: 0,
        status: 'open',
        winnerIsPlatform: false,
        winnerUserId: null,
      }),
    ).toBe('none')
  })
})
