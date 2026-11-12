import swagger from '@fastify/swagger'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
} from 'fastify-type-provider-zod'

function openapi(
  fastify: FastifyInstance,
  _options: unknown,
  done: (error?: Error) => void,
) {
  fastify.register(swagger, {
    openapi: {
      info: {
        description: 'VRF Game API contract',
        title: 'VRF Game Service',
        version: '1.0.0',
      },
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  })
  done()
}

export default fp(openapi, { name: 'openapi' })
