import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { API_PREFIX } from '@/lib/api'
import { Failure } from '@/lib/schemas'

import {
  WheelActiveSeed,
  WheelBet,
  WheelBetHeaders,
  WheelBetInput,
  WheelBetList,
  WheelBetParams,
  WheelHistoryQuery,
  WheelSeedRotation,
  WheelVerification,
} from './schema'
import {
  getWheelActiveSeed,
  listWheelBets,
  placeWheelBet,
  rotateWheelSeed,
  verifyWheelBet,
} from './service'

const PREFIX = `${API_PREFIX}/games/wheel`
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
      return getWheelActiveSeed(fastify.db, fastify.config, user.id)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'getWheelActiveSeed',
      response: { 200: WheelActiveSeed, ...failures },
    },
    url: `${PREFIX}/seeds/active`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply
        .code(201)
        .send(await rotateWheelSeed(fastify.db, fastify.config, user.id))
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'rotateWheelSeed',
      response: { 201: WheelSeedRotation, ...failures },
    },
    url: `${PREFIX}/seeds/rotate`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply.code(201).send(
        await placeWheelBet(fastify.db, fastify.config, user.id, {
          ...request.body,
          idempotencyKey: request.headers['idempotency-key'],
        }),
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      body: WheelBetInput,
      headers: WheelBetHeaders,
      operationId: 'placeWheelBet',
      response: { 201: WheelBet, ...failures },
    },
    url: `${PREFIX}/bets`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return listWheelBets(fastify.db, user.id, request.query)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listWheelBets',
      querystring: WheelHistoryQuery,
      response: { 200: WheelBetList, ...failures },
    },
    url: `${PREFIX}/bets`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return verifyWheelBet(
        fastify.db,
        fastify.config,
        user.id,
        request.params.betId,
      )
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'verifyWheelBet',
      params: WheelBetParams,
      response: { 200: WheelVerification, ...failures },
    },
    url: `${PREFIX}/bets/:betId/verify`,
  })

  done()
}

export default routes
