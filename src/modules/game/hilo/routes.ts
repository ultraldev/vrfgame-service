import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { API_PREFIX } from '@/lib/api'
import { Failure } from '@/lib/schemas'

import {
  HiloActiveSeed,
  HiloBetHeaders,
  HiloBetParams,
  HiloCashOut,
  HiloGame,
  HiloGuessInput,
  HiloGuessResponse,
  HiloHistory,
  HiloHistoryQuery,
  HiloSeedRotation,
  HiloStartInput,
  HiloVerification,
} from './schema'
import {
  cashOutHiloBet,
  getActiveHiloBet,
  getHiloActiveSeed,
  guessHiloCard,
  listHiloBets,
  rotateHiloSeed,
  skipHiloCard,
  startHiloBet,
  verifyHiloBet,
} from './service'

const PREFIX = `${API_PREFIX}/games/hilo`
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
      return getHiloActiveSeed(fastify.db, fastify.config, user.id)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'getHiloActiveSeed',
      response: { 200: HiloActiveSeed, ...failures },
    },
    url: `${PREFIX}/seeds/active`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply
        .code(201)
        .send(await rotateHiloSeed(fastify.db, fastify.config, user.id))
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'rotateHiloSeed',
      response: { 201: HiloSeedRotation, ...failures },
    },
    url: `${PREFIX}/seeds/rotate`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply.code(201).send(
        await startHiloBet(fastify.db, fastify.config, user.id, {
          ...request.body,
          idempotencyKey: request.headers['idempotency-key'],
        }),
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      body: HiloStartInput,
      headers: HiloBetHeaders,
      operationId: 'startHiloBet',
      response: { 201: HiloGame, ...failures },
    },
    url: `${PREFIX}/bets`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return getActiveHiloBet(fastify.db, user.id)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'getActiveHiloBet',
      response: { 200: HiloGame.nullable(), ...failures },
    },
    url: `${PREFIX}/bets/active`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return skipHiloCard(
        fastify.db,
        fastify.config,
        user.id,
        request.params.betId,
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'skipHiloCard',
      params: HiloBetParams,
      response: { 200: HiloGame, ...failures },
    },
    url: `${PREFIX}/bets/:betId/skips`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return guessHiloCard(
        fastify.db,
        fastify.config,
        user.id,
        request.params.betId,
        request.body.direction,
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      body: HiloGuessInput,
      operationId: 'guessHiloCard',
      params: HiloBetParams,
      response: { 200: HiloGuessResponse, ...failures },
    },
    url: `${PREFIX}/bets/:betId/guesses`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return cashOutHiloBet(
        fastify.db,
        fastify.config,
        user.id,
        request.params.betId,
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'cashOutHiloBet',
      params: HiloBetParams,
      response: { 200: HiloCashOut, ...failures },
    },
    url: `${PREFIX}/bets/:betId/cashout`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return listHiloBets(fastify.db, user.id, request.query)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listHiloBets',
      querystring: HiloHistoryQuery,
      response: { 200: HiloHistory, ...failures },
    },
    url: `${PREFIX}/bets`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return verifyHiloBet(
        fastify.db,
        fastify.config,
        user.id,
        request.params.betId,
      )
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'verifyHiloBet',
      params: HiloBetParams,
      response: { 200: HiloVerification, ...failures },
    },
    url: `${PREFIX}/bets/:betId/verify`,
  })

  done()
}

export default routes
