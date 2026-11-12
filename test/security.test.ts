import { build } from '@test/helper'
import { describe, expect, it, vi } from 'vitest'

describe('security', () => {
  it('allows configured cors origins with credentials', async () => {
    const app = await build()
    const origin = app.config.TRUSTED_ORIGINS[0] ?? ''

    const response = await app.inject({
      headers: { origin },
      method: 'GET',
      url: '/healthz',
    })

    expect(response.headers['access-control-allow-origin']).toBe(origin)
    expect(response.headers['access-control-allow-credentials']).toBe('true')
  })

  it('omits cors headers for unknown origins', async () => {
    const app = await build()

    const response = await app.inject({
      headers: { origin: 'https://unknown.example' },
      method: 'GET',
      url: '/healthz',
    })

    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('adds helmet security headers', async () => {
    const app = await build()

    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
    })

    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })

  it('limits requests and returns retry information', async () => {
    const app = await build((instance) => {
      instance.get(
        '/test/limit',
        {
          config: {
            rateLimit: {
              max: 2,
              timeWindow: 60_000,
            },
          },
        },
        () => ({ ok: true }),
      )
    })

    await app.inject({ method: 'GET', url: '/test/limit' })
    await app.inject({ method: 'GET', url: '/test/limit' })
    const response = await app.inject({
      method: 'GET',
      url: '/test/limit',
    })

    expect(response.statusCode).toBe(429)
    expect(response.headers['retry-after']).toBeDefined()
    expect(response.json()).toStrictEqual({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded, retry in 1 minute',
      statusCode: 429,
    })
  })

  it('does not rate limit readiness', async () => {
    const app = await build()
    vi.spyOn(app.pool, 'query').mockResolvedValue(undefined)
    vi.spyOn(app.redis, 'ping').mockResolvedValue('PONG')

    const response = await app.inject({
      method: 'GET',
      url: '/readyz',
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['x-ratelimit-limit']).toBeUndefined()
  })

  it('rejects request bodies above 2MB', async () => {
    const app = await build((instance) => {
      instance.post('/test/body', () => ({ ok: true }))
    })
    const payload = `{"data":"${'a'.repeat(2 * 1024 * 1024)}"}`

    const response = await app.inject({
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      payload,
      url: '/test/body',
    })

    expect(response.statusCode).toBe(413)
  })
})
