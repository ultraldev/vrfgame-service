import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import Redis from 'ioredis'

interface Options {
  url: string
}

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis
    redisSubscriber: Redis
  }
}

function redis(
  fastify: FastifyInstance,
  options: Options,
  done: (error?: Error) => void,
) {
  const client = new Redis(options.url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  })
  const subscriber = new Redis(options.url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  })

  fastify.decorate('redis', client)
  fastify.decorate('redisSubscriber', subscriber)
  fastify.addHook('onClose', () => {
    client.disconnect()
    subscriber.disconnect()
  })
  done()
}

export default fp(redis, { name: 'redis' })
