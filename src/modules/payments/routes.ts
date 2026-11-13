import type { FastifyInstance } from 'fastify'

import cryptoRoutes from './crypto/routes'
import fiatRoutes from './fiat/routes'

export async function registerPaymentRoutes(app: FastifyInstance) {
  await app.register(cryptoRoutes)
  await app.register(fiatRoutes)
}
