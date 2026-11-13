import { build } from '@test/helper'
import { describe, expect, it, vi } from 'vitest'

import { SOCKET_EVENTS } from '@/lib/socket-events'
import {
  calculateCrashPayout,
  computeMultiplierCenti,
  createRoundSeed,
  formatMultiplier,
  generateCrashPointCenti,
} from '@/modules/game/crash/engine'
import {
  CrashPublicSnapshot,
  CrashSocketBetInput,
} from '@/modules/game/crash/schema'

describe('crash engine', () => {
  it('creates committed round seeds', () => {
    const seed = createRoundSeed()
    expect(seed.serverSeed).toHaveLength(64)
    expect(seed.serverSeedHash).toHaveLength(64)
    expect(seed.clientSeed).toHaveLength(32)
  })

  it('generates deterministic crash points', () => {
    const first = generateCrashPointCenti('server', 'client', 1, 0.01)
    expect(first).toBe(generateCrashPointCenti('server', 'client', 1, 0.01))
    expect(first).toBeGreaterThanOrEqual(100)
    expect(first).toBeLessThanOrEqual(100_000)
  })

  it('formats and pays multipliers', () => {
    expect(formatMultiplier(178)).toBe('1.78')
    expect(computeMultiplierCenti(0)).toBe(100)
    expect(computeMultiplierCenti(1000)).toBeGreaterThan(100)
    expect(calculateCrashPayout(1_000_000n, 178)).toBe(1_780_000n)
  })
})

describe('crash compatibility contracts', () => {
  it('keeps the Socket.IO event names used by the current frontend', () => {
    expect(SOCKET_EVENTS).toMatchObject({
      bet: 'crash:bet',
      betCancelled: 'crash:bet_cancelled',
      betPlaced: 'crash:bet_placed',
      cancel: 'crash:cancel',
      cashout: 'crash:cashout',
      getSnapshot: 'crash:get_snapshot',
      multiplier: 'crash:multiplier',
      phase: 'crash:phase',
      roundCrashed: 'crash:round_crashed',
      roundStarted: 'crash:round_started',
      snapshot: 'crash:snapshot',
    })
  })

  it('parses current and next round snapshots', () => {
    const round = {
      bets: [{ amount: '10.00', status: 'active' as const, userId: 'u1' }],
      clientSeed: 'client',
      crashPoint: null,
      id: 'r1',
      multiplier: '1.00',
      nonce: 1,
      phase: 'betting' as const,
      phaseElapsedMs: 100,
      roundNumber: 1,
      serverSeed: null,
      serverSeedHash: 'hash',
    }
    expect(
      CrashPublicSnapshot.parse({ currentRound: round, nextRound: null }),
    ).toStrictEqual({ currentRound: round, nextRound: null })
  })

  it('requires an idempotency key for socket bets', () => {
    expect(
      CrashSocketBetInput.parse({
        amount: '10.00',
        idempotencyKey: 'key-1',
      }),
    ).toStrictEqual({ amount: '10.00', idempotencyKey: 'key-1' })
    expect(() => CrashSocketBetInput.parse({ amount: '10.00' })).toThrow(
      /idempotencyKey/u,
    )
  })
})

describe('crash routes', () => {
  it('guards player-specific endpoints', async () => {
    const app = await build()
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(null)
    const betId = '00000000-0000-4000-8000-000000000000'

    const responses = await Promise.all([
      app.inject({
        body: { amount: '10.00' },
        headers: { 'idempotency-key': 'key-1' },
        method: 'POST',
        url: '/api/v1/games/crash/bets',
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/games/crash/bets/cancel',
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/games/crash/bets/${betId}/cashout`,
      }),
      app.inject({ method: 'GET', url: '/api/v1/games/crash/bets' }),
    ])

    expect(responses.map((response) => response.statusCode)).toStrictEqual([
      401, 401, 401, 401,
    ])
  })

  it('validates public query parameters', async () => {
    const app = await build()
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/games/crash/rounds/recent?limit=101',
    })
    expect(response.statusCode).toBe(400)
  })
})
