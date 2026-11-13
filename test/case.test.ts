import { build } from '@test/helper'
import { describe, expect, it, vi } from 'vitest'

import {
  caseUnitInterval,
  convertCratePayout,
  computeCrateRtpBps,
  crateMultiplier,
  pickCrateItemIndex,
} from '@/modules/case/util'

describe('case engine', () => {
  it('creates a deterministic unit interval', () => {
    expect(caseUnitInterval('server', 'client', 7)).toBe(
      caseUnitInterval('server', 'client', 7),
    )
    expect(caseUnitInterval('server', 'client', 7)).toBeGreaterThanOrEqual(0)
    expect(caseUnitInterval('server', 'client', 7)).toBeLessThan(1)
  })

  it('picks weighted drop table items', () => {
    const items = [{ weight: 1 }, { weight: 3 }]
    expect(pickCrateItemIndex(items, 0)).toBe(0)
    expect(pickCrateItemIndex(items, 0.2499)).toBe(0)
    expect(pickCrateItemIndex(items, 0.25)).toBe(1)
    expect(pickCrateItemIndex(items, 0.9999)).toBe(1)
  })

  it('converts payouts and computes RTP in integer minor units', () => {
    expect(convertCratePayout(500n, 100n, 250n)).toBe(1250n)
    expect(
      computeCrateRtpBps(
        [
          { payout: 100n, weight: 1 },
          { payout: 0n, weight: 1 },
        ],
        100n,
      ),
    ).toBe(5000)
    expect(crateMultiplier(250n, 100n)).toBe('2.50')
  })
})

describe('case routes', () => {
  it('guards player-specific endpoints', async () => {
    const app = await build()
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(null)
    const openId = '00000000-0000-4000-8000-000000000000'
    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/case-seeds/active' }),
      app.inject({ method: 'POST', url: '/api/v1/case-seeds/rotate' }),
      app.inject({
        body: { clientSeed: 'client', crateSlug: 'starter' },
        headers: { 'idempotency-key': 'open-1' },
        method: 'POST',
        url: '/api/v1/case-opens',
      }),
      app.inject({
        body: { clientSeed: 'client', count: 2, crateSlug: 'starter' },
        headers: { 'idempotency-key': 'batch-1' },
        method: 'POST',
        url: '/api/v1/case-opens/batch',
      }),
      app.inject({ method: 'GET', url: '/api/v1/case-opens' }),
      app.inject({
        method: 'GET',
        url: `/api/v1/case-opens/${openId}/verify`,
      }),
    ])

    expect(responses.map((response) => response.statusCode)).toStrictEqual([
      401, 401, 401, 401, 401, 401,
    ])
  })

  it('validates public crate queries', async () => {
    const app = await build()
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/crates?limit=51',
    })
    expect(response.statusCode).toBe(400)
  })
})
