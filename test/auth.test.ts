import { build } from '@test/helper'
import { describe, expect, it, vi } from 'vitest'

function session(user: Record<string, unknown> = {}) {
  const now = new Date()
  return {
    session: {
      createdAt: now,
      expiresAt: new Date(now.getTime() + 86_400_000),
      id: 'session-1',
      impersonatedBy: null,
      ipAddress: null,
      token: 'token-1',
      updatedAt: now,
      userAgent: null,
      userId: 'user-1',
    },
    user: {
      createdAt: now,
      email: 'user@example.com',
      emailVerified: true,
      id: 'user-1',
      image: null,
      name: 'Test User',
      updatedAt: now,
      ...user,
    },
  }
}

describe('auth', () => {
  it('allows anonymous optional requests', async () => {
    const app = await build((instance) => {
      instance.get(
        '/test/optional',
        { preHandler: instance.auth.optional },
        (request) => ({ userId: request.user?.id ?? null }),
      )
    })
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(null)

    const response = await app.inject({
      method: 'GET',
      url: '/test/optional',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toStrictEqual({ userId: null })
  })

  it('rejects required requests without a session', async () => {
    const app = await build((instance) => {
      instance.get(
        '/test/required',
        { preHandler: instance.auth.required },
        () => ({ ok: true }),
      )
    })
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(null)

    const response = await app.inject({
      method: 'GET',
      url: '/test/required',
    })

    expect(response.statusCode).toBe(401)
  })

  it('loads the current user for required requests', async () => {
    const app = await build((instance) => {
      instance.get(
        '/test/required',
        { preHandler: instance.auth.required },
        (request) => {
          const { session: currentSession, user } =
            instance.auth.session(request)
          return { sessionId: currentSession.id, userId: user.id }
        },
      )
    })
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(session() as never)

    const response = await app.inject({
      method: 'GET',
      url: '/test/required',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toStrictEqual({
      sessionId: 'session-1',
      userId: 'user-1',
    })
  })

  it('rejects missing auth context', async () => {
    const app = await build((instance) => {
      instance.get('/test/session', (request) => {
        const { user } = instance.auth.session(request)
        return { userId: user.id }
      })
    })

    const response = await app.inject({
      method: 'GET',
      url: '/test/session',
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toStrictEqual({
      error: 'Unauthorized',
      message: 'Authentication required',
      statusCode: 401,
    })
  })

  it('enforces role requirements', async () => {
    const app = await build((instance) => {
      instance.get(
        '/test/admin',
        { preHandler: instance.auth.roles(['admin']) },
        () => ({ ok: true }),
      )
    })
    vi.spyOn(app.auth.api, 'getSession')
      .mockResolvedValueOnce(session({ role: 'user' }) as never)
      .mockResolvedValueOnce(session({ role: 'admin' }) as never)

    const denied = await app.inject({ method: 'GET', url: '/test/admin' })
    const allowed = await app.inject({ method: 'GET', url: '/test/admin' })

    expect(denied.statusCode).toBe(403)
    expect(allowed.statusCode).toBe(200)
  })

  it('rejects banned users', async () => {
    const app = await build((instance) => {
      instance.get(
        '/test/required',
        { preHandler: instance.auth.required },
        () => ({ ok: true }),
      )
    })
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(
      session({ banReason: 'fraud', banned: true }) as never,
    )

    const response = await app.inject({
      method: 'GET',
      url: '/test/required',
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ code: 'user_banned' })
  })

  it('rejects expired virtual accounts', async () => {
    const app = await build((instance) => {
      instance.get(
        '/test/required',
        { preHandler: instance.auth.required },
        () => ({ ok: true }),
      )
    })
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(
      session({
        fundMode: 'virtual',
        operatorExpiresAt: new Date(Date.now() - 1000),
      }) as never,
    )

    const response = await app.inject({
      method: 'GET',
      url: '/test/required',
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      code: 'virtual_account_expired',
    })
  })
})
