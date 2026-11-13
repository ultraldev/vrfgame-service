import sensible from '@fastify/sensible'
import type { FastifyInstance } from 'fastify'

import type { AppConfig } from '@/lib/config'
import auth from '@/plugins/auth'
import config from '@/plugins/config'
import crash from '@/plugins/crash'
import database from '@/plugins/database'
import errors from '@/plugins/errors'
import openapi from '@/plugins/openapi'
import payments from '@/plugins/payments'
import raffle from '@/plugins/raffle'
import ranking from '@/plugins/ranking'
import redis from '@/plugins/redis'
import request from '@/plugins/request'
import security from '@/plugins/security'
import socket from '@/plugins/socket'

export async function registerPlugins(
  app: FastifyInstance,
  settings: AppConfig,
) {
  await app.register(config, { config: settings })
  await app.register(database, {
    connectionString: settings.DATABASE_URL,
  })
  await app.register(redis, { url: settings.REDIS_URL })
  await app.register(security)
  await app.register(sensible)
  await app.register(auth)
  await app.register(crash)
  await app.register(raffle)
  await app.register(ranking)
  await app.register(payments)
  await app.register(socket)
  await app.register(errors)
  await app.register(request)
  await app.register(openapi)
}
