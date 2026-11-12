import { config } from 'dotenv'
import type { FastifyInstance } from 'fastify'
import { onTestFinished } from 'vitest'

import { buildApp } from '@/app'
import { loadConfig } from '@/lib/config'

export async function build(configure?: (app: FastifyInstance) => void) {
  config({ override: true, path: '.env.test', quiet: true })
  const settings = loadConfig(process.env)
  const app = await buildApp({ config: settings })
  configure?.(app)
  await app.ready()

  async function closeFastify() {
    await app.close()
  }

  onTestFinished(closeFastify)

  return app
}
