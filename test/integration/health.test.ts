import { build } from '@test/helper'
import { describe, expect, it, vi } from 'vitest'

describe('health route', () => {
  it('returns process liveness from /healthz', async () => {
    const app = await build()

    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toStrictEqual({ status: 'ok' })
    expect(app.config.NODE_ENV).toBe('test')
  })

  it('preserves a valid request id', async () => {
    const app = await build()

    const response = await app.inject({
      headers: { 'x-request-id': 'request-123' },
      method: 'GET',
      url: '/healthz',
    })

    expect(response.headers['x-request-id']).toBe('request-123')
  })

  it('replaces an invalid request id', async () => {
    const app = await build()

    const response = await app.inject({
      headers: { 'x-request-id': 'invalid request id' },
      method: 'GET',
      url: '/healthz',
    })

    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    )
  })

  it('returns 404 for unknown routes', async () => {
    const app = await build()

    const response = await app.inject({
      method: 'GET',
      url: '/missing',
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toStrictEqual({
      error: 'Not Found',
      message: 'Not Found',
      statusCode: 404,
    })
  })

  it('reports ready when database and redis respond', async () => {
    const app = await build()
    vi.spyOn(app.pool, 'query').mockResolvedValue(undefined)
    vi.spyOn(app.redis, 'ping').mockResolvedValue('PONG')

    const response = await app.inject({
      method: 'GET',
      url: '/readyz',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toStrictEqual({
      checks: {
        database: 'ok',
        redis: 'ok',
      },
      status: 'ok',
    })
  })

  it('reports unavailable when a dependency fails', async () => {
    const app = await build()
    vi.spyOn(app.pool, 'query').mockRejectedValue(new Error('database down'))
    vi.spyOn(app.redis, 'ping').mockResolvedValue('PONG')

    const response = await app.inject({
      method: 'GET',
      url: '/readyz',
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toStrictEqual({
      checks: {
        database: 'error',
        redis: 'ok',
      },
      status: 'error',
    })
  })
})
