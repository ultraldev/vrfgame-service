import { build } from '@test/helper'
import { describe, expect, it, vi } from 'vitest'

import { PlinkoBetInput } from '@/modules/game/plinko/schema'
import {
  calculatePlinkoPayout,
  generatePlinkoPath,
  getPlinkoMultiplierCenti,
  getPlinkoMultipliers,
  PLINKO_RISKS,
  PLINKO_ROWS,
  plinkoSlotIndex,
} from '@/modules/game/plinko/util'
import { WheelBetInput } from '@/modules/game/wheel/schema'
import {
  calculateWheelPayout,
  generateWheelSegment,
  getWheelMultiplierCenti,
  getWheelMultipliers,
  WHEEL_RISKS,
  WHEEL_SEGMENTS,
} from '@/modules/game/wheel/util'

describe('plinko rules', () => {
  it('keeps symmetric multiplier tables for every configuration', () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of PLINKO_RISKS) {
        const table = getPlinkoMultipliers(rows, risk)
        expect(table).toHaveLength(rows + 1)
        expect(table).toStrictEqual(table.toReversed())
      }
    }
  })

  it('matches approved multipliers and payouts', () => {
    expect(getPlinkoMultipliers(8, 'low')).toStrictEqual([
      500, 180, 140, 80, 50, 80, 140, 180, 500,
    ])
    expect(getPlinkoMultiplierCenti(16, 'high', 0)).toBe(500_000)
    expect(calculatePlinkoPayout(1_000_000n, 150)).toBe(1_500_000n)
  })

  it('generates deterministic paths and slot indices', () => {
    const path = generatePlinkoPath('server', 'client', 7, 12)
    expect(path).toStrictEqual(generatePlinkoPath('server', 'client', 7, 12))
    expect(path).toHaveLength(12)
    expect(
      path.every((direction) => direction === 'L' || direction === 'R'),
    ).toBeTruthy()
    expect(plinkoSlotIndex(path)).toBe(
      path.filter((direction) => direction === 'R').length,
    )
  })
})

describe('wheel rules', () => {
  it('builds tables matching the segment count', () => {
    for (const segments of WHEEL_SEGMENTS) {
      for (const risk of WHEEL_RISKS) {
        expect(getWheelMultipliers(segments, risk, 9600)).toHaveLength(segments)
      }
    }
  })

  it('keeps high risk as a single jackpot and RTP near target', () => {
    const table = getWheelMultipliers(10, 'high', 9600)
    expect(table.filter((multiplier) => multiplier > 0)).toStrictEqual([960])
    expect(
      table.reduce((total, multiplier) => total + multiplier, 0) / 1000,
    ).toBeCloseTo(0.96, 10)
    expect(getWheelMultiplierCenti(10, 'low', 0, 9600)).toBe(116)
    expect(calculateWheelPayout(1_000_000n, 990)).toBe(9_900_000n)
  })

  it('generates deterministic segment indices', () => {
    const segment = generateWheelSegment('server', 'client', 3, 20)
    expect(segment).toBe(generateWheelSegment('server', 'client', 3, 20))
    expect(segment).toBeGreaterThanOrEqual(0)
    expect(segment).toBeLessThan(20)
  })
})

describe('plinko and wheel request schemas', () => {
  it('validates game configuration fields', () => {
    expect(
      PlinkoBetInput.parse({
        amount: '10.00',
        clientSeed: 'client',
        risk: 'medium',
        rows: 12,
      }),
    ).toStrictEqual({
      amount: '10.00',
      clientSeed: 'client',
      risk: 'medium',
      rows: 12,
    })
    expect(
      WheelBetInput.parse({
        amount: '10.00',
        clientSeed: 'client',
        risk: 'high',
        segments: 30,
      }),
    ).toStrictEqual({
      amount: '10.00',
      clientSeed: 'client',
      risk: 'high',
      segments: 30,
    })
    expect(() =>
      PlinkoBetInput.parse({
        amount: '10.00',
        clientSeed: 'client',
        risk: 'medium',
        rows: 10,
      }),
    ).toThrow(/Invalid input/u)
  })
})

describe('plinko and wheel routes', () => {
  it('guard player endpoints', async () => {
    const app = await build()
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(null)

    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/games/plinko/seeds/active' }),
      app.inject({ method: 'POST', url: '/api/v1/games/plinko/seeds/rotate' }),
      app.inject({ method: 'GET', url: '/api/v1/games/plinko/bets' }),
      app.inject({ method: 'GET', url: '/api/v1/games/wheel/seeds/active' }),
      app.inject({ method: 'POST', url: '/api/v1/games/wheel/seeds/rotate' }),
      app.inject({ method: 'GET', url: '/api/v1/games/wheel/bets' }),
    ])

    expect(responses.map((response) => response.statusCode)).toStrictEqual([
      401, 401, 401, 401, 401, 401,
    ])
  })

  it('validates game bodies and idempotency headers', async () => {
    const app = await build()
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(null)

    const plinko = await app.inject({
      body: {
        amount: '10.00',
        clientSeed: 'client',
        risk: 'medium',
        rows: 12,
      },
      method: 'POST',
      url: '/api/v1/games/plinko/bets',
    })
    const wheel = await app.inject({
      body: {
        amount: '10.00',
        clientSeed: 'client',
        risk: 'high',
        segments: 30,
      },
      headers: { 'idempotency-key': 'wheel-1' },
      method: 'POST',
      url: '/api/v1/games/wheel/bets',
    })

    expect(plinko.statusCode).toBe(400)
    expect(wheel.statusCode).toBe(401)
  })
})
