import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

import { CrashRuntime } from '@/modules/game/crash/runtime'

declare module 'fastify' {
  interface FastifyInstance {
    crash: CrashRuntime
  }
}

function crash(
  fastify: FastifyInstance,
  _options: unknown,
  done: (error?: Error) => void,
) {
  const runtime = new CrashRuntime(
    fastify.db,
    fastify.redis,
    fastify.config,
    fastify.log,
  )
  fastify.decorate('crash', runtime)

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

export default fp(crash, { name: 'crash' })
