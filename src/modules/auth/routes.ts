import { fromNodeHeaders } from 'better-auth/node'
import type { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { API_PREFIX } from '@/lib/api'

function routes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
  done: (error?: Error) => void,
) {
  fastify.route({
    handler: async (request, reply) => {
      const url = new URL(request.url, fastify.config.BETTER_AUTH_URL)
      const headers = fromNodeHeaders(request.headers)
      const body =
        request.body === undefined ? undefined : JSON.stringify(request.body)

      const response = await fastify.auth.instance.handler(
        new Request(url, {
          body,
          headers,
          method: request.method,
        }),
      )

      reply.code(response.status)
      for (const [key, value] of response.headers) {
        reply.header(key, value)
      }
      return reply.send(response.body ? await response.text() : null)
    },
    method: ['GET', 'POST'],
    schema: {
      hide: true,
    },
    url: `${API_PREFIX}/auth/*`,
  })
  done()
}

export default routes
