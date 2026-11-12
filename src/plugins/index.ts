import sensible from '@fastify/sensible'
import type { FastifyInstance } from 'fastify'

import type { AppConfig } from '@/lib/config'
import auth from '@/plugins/auth'
import config from '@/plugins/config'
import database from '@/plugins/database'
import errors from '@/plugins/errors'
import openapi from '@/plugins/openapi'
import redis from '@/plugins/redis'
import request from '@/plugins/request'
import security from '@/plugins/security'

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
  await app.register(errors)
  await app.register(request)
  await app.register(openapi)
}
