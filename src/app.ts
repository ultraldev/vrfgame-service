import Fastify from 'fastify'
import type { FastifyServerOptions } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod'

import { loadConfig } from '@/lib/config'
import type { AppConfig } from '@/lib/config'
import { createFastifyOptions } from '@/lib/fastify'
import { registerPlugins } from '@/plugins'
import { registerRoutes } from '@/routes'

export interface BuildAppOptions {
  config?: AppConfig
  fastify?: FastifyServerOptions
}

export async function buildApp(input: BuildAppOptions = {}) {
  const settings = input.config ?? loadConfig()
  const app = Fastify(createFastifyOptions(settings, input.fastify))
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await registerPlugins(app, settings)
  await registerRoutes(app)

  return app
}

export default buildApp
