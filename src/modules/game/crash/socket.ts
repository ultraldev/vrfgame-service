import type { FastifyInstance } from 'fastify'

import type { AppSocket } from '@/lib/socket'
import {
  checkSocketRateLimit,
  requireSocketSession,
  socketAckError,
} from '@/lib/socket'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import { CrashSocketBetInput } from '@/modules/game/crash/schema'
import {
  cancelCrashBet,
  cashOutCrashBet,
  placeCrashBet,
} from '@/modules/game/crash/service'

type Ack = (response: unknown) => void

export function registerCrashSocket(fastify: FastifyInstance) {
  const io = fastify.io
  if (!io) {
    return
  }

  io.on('connection', (client: AppSocket) => {
    void (async () => {
      try {
        client.emit(SOCKET_EVENTS.snapshot, await fastify.crash.getSnapshot())
      } catch (error) {
        fastify.log.warn({ err: error }, 'Failed to emit crash snapshot')
      }
    })()

    client.on(SOCKET_EVENTS.getSnapshot, async () => {
      try {
        client.emit(SOCKET_EVENTS.snapshot, await fastify.crash.getSnapshot())
      } catch (error) {
        fastify.log.warn({ err: error }, 'Failed to emit crash snapshot')
      }
    })

    client.on(SOCKET_EVENTS.bet, async (body: unknown, ack: Ack) => {
      try {
        const user = requireSocketSession(client).user
        if (
          !(await checkSocketRateLimit(fastify, `crash:bet:${user.id}`, 10))
        ) {
          ack({
            error: {
              code: 'TooManyRequests',
              message: 'Crash bet rate limit exceeded',
            },
            ok: false,
          })
          return
        }
        const parsed = CrashSocketBetInput.safeParse(body)
        if (!parsed.success) {
          ack({
            error: {
              code: 'ValidationError',
              message: 'Invalid crash bet input',
            },
            ok: false,
          })
          return
        }
        const data = await placeCrashBet(
          fastify.db,
          fastify.config,
          fastify.crash,
          user.id,
          parsed.data,
        )
        ack({ data, ok: true })
      } catch (error) {
        ack(socketAckError(error))
      }
    })

    client.on(SOCKET_EVENTS.cancel, async (_body: unknown, ack: Ack) => {
      try {
        const user = requireSocketSession(client).user
        if (
          !(await checkSocketRateLimit(fastify, `crash:cancel:${user.id}`, 20))
        ) {
          ack({
            error: {
              code: 'TooManyRequests',
              message: 'Crash cancel rate limit exceeded',
            },
            ok: false,
          })
          return
        }
        ack({
          data: await cancelCrashBet(fastify.db, fastify.crash, user.id),
          ok: true,
        })
      } catch (error) {
        ack(socketAckError(error))
      }
    })

    client.on(SOCKET_EVENTS.cashout, async (_body: unknown, ack: Ack) => {
      try {
        const user = requireSocketSession(client).user
        if (
          !(await checkSocketRateLimit(fastify, `crash:cashout:${user.id}`, 20))
        ) {
          ack({
            error: {
              code: 'TooManyRequests',
              message: 'Crash cashout rate limit exceeded',
            },
            ok: false,
          })
          return
        }
        const snapshot = await fastify.crash.getSnapshot()
        const bet = await fastify.db.query.gameBet.findFirst({
          where: (table, { and, eq, sql }) =>
            and(
              eq(table.userId, user.id),
              eq(table.status, 'active'),
              sql`${table.result} ->> 'roundId' = ${snapshot.currentRound.id}`,
            ),
        })
        if (!bet) {
          throw Object.assign(new Error('No active crash bet found'), {
            statusCode: 404,
          })
        }
        ack({
          data: await cashOutCrashBet(
            fastify.db,
            fastify.config,
            fastify.crash,
            user.id,
            bet.id,
          ),
          ok: true,
        })
      } catch (error) {
        ack(socketAckError(error))
      }
    })
  })
}
