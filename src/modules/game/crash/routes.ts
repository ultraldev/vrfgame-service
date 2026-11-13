import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { API_PREFIX } from '@/lib/api'
import { Failure } from '@/lib/schemas'

import {
  CrashBet,
  CrashBetHeaders,
  CrashBetInput,
  CrashBetParams,
  CrashCancel,
  CrashCashOut,
  CrashHistory,
  CrashHistoryQuery,
  CrashPublicSnapshot,
  CrashRecentQuery,
  CrashRecentRounds,
  CrashRoundParams,
  CrashRoundVerification,
} from './schema'
import {
  cancelCrashBet,
  cashOutCrashBet,
  getCrashSnapshot,
  listCrashBets,
  listRecentCrashRounds,
  placeCrashBet,
  verifyCrashRound,
} from './service'

const PREFIX = `${API_PREFIX}/games/crash`
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
    handler: () => getCrashSnapshot(fastify.crash),
    method: 'GET',
    schema: {
      operationId: 'getCrashRound',
      response: { 200: CrashPublicSnapshot, ...failures },
    },
    url: `${PREFIX}/rounds/active`,
  })

  app.route({
    handler: (request) =>
      listRecentCrashRounds(fastify.db, request.query.limit),
    method: 'GET',
    schema: {
      operationId: 'listRecentCrashRounds',
      querystring: CrashRecentQuery,
      response: { 200: CrashRecentRounds, ...failures },
    },
    url: `${PREFIX}/rounds/recent`,
  })

  app.route({
    handler: (request) =>
      verifyCrashRound(fastify.db, fastify.config, request.params.roundId),
    method: 'GET',
    schema: {
      operationId: 'verifyCrashRound',
      params: CrashRoundParams,
      response: { 200: CrashRoundVerification, ...failures },
    },
    url: `${PREFIX}/rounds/:roundId/verify`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply.code(201).send(
        await placeCrashBet(
          fastify.db,
          fastify.config,
          fastify.crash,
          user.id,
          {
            ...request.body,
            idempotencyKey: request.headers['idempotency-key'],
          },
        ),
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      body: CrashBetInput,
      headers: CrashBetHeaders,
      operationId: 'placeCrashBet',
      response: { 201: CrashBet, ...failures },
    },
    url: `${PREFIX}/bets`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return cancelCrashBet(fastify.db, fastify.crash, user.id)
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'cancelCrashBet',
      response: { 200: CrashCancel, ...failures },
    },
    url: `${PREFIX}/bets/cancel`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return cashOutCrashBet(
        fastify.db,
        fastify.config,
        fastify.crash,
        user.id,
        request.params.betId,
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'cashOutCrashBet',
      params: CrashBetParams,
      response: { 200: CrashCashOut, ...failures },
    },
    url: `${PREFIX}/bets/:betId/cashout`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return listCrashBets(fastify.db, user.id, request.query)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listCrashBets',
      querystring: CrashHistoryQuery,
      response: { 200: CrashHistory, ...failures },
    },
    url: `${PREFIX}/bets`,
  })

  done()
}

export default routes
