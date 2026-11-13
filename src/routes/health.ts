import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { Failure, Health, Ready } from '@/lib/schemas'

const HEALTH = '/healthz'
const READY = '/readyz'

function health(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
  done: (error?: Error) => void,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.route({
    handler: () => ({ status: 'ok' as const }),
    method: 'GET',
    schema: {
      operationId: 'health',
      response: {
        200: Health,
        500: Failure,
      },
    },
    url: HEALTH,
  })

  app.route({
    config: {
      rateLimit: false,
    },
    handler: async (_request, reply) => {
      const [database, redis] = await Promise.allSettled([
        fastify.pool.query('select 1'),
        fastify.redis.ping(),
      ])
      const checks = {
        database: database.status === 'fulfilled' ? 'ok' : 'error',
        redis: redis.status === 'fulfilled' ? 'ok' : 'error',
      } as const

      if (database.status === 'rejected' || redis.status === 'rejected') {
        return reply.code(503).send({ checks, status: 'error' })
      }

      return { checks, status: 'ok' as const }
    },
    method: 'GET',
    schema: {
      operationId: 'ready',
      response: {
        200: Ready,
        500: Failure,
        503: Ready,
      },
    },
    url: READY,
  })
  done()
}

export default health
