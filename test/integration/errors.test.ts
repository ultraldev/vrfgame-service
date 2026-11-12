import { build } from '@test/helper'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

describe('error handling', () => {
  it('preserves sensible http errors', async () => {
    const app = await build((instance) => {
      instance.get('/test/conflict', () => {
        throw instance.httpErrors.conflict('Already exists')
      })
    })

    const response = await app.inject({
      method: 'GET',
      url: '/test/conflict',
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toStrictEqual({
      error: 'Conflict',
      message: 'Already exists',
      statusCode: 409,
    })
  })

  it('maps unique violations to conflict', async () => {
    const app = await build((instance) => {
      instance.get('/test/database', () => {
        throw Object.assign(new Error('duplicate key'), { code: '23505' })
      })
    })

    const response = await app.inject({
      method: 'GET',
      url: '/test/database',
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toStrictEqual({
      error: 'Conflict',
      message: 'Resource already exists',
      statusCode: 409,
    })
  })

  it('maps retryable database errors to service unavailable', async () => {
    const app = await build((instance) => {
      instance.get('/test/retry', () => {
        throw Object.assign(new Error('deadlock'), { code: '40P01' })
      })
    })

    const response = await app.inject({
      method: 'GET',
      url: '/test/retry',
    })

    expect(response.statusCode).toBe(503)
    expect(response.headers['retry-after']).toBe('1')
    expect(response.json()).toStrictEqual({
      error: 'Service Unavailable',
      message: 'Database operation should be retried',
      statusCode: 503,
    })
  })

  it('hides unknown error details', async () => {
    const app = await build((instance) => {
      instance.get('/test/unknown', () => {
        throw new Error('internal database details')
      })
    })

    const response = await app.inject({
      method: 'GET',
      url: '/test/unknown',
    })

    expect(response.statusCode).toBe(500)
    expect(response.body).not.toContain('internal database details')
    expect(response.json()).toStrictEqual({
      error: 'Internal Server Error',
      message: 'Internal Server Error',
      statusCode: 500,
    })
  })

  it('rejects invalid request schemas', async () => {
    const app = await build((instance) => {
      const typed = instance.withTypeProvider<ZodTypeProvider>()
      typed.get(
        '/test/validation',
        {
          schema: {
            querystring: z.object({
              count: z.coerce.number().int().positive(),
            }),
          },
        },
        () => ({ ok: true }),
      )
    })

    const response = await app.inject({
      method: 'GET',
      url: '/test/validation?count=invalid',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toStrictEqual({
      error: 'Bad Request',
      message: 'Request validation failed',
      statusCode: 400,
    })
  })
})
