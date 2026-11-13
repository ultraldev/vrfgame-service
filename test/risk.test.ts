import { build } from '@test/helper'
import { describe, expect, it, vi } from 'vitest'

import { CreateExclusion, UpdateLimits } from '@/modules/risk/schema'
import { dayBucket, riskRejected, weekBucket } from '@/modules/risk/util'

describe('risk helpers', () => {
  it('builds stable UTC day and week buckets', () => {
    const date = new Date('2026-11-13T23:30:00.000Z')
    expect(dayBucket(date)).toBe('2026-11-13')
    expect(weekBucket(date)).toBe('2026-W46')
    expect(weekBucket(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-W01')
  })

  it('validates exclusion periods', () => {
    expect(CreateExclusion.parse({ type: 'self_exclusion' })).toStrictEqual({
      type: 'self_exclusion',
    })
    expect(
      CreateExclusion.parse({ durationHours: 24, type: 'cooling_off' }),
    ).toStrictEqual({ durationHours: 24, type: 'cooling_off' })
    expect(() => CreateExclusion.parse({ type: 'cooling_off' })).toThrow(
      /durationHours/u,
    )
  })

  it('requires at least one limit and accepts clearing a cap', () => {
    expect(() => UpdateLimits.parse({ currency: 'USDT' })).toThrow(
      'At least one limit is required',
    )
    expect(
      UpdateLimits.parse({ currency: 'USDT', singleBetCap: null }),
    ).toStrictEqual({ currency: 'USDT', singleBetCap: null })
  })

  it('creates public risk rejection errors', () => {
    const error = riskRejected('self_excluded', 'Betting is blocked')
    expect(error.statusCode).toBe(403)
    expect(error.code).toBe('self_excluded')
    expect(error.message).toBe('Betting is blocked')
  })
})

describe('risk routes', () => {
  it('guards all risk endpoints', async () => {
    const app = await build()
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(null)

    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/risk/exclusions' }),
      app.inject({ method: 'GET', url: '/api/v1/risk/limits' }),
      app.inject({
        body: { durationHours: 24, type: 'cooling_off' },
        method: 'POST',
        url: '/api/v1/risk/exclusions',
      }),
      app.inject({
        body: { currency: 'USDT', singleBetCap: '10.00' },
        method: 'PATCH',
        url: '/api/v1/risk/limits',
      }),
    ])

    expect(responses.map((response) => response.statusCode)).toStrictEqual([
      401, 401, 401, 401,
    ])
  })

  it('rejects invalid risk requests before authentication', async () => {
    const app = await build()

    const invalidExclusion = await app.inject({
      body: { type: 'cooling_off' },
      method: 'POST',
      url: '/api/v1/risk/exclusions',
    })
    const emptyLimits = await app.inject({
      body: { currency: 'USDT' },
      method: 'PATCH',
      url: '/api/v1/risk/limits',
    })

    expect(invalidExclusion.statusCode).toBe(400)
    expect(emptyLimits.statusCode).toBe(400)
  })

  it('preserves public risk error codes in HTTP responses', async () => {
    const app = await build((instance) => {
      instance.get('/test/risk-rejection', () => {
        throw riskRejected('cooling_off', 'Betting is blocked')
      })
    })

    const response = await app.inject({
      method: 'GET',
      url: '/test/risk-rejection',
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toStrictEqual({
      code: 'cooling_off',
      error: 'Forbidden',
      message: 'Betting is blocked',
      statusCode: 403,
    })
  })
})
