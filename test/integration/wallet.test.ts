import { build } from '@test/helper'
import { describe, expect, it } from 'vitest'

describe('wallet routes', () => {
  it('requires authentication for transaction history', async () => {
    const app = await build()

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/wallet/transactions',
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toStrictEqual({
      error: 'Unauthorized',
      message: 'Authentication required',
      statusCode: 401,
    })
  })

  it('rejects unsupported transaction filters', async () => {
    const app = await build()

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/wallet/transactions?limit=101',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toStrictEqual({
      error: 'Bad Request',
      message: 'Request validation failed',
      statusCode: 400,
    })
  })
})
