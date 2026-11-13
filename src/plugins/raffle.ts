import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

import { RaffleRuntime } from '@/modules/raffle/runtime'

declare module 'fastify' {
  interface FastifyInstance {
    raffle: RaffleRuntime
  }
}

function raffle(
  fastify: FastifyInstance,
  _options: unknown,
  done: (error?: Error) => void,
) {
  const runtime = new RaffleRuntime(
    fastify.db,
    fastify.redis,
    fastify.config,
    fastify.log,
  )
  fastify.decorate('raffle', runtime)

  fastify.addHook('onReady', async () => {
    if (fastify.config.NODE_ENV !== 'test') {
      await runtime.start()
    }
  })
  fastify.addHook('onClose', async () => {
    await runtime.stop()
  })
  done()
}

export default fp(raffle, { name: 'raffle' })
