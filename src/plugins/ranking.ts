import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

import { RankingRuntime } from '@/modules/ranking/runtime'

declare module 'fastify' {
  interface FastifyInstance {
    rankingRuntime: RankingRuntime
  }
}

function ranking(
  fastify: FastifyInstance,
  _options: unknown,
  done: (error?: Error) => void,
) {
  const runtime = new RankingRuntime(fastify.db, fastify.redis, fastify.log)
  fastify.decorate('rankingRuntime', runtime)

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

export default fp(ranking, { name: 'ranking' })
