import type { FastifyInstance } from 'fastify'

import { registerCrashSocket } from '@/modules/game/crash/socket'

export function registerRealtime(fastify: FastifyInstance) {
  registerCrashSocket(fastify)
}
