import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

import type { AppConfig } from '@/lib/config'

interface Options {
  config: AppConfig
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig
  }
}

function config(
  fastify: FastifyInstance,
  options: Options,
  done: (error?: Error) => void,
) {
  fastify.decorate('config', options.config)
  done()
}

export default fp(config, { name: 'config' })
