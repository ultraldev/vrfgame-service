import { fromNodeHeaders } from 'better-auth/node'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'

import { createAuth } from '@/lib/auth'
import type { Auth } from '@/lib/auth'

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
type AuthSession = Auth['$Infer']['Session']

declare module 'fastify' {
  interface FastifyInstance {
    auth: {
      api: Auth['api']
      instance: Auth
      optional: Guard
      required: Guard
      roles: (roles: string[]) => Guard
      session: (request: FastifyRequest) => AuthSession
    }
  }

  interface FastifyRequest {
    session: AuthSession['session'] | null
    user: AuthSession['user'] | null
  }
}

function auth(
  fastify: FastifyInstance,
  _options: unknown,
  done: (error?: Error) => void,
) {
  const instance = createAuth(fastify.db, fastify.config)

  async function optional(request: FastifyRequest) {
    const result = await instance.api.getSession({
      headers: fromNodeHeaders(request.headers),
    })

    request.session = result?.session ?? null
    request.user = result?.user ?? null

    if (!request.user) {
      return
    }

    if (
      request.user.fundMode === 'virtual' &&
      request.user.operatorExpiresAt &&
      new Date(request.user.operatorExpiresAt).getTime() <= Date.now()
    ) {
      throw Object.assign(
        fastify.httpErrors.forbidden('This operator account has expired'),
        { code: 'virtual_account_expired' },
      )
    }

    if (
      request.user.banned &&
      (!request.user.banExpires ||
        new Date(request.user.banExpires).getTime() > Date.now())
    ) {
      throw Object.assign(
        fastify.httpErrors.forbidden(
          request.user.banReason
            ? `Account is banned: ${request.user.banReason}`
            : 'Account is banned',
        ),
        { code: 'user_banned' },
      )
    }
  }

  async function required(request: FastifyRequest, reply: FastifyReply) {
    await optional(request)
    if (!request.user) {
      return reply.unauthorized('Authentication required')
    }
  }

  function session(request: FastifyRequest) {
    const currentSession = request.session
    const currentUser = request.user
    if (!currentSession || !currentUser) {
      throw fastify.httpErrors.unauthorized('Authentication required')
    }
    return { session: currentSession, user: currentUser }
  }

  function roles(allowedRoles: string[]): Guard {
    return async function role(request, reply) {
      await required(request, reply)
      if (!request.user) {
        return
      }
      if (!allowedRoles.includes(request.user.role ?? '')) {
        return reply.forbidden('Insufficient permissions')
      }
    }
  }

  fastify.decorateRequest('session', null)
  fastify.decorateRequest('user', null)
  fastify.decorate('auth', {
    api: instance.api,
    instance,
    optional,
    required,
    roles,
    session,
  })
  done()
}

export default fp(auth, { name: 'auth' })
