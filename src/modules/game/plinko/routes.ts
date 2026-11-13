import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { API_PREFIX } from '@/lib/api'
import { Failure } from '@/lib/schemas'

import {
  PlinkoActiveSeed,
  PlinkoBet,
  PlinkoBetHeaders,
  PlinkoBetInput,
  PlinkoBetList,
  PlinkoBetParams,
  PlinkoHistoryQuery,
  PlinkoSeedRotation,
  PlinkoVerification,
} from './schema'
import {
  getPlinkoActiveSeed,
  listPlinkoBets,
  placePlinkoBet,
  rotatePlinkoSeed,
  verifyPlinkoBet,
} from './service'

const PREFIX = `${API_PREFIX}/games/plinko`
const failures = {
  400: Failure,
  401: Failure,
  403: Failure,
  404: Failure,
  409: Failure,
  500: Failure,
  503: Failure,
}

function routes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
  done: (error?: Error) => void,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return getPlinkoActiveSeed(fastify.db, fastify.config, user.id)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'getPlinkoActiveSeed',
      response: { 200: PlinkoActiveSeed, ...failures },
    },
    url: `${PREFIX}/seeds/active`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply
        .code(201)
        .send(await rotatePlinkoSeed(fastify.db, fastify.config, user.id))
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'rotatePlinkoSeed',
      response: { 201: PlinkoSeedRotation, ...failures },
    },
    url: `${PREFIX}/seeds/rotate`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply.code(201).send(
        await placePlinkoBet(fastify.db, fastify.config, user.id, {
          ...request.body,
          idempotencyKey: request.headers['idempotency-key'],
        }),
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      body: PlinkoBetInput,
      headers: PlinkoBetHeaders,
      operationId: 'placePlinkoBet',
      response: { 201: PlinkoBet, ...failures },
    },
    url: `${PREFIX}/bets`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return listPlinkoBets(fastify.db, user.id, request.query)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listPlinkoBets',
      querystring: PlinkoHistoryQuery,
      response: { 200: PlinkoBetList, ...failures },
    },
    url: `${PREFIX}/bets`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return verifyPlinkoBet(
        fastify.db,
        fastify.config,
        user.id,
        request.params.betId,
      )
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'verifyPlinkoBet',
      params: PlinkoBetParams,
      response: { 200: PlinkoVerification, ...failures },
    },
    url: `${PREFIX}/bets/:betId/verify`,
  })

  done()
}

export default routes
