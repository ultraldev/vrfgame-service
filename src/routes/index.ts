import type { FastifyInstance } from 'fastify'

import auth from '@/modules/auth/routes'
import caseRoutes from '@/modules/case/routes'
import crash from '@/modules/game/crash/routes'
import dice from '@/modules/game/dice/routes'
import hilo from '@/modules/game/hilo/routes'
import mines from '@/modules/game/mines/routes'
import plinko from '@/modules/game/plinko/routes'
import game from '@/modules/game/routes'
import wheel from '@/modules/game/wheel/routes'
import lobby from '@/modules/lobby/routes'
import { registerPaymentRoutes } from '@/modules/payments/routes'
import raffle from '@/modules/raffle/routes'
import ranking from '@/modules/ranking/routes'
import risk from '@/modules/risk/routes'
import wallet from '@/modules/wallet/routes'
import health from '@/routes/health'

export async function registerRoutes(app: FastifyInstance) {
  await app.register(auth)
  await app.register(health)
  await app.register(caseRoutes)
  await app.register(game)
  await app.register(crash)
  await app.register(dice)
  await app.register(hilo)
  await app.register(mines)
  await app.register(plinko)
  await app.register(wheel)
  await app.register(lobby)
  await registerPaymentRoutes(app)
  await app.register(raffle)
  await app.register(ranking)
  await app.register(risk)
  await app.register(wallet)
}
