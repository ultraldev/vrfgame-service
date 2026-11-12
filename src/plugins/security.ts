import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

function security(
  fastify: FastifyInstance,
  _options: unknown,
  done: (error?: Error) => void,
) {
  fastify.register(cors, {
    credentials: true,
    origin: fastify.config.TRUSTED_ORIGINS,
  })
  fastify.register(helmet)
  fastify.register(rateLimit, {
    global: true,
    max: 200,
    redis: fastify.config.NODE_ENV === 'test' ? undefined : fastify.redis,
    timeWindow: 60_000,
  })
  done()
}

export default fp(security, { name: 'security' })
