import type { FastifyInstance } from 'fastify'

import auth from '@/modules/auth/routes'
import lobby from '@/modules/lobby/routes'
import ranking from '@/modules/ranking/routes'
import wallet from '@/modules/wallet/routes'
import health from '@/routes/health'

export async function registerRoutes(app: FastifyInstance) {
  await app.register(auth)
  await app.register(health)
  await app.register(lobby)
  await app.register(ranking)
  await app.register(wallet)
}
