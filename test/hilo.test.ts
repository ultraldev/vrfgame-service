import { build } from '@test/helper'
import { describe, expect, it, vi } from 'vitest'

import {
  HiloBetResultSchema,
  HiloGuessInput,
  HiloStartInput,
} from '@/modules/game/hilo/schema'
import {
  availableDirections,
  bpsToCenti,
  canCashOutHilo,
  compoundHiloMultiplierBps,
  didWin,
  drawHiloCard,
  getHiloMultiplierBps,
  HILO_MAX_MULTIPLIER_BPS,
  HILO_MAX_ROUNDS,
  HILO_ONE_BPS,
  isValidDirection,
} from '@/modules/game/hilo/util'
import { formatMultiplierBps } from '@/modules/game/util'

describe('hilo rules', () => {
  it('offers directions based on the current card', () => {
    expect(availableDirections(1)).toStrictEqual(['higher', 'same'])
    expect(availableDirections(13)).toStrictEqual(['lower', 'same'])
    expect(availableDirections(7)).toStrictEqual(['higher', 'lower'])
    expect(isValidDirection(1, 'lower')).toBeFalsy()
    expect(isValidDirection(13, 'same')).toBeTruthy()
  })

  it('resolves or-same and strict win cases', () => {
    expect(didWin(7, 7, 'higher')).toBeTruthy()
    expect(didWin(7, 6, 'lower')).toBeTruthy()
    expect(didWin(1, 1, 'higher')).toBeFalsy()
    expect(didWin(13, 13, 'lower')).toBeFalsy()
    expect(didWin(3, 3, 'same')).toBeTruthy()
  })

  it('compounds multipliers in bps and respects the cap', () => {
    const step = getHiloMultiplierBps(7, 'higher', 400)
    expect(step).toBe(17_828)
    expect(bpsToCenti(step)).toBe(178)
    expect(formatMultiplierBps(step)).toBe('1.7828')
    expect(compoundHiloMultiplierBps(HILO_ONE_BPS, step)).toBe(step)
    expect(compoundHiloMultiplierBps(HILO_MAX_MULTIPLIER_BPS, step)).toBe(
      HILO_MAX_MULTIPLIER_BPS,
    )
  })

  it('draws deterministic cards in the expected range', () => {
    const card = drawHiloCard('server', 'client', 4)
    expect(card).toBe(drawHiloCard('server', 'client', 4))
    expect(card).toBeGreaterThanOrEqual(1)
    expect(card).toBeLessThanOrEqual(13)
  })

  it('allows cashout after a win or at the round cap', () => {
    expect(
      canCashOutHilo({ rounds: [{ card: 7, nonce: 0, type: 'deal' }] }),
    ).toBeFalsy()
    expect(
      canCashOutHilo({
        rounds: [
          { card: 7, nonce: 0, type: 'deal' },
          {
            card: 8,
            currentCard: 7,
            direction: 'higher',
            nonce: 1,
            type: 'guess',
            won: true,
          },
        ],
      }),
    ).toBeTruthy()
    expect(
      canCashOutHilo({
        rounds: Array.from({ length: HILO_MAX_ROUNDS }, (_, nonce) => ({
          card: 7,
          nonce,
          type: nonce === 0 ? 'deal' : 'skip',
        })),
      }),
    ).toBeTruthy()
  })
})

describe('hilo schemas', () => {
  it('validates start and guess inputs', () => {
    expect(
      HiloStartInput.parse({
        amount: '10.00',
        clientSeed: 'client',
      }),
    ).toStrictEqual({ amount: '10.00', clientSeed: 'client' })
    expect(HiloGuessInput.parse({ direction: 'same' })).toStrictEqual({
      direction: 'same',
    })
    expect(() => HiloGuessInput.parse({ direction: 'middle' })).toThrow(
      /Invalid option/u,
    )
  })

  it('accepts terminal loss state while retaining the prior current card', () => {
    expect(
      HiloBetResultSchema.parse({
        cumulativeMultiplierBps: HILO_ONE_BPS,
        cumulativeMultiplierCenti: 100,
        currentCard: 7,
        rounds: [
          { card: 7, nonce: 0, type: 'deal' },
          {
            card: 3,
            currentCard: 7,
            direction: 'higher',
            nonce: 1,
            type: 'guess',
            won: false,
          },
        ],
      }),
    ).toMatchObject({ currentCard: 7 })
  })
})

describe('hilo routes', () => {
  it('guards player endpoints', async () => {
    const app = await build()
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(null)
    const betId = '00000000-0000-4000-8000-000000000000'

    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/games/hilo/seeds/active' }),
      app.inject({ method: 'POST', url: '/api/v1/games/hilo/seeds/rotate' }),
      app.inject({ method: 'GET', url: '/api/v1/games/hilo/bets' }),
      app.inject({ method: 'GET', url: '/api/v1/games/hilo/bets/active' }),
      app.inject({
        method: 'POST',
        url: `/api/v1/games/hilo/bets/${betId}/skips`,
      }),
      app.inject({
        body: { direction: 'higher' },
        method: 'POST',
        url: `/api/v1/games/hilo/bets/${betId}/guesses`,
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/games/hilo/bets/${betId}/cashout`,
      }),
    ])

    expect(responses.map((response) => response.statusCode)).toStrictEqual([
      401, 401, 401, 401, 401, 401, 401,
    ])
  })

  it('validates start body and guess direction', async () => {
    const app = await build()
    const betId = '00000000-0000-4000-8000-000000000000'

    const start = await app.inject({
      body: { amount: '10.00', clientSeed: 'client' },
      method: 'POST',
      url: '/api/v1/games/hilo/bets',
    })
    const guess = await app.inject({
      body: { direction: 'middle' },
      method: 'POST',
      url: `/api/v1/games/hilo/bets/${betId}/guesses`,
    })

    expect(start.statusCode).toBe(400)
    expect(guess.statusCode).toBe(400)
  })
})
