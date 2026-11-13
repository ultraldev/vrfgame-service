import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { API_PREFIX } from '@/lib/api'
import { Failure } from '@/lib/schemas'

import {
  DiceActiveSeed,
  DiceBet,
  DiceBetHeaders,
  DiceBetInput,
  DiceBetList,
  DiceBetParams,
  DiceHistoryQuery,
  DiceSeedRotation,
  DiceVerification,
} from './schema'
import {
  getDiceActiveSeed,
  listDiceBets,
  placeDiceBet,
  rotateDiceSeed,
  verifyDiceBet,
} from './service'

const PREFIX = `${API_PREFIX}/games/dice`
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
      return getDiceActiveSeed(fastify.db, fastify.config, user.id)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'getDiceActiveSeed',
      response: { 200: DiceActiveSeed, ...failures },
    },
    url: `${PREFIX}/seeds/active`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply
        .code(201)
        .send(await rotateDiceSeed(fastify.db, fastify.config, user.id))
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'rotateDiceSeed',
      response: { 201: DiceSeedRotation, ...failures },
    },
    url: `${PREFIX}/seeds/rotate`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply.code(201).send(
        await placeDiceBet(fastify.db, fastify.config, user.id, {
          ...request.body,
          idempotencyKey: request.headers['idempotency-key'],
        }),
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      body: DiceBetInput,
      headers: DiceBetHeaders,
      operationId: 'placeDiceBet',
      response: { 201: DiceBet, ...failures },
    },
    url: `${PREFIX}/bets`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return listDiceBets(fastify.db, user.id, request.query)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listDiceBets',
      querystring: DiceHistoryQuery,
      response: { 200: DiceBetList, ...failures },
    },
    url: `${PREFIX}/bets`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return verifyDiceBet(
        fastify.db,
        fastify.config,
        user.id,
        request.params.betId,
      )
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'verifyDiceBet',
      params: DiceBetParams,
      response: { 200: DiceVerification, ...failures },
    },
    url: `${PREFIX}/bets/:betId/verify`,
  })
  done()
}

export default routes
