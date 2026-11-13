import { build } from '@test/helper'
import { describe, expect, it, vi } from 'vitest'

import {
  MinesBetResultSchema,
  MinesRevealInput,
  MinesStartInput,
} from '@/modules/game/mines/schema'
import {
  calculateMinesMultiplierCenti,
  calculateMinesPayout,
  combinations,
  generateMinePositions,
  isMineTile,
  isMinesBoardCleared,
  MINES_GRID_SIZE,
  MINES_MAX_MULTIPLIER_CENTI,
  minesSafeTileCount,
} from '@/modules/game/mines/util'

describe('mines rules', () => {
  it('calculates combinations and safe tile counts', () => {
    expect(combinations(25, 1)).toBe(25)
    expect(combinations(25, 2)).toBe(300)
    expect(minesSafeTileCount(MINES_GRID_SIZE, 3)).toBe(22)
  })

  it('increases multiplier and caps extreme boards', () => {
    const first = calculateMinesMultiplierCenti(25, 5, 1, 400)
    const second = calculateMinesMultiplierCenti(25, 5, 2, 400)
    const capped = calculateMinesMultiplierCenti(25, 12, 13, 400)

    expect(second).toBeGreaterThan(first)
    expect(first).toBeGreaterThanOrEqual(100)
    expect(capped).toBe(MINES_MAX_MULTIPLIER_CENTI)
    expect(calculateMinesPayout(1_000_000n, 150)).toBe(1_500_000n)
  })

  it('detects cleared boards and mine tiles', () => {
    expect(isMinesBoardCleared(25, 3, 21)).toBeFalsy()
    expect(isMinesBoardCleared(25, 3, 22)).toBeTruthy()
    expect(isMineTile([1, 5, 9], 5)).toBeTruthy()
    expect(isMineTile([1, 5, 9], 2)).toBeFalsy()
  })

  it('generates deterministic unique mine positions', () => {
    const positions = generateMinePositions('server', 'client', 9, 25, 5)
    expect(positions).toStrictEqual(
      generateMinePositions('server', 'client', 9, 25, 5),
    )
    expect(positions).toHaveLength(5)
  })

  it('produces unique sorted mine positions in range', () => {
    const positions = generateMinePositions('server', 'client', 9, 25, 5)
    expect({
      max: Math.max(...positions),
      min: Math.min(...positions),
      sorted: positions.toSorted((left, right) => left - right),
      unique: new Set(positions).size,
    }).toStrictEqual({
      max: positions[4],
      min: positions[0],
      sorted: positions,
      unique: 5,
    })
  })
})

describe('mines schemas', () => {
  it('validates start and reveal inputs', () => {
    expect(
      MinesStartInput.parse({
        amount: '10.00',
        clientSeed: 'client',
        minesCount: 3,
      }),
    ).toStrictEqual({
      amount: '10.00',
      clientSeed: 'client',
      minesCount: 3,
    })
    expect(MinesRevealInput.parse({ tileIndex: 0 })).toStrictEqual({
      tileIndex: 0,
    })
    expect(() => MinesRevealInput.parse({ tileIndex: 25 })).toThrow(/Too big/u)
  })

  it('validates stored mine result invariants', () => {
    expect(
      MinesBetResultSchema.parse({
        gridSize: 25,
        minePositions: [2, 7, 19],
        minesCount: 3,
        multiplierCenti: 145,
        revealedTiles: [0, 1],
      }),
    ).toStrictEqual({
      gridSize: 25,
      minePositions: [2, 7, 19],
      minesCount: 3,
      multiplierCenti: 145,
      revealedTiles: [0, 1],
    })
    expect(() =>
      MinesBetResultSchema.parse({
        gridSize: 25,
        minePositions: [2, 2, 19],
        minesCount: 3,
        multiplierCenti: 145,
        revealedTiles: [0, 1],
      }),
    ).toThrow('Mine positions must be unique')
  })
})

describe('mines routes', () => {
  it('guards player endpoints', async () => {
    const app = await build()
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(null)

    const betId = '00000000-0000-4000-8000-000000000000'
    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/games/mines/seeds/active' }),
      app.inject({ method: 'POST', url: '/api/v1/games/mines/seeds/rotate' }),
      app.inject({ method: 'GET', url: '/api/v1/games/mines/bets' }),
      app.inject({ method: 'GET', url: '/api/v1/games/mines/bets/active' }),
      app.inject({
        body: { tileIndex: 0 },
        method: 'POST',
        url: `/api/v1/games/mines/bets/${betId}/reveals`,
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/games/mines/bets/${betId}/cashout`,
      }),
    ])

    expect(responses.map((response) => response.statusCode)).toStrictEqual([
      401, 401, 401, 401, 401, 401,
    ])
  })

  it('validates start body and idempotency header', async () => {
    const app = await build()
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(null)

    const start = await app.inject({
      body: {
        amount: '10.00',
        clientSeed: 'client',
        minesCount: 3,
      },
      method: 'POST',
      url: '/api/v1/games/mines/bets',
    })
    const invalidReveal = await app.inject({
      body: { tileIndex: 25 },
      method: 'POST',
      url: '/api/v1/games/mines/bets/00000000-0000-4000-8000-000000000000/reveals',
    })

    expect(start.statusCode).toBe(400)
    expect(invalidReveal.statusCode).toBe(400)
  })
})
