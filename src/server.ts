import type { FastifyInstance } from 'fastify'

import { buildApp } from '@/app'
import { loadConfig } from '@/lib/config'

async function start() {
  const config = loadConfig()
  const app = await buildApp({ config })
  let shuttingDown = false

  async function shutdown(
    application: FastifyInstance,
    signal: NodeJS.Signals,
  ) {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    application.log.info({ signal }, `shutting down (${signal})`)
    await application.close()
  }

  process.once('SIGINT', () => {
    void shutdown(app, 'SIGINT')
  })
  process.once('SIGTERM', () => {
    void shutdown(app, 'SIGTERM')
  })

  await app.listen({ host: config.HOST, port: config.PORT })
}

await start()
