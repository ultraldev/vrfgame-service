import type { FastifyInstance } from 'fastify'
import type { DefaultEventsMap, Socket, Server } from 'socket.io'

import type { Auth } from '@/lib/auth'

export type AuthSession = Auth['$Infer']['Session']
export interface SocketData {
  session?: AuthSession
}

export type AppSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>
export type AppSocketServer = Server<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>

export function socketAckError(error: unknown) {
  if (!(error instanceof Error)) {
    return {
      error: { code: 'unknown_error', message: 'Unknown error' },
      ok: false as const,
    }
  }

  const details = error as Error & {
    code?: string
    statusCode?: number
  }
  const statusCode = details.statusCode ?? 500
  let message = error.message
  if (statusCode >= 500) {
    message = 'Internal Server Error'
  }
  return {
    error: {
      code: details.code ?? `HTTP_${statusCode}`,
      message,
    },
    ok: false as const,
  }
}

export function requireSocketSession(client: AppSocket) {
  const session = client.data.session
  if (!session) {
    throw Object.assign(new Error('Authentication required'), {
      code: 'Unauthorized',
      statusCode: 401,
    })
  }
  return session
}

export async function checkSocketRateLimit(
  fastify: FastifyInstance,
  key: string,
  limit: number,
) {
  const bucket = Math.floor(Date.now() / 60_000)
  const redisKey = `ws:rate:${key}:${bucket}`
  const hits = await fastify.redis.incr(redisKey)
  if (hits === 1) {
    await fastify.redis.expire(redisKey, 60)
  }
  return hits <= limit
}
