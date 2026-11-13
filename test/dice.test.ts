import { build } from '@test/helper'
import { describe, expect, it, vi } from 'vitest'

import { loadConfig } from '@/lib/config'
import { formatAmount, parseAmount } from '@/lib/money'
import { decryptSeed, encryptSeed } from '@/lib/seed-cipher'
import { hashGameBetRequest } from '@/modules/game/bets'
import { DiceBetInput, DiceHistoryQuery } from '@/modules/game/dice/schema'
import {
  calculateDiceOutcome,
  calculateDicePayout,
  formatRoll,
} from '@/modules/game/dice/util'
import { hashServerSeed, roll } from '@/modules/game/fairness'

function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    BETTER_AUTH_SECRET: 'test-secret',
    BETTER_AUTH_URL: 'http://localhost:8000',
    DATABASE_URL: 'postgresql://localhost/vrfgame_test',
    NODE_ENV: 'test',
    REDIS_URL: 'redis://localhost:6380',
    TRUSTED_ORIGINS: 'http://localhost:3000',
    ...overrides,
  })
}

describe('dice fairness', () => {
  it('hashes and rolls deterministically', () => {
    const hash = hashServerSeed('server-seed')
    expect(hash).toBe(hashServerSeed('server-seed'))
    expect(hash).toHaveLength(64)
    expect(roll('server-seed', 'client-seed', 0)).toBe(
      roll('server-seed', 'client-seed', 0),
    )
    expect(roll('server-seed', 'client-seed', 0)).not.toBe(
      roll('server-seed', 'client-seed', 1),
    )
  })

  it('produces rolls in the expected range', () => {
    for (let nonce = 0; nonce < 5000; nonce += 1) {
      const value = roll('server-seed', 'client-seed', nonce)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(10_000)
    }
  })

  it('applies dice thresholds and payouts', () => {
    expect({
      overBoundary: calculateDiceOutcome('over', 50, 5000),
      overWin: calculateDiceOutcome('over', 50, 5001),
      underBoundary: calculateDiceOutcome('under', 50, 5000),
      underWin: calculateDiceOutcome('under', 50, 4999),
    }).toStrictEqual({
      overBoundary: false,
      overWin: true,
      underBoundary: false,
      underWin: true,
    })
  })

  it('calculates exact payouts and formats rolls', () => {
    expect(calculateDicePayout(1_000_000n, 'under', 50, 400n)).toBe(1_920_000n)
    expect(formatRoll(5050)).toBe('50.50')
  })

  it('hashes the complete bet request including the game', () => {
    const input = {
      amount: 1000n,
      clientSeed: 'client',
      currency: 'USDT',
      direction: 'under' as const,
      game: 'dice',
      target: 50,
    }

    const request = {
      amount: input.amount,
      clientSeed: input.clientSeed,
      currency: input.currency,
      direction: input.direction,
      target: input.target,
    }
    expect(hashGameBetRequest('dice', request)).toBe(
      hashGameBetRequest('dice', request),
    )
    expect(hashGameBetRequest('dice', request)).not.toBe(
      hashGameBetRequest('crash', request),
    )
    expect(hashGameBetRequest('dice', request)).not.toBe(
      hashGameBetRequest('dice', { ...request, target: 49 }),
    )
  })
})

describe('seed encryption and amounts', () => {
  it('allows explicit plaintext only in development and test', () => {
    const config = testConfig()
    expect(encryptSeed('server-seed', config)).toBe('server-seed')
    expect(decryptSeed('server-seed', config)).toBe('server-seed')
  })

  it('encrypts seeds with AES-GCM when a keyring is configured', () => {
    const config = testConfig({
      SEED_ENCRYPTION_ACTIVE_KEY_ID: '2026-11',
      SEED_ENCRYPTION_KEYS: JSON.stringify({
        '2026-11': '11'.repeat(32),
      }),
    })
    const encrypted = encryptSeed('server-seed', config)

    expect(encrypted.startsWith('enc:v2:2026-11:')).toBeTruthy()
    expect(encrypted).not.toContain('server-seed')
    expect(encrypted).not.toBe(encryptSeed('server-seed', config))
    expect(decryptSeed(encrypted, config)).toBe('server-seed')
  })

  it('parses decimal amounts without floating-point arithmetic', () => {
    expect(parseAmount('1', 6)).toBe(1_000_000n)
    expect(parseAmount('1.25', 2)).toBe(125n)
    expect(parseAmount('0.000001', 6)).toBe(1n)
    expect(formatAmount(parseAmount('12.34', 2), 2)).toBe('12.34')
    expect(() => parseAmount('1.001', 2)).toThrow('2 decimal places')
  })
})

describe('dice request schemas', () => {
  it('validates bet input and history defaults', () => {
    expect(
      DiceBetInput.parse({
        amount: '10.00',
        clientSeed: 'client',
        direction: 'under',
        target: 50,
      }),
    ).toStrictEqual({
      amount: '10.00',
      clientSeed: 'client',
      direction: 'under',
      target: 50,
    })
    expect(DiceHistoryQuery.parse({})).toStrictEqual({ limit: 20 })
    expect(() =>
      DiceBetInput.parse({
        amount: '10.00',
        clientSeed: 'client',
        direction: 'over',
        target: 99,
      }),
    ).toThrow(/Too big/u)
  })
})

describe('dice routes', () => {
  it('guards dice player endpoints', async () => {
    const app = await build()
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(null)

    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/games/dice/seeds/active' }),
      app.inject({ method: 'POST', url: '/api/v1/games/dice/seeds/rotate' }),
      app.inject({ method: 'GET', url: '/api/v1/games/dice/bets' }),
      app.inject({
        method: 'GET',
        url: '/api/v1/games/dice/bets/00000000-0000-4000-8000-000000000000/verify',
      }),
    ])

    expect(responses.map((response) => response.statusCode)).toStrictEqual([
      401, 401, 401, 401,
    ])
  })

  it('validates the idempotency header and bet body', async () => {
    const app = await build()
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(null)

    const missingHeader = await app.inject({
      body: {
        amount: '10.00',
        clientSeed: 'client',
        direction: 'under',
        target: 50,
      },
      method: 'POST',
      url: '/api/v1/games/dice/bets',
    })
    const invalidTarget = await app.inject({
      body: {
        amount: '10.00',
        clientSeed: 'client',
        direction: 'under',
        target: 99,
      },
      headers: { 'idempotency-key': 'bet-1' },
      method: 'POST',
      url: '/api/v1/games/dice/bets',
    })

    expect(missingHeader.statusCode).toBe(400)
    expect(invalidTarget.statusCode).toBe(400)
  })
})
