import { build } from '@test/helper'
import { describe, expect, it, vi } from 'vitest'

import {
  computeRaffleCapacity,
  raffleOutcome,
  raffleResolution,
} from '@/modules/raffle/util'

const baseRound = {
  capacity: 10,
  earlyWindowSec: 60,
  endsAt: new Date('2026-01-01T00:10:00.000Z'),
  sold: 0,
  tauBps: 8000,
  tauEarlyBps: 9000,
}

describe('raffle lifecycle', () => {
  it('computes capacity that covers the prize at the draw threshold', () => {
    expect(computeRaffleCapacity(100n, 50n, 8000)).toBe(3)
  })

  it('draws on sold out, early threshold, or final threshold', () => {
    expect(
      raffleResolution(
        { ...baseRound, sold: 10 },
        new Date('2026-01-01T00:00:00.000Z'),
      ),
    ).toBe('draw')
    expect(
      raffleResolution(
        { ...baseRound, sold: 9 },
        new Date('2026-01-01T00:09:30.000Z'),
      ),
    ).toBe('draw')
    expect(
      raffleResolution(
        { ...baseRound, sold: 8 },
        new Date('2026-01-01T00:10:00.000Z'),
      ),
    ).toBe('draw')
  })

  it('voids expired rounds that miss the draw threshold', () => {
    expect(
      raffleResolution(
        { ...baseRound, sold: 7 },
        new Date('2026-01-01T00:10:00.000Z'),
      ),
    ).toBe('void')
    expect(
      raffleResolution(
        { ...baseRound, sold: 7 },
        new Date('2026-01-01T00:00:00.000Z'),
      ),
    ).toBe('wait')
  })

  it('resolves user outcomes', () => {
    expect(
      raffleOutcome({
        myShares: 2,
        status: 'settled',
        userId: 'user-1',
        winnerUserId: 'user-1',
      }),
    ).toBe('won')
    expect(
      raffleOutcome({
        myShares: 2,
        status: 'settled',
        userId: 'user-1',
        winnerUserId: 'user-2',
      }),
    ).toBe('lost')
    expect(
      raffleOutcome({
        myShares: 2,
        status: 'voided',
        userId: 'user-1',
        winnerUserId: null,
      }),
    ).toBe('voided')
  })
})

describe('raffle routes', () => {
  it('guards entry and history endpoints', async () => {
    const app = await build()
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(null)
    const roundId = '00000000-0000-4000-8000-000000000000'
    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/raffles/history' }),
      app.inject({
        body: { shares: 1 },
        headers: { 'idempotency-key': 'raffle-entry-1' },
        method: 'POST',
        url: `/api/v1/raffles/rounds/${roundId}/entries`,
      }),
    ])
    expect(responses.map((response) => response.statusCode)).toStrictEqual([
      401, 401,
    ])
  })

  it('validates public raffle queries', async () => {
    const app = await build()
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/raffles?limit=51',
    })
    expect(response.statusCode).toBe(400)
  })
})
