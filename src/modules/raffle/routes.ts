import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { API_PREFIX } from '@/lib/api'
import { Failure } from '@/lib/schemas'

import {
  RaffleDetail,
  RaffleEntry,
  RaffleEntryHeaders,
  RaffleEntryInput,
  RaffleHistory,
  RaffleHistoryQuery,
  RaffleList,
  RaffleListQuery,
  RaffleParams,
  RaffleRoundParams,
  RaffleVerification,
} from './schema'
import {
  enterRaffleRound,
  getRaffle,
  listRaffleHistory,
  listRaffles,
  verifyRaffleRound,
} from './service'

const PREFIX = `${API_PREFIX}/raffles`
const failures = {
  400: Failure,
  401: Failure,
  403: Failure,
  404: Failure,
  409: Failure,
  500: Failure,
  503: Failure,
}
const publicFailures = {
  400: Failure,
  403: Failure,
  404: Failure,
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
    handler: (request) =>
      listRaffles(fastify.db, fastify.config, request.query, request.user?.id),
    method: 'GET',
    preHandler: fastify.auth.optional,
    schema: {
      operationId: 'listRaffles',
      querystring: RaffleListQuery,
      response: { 200: RaffleList, ...publicFailures },
    },
    url: PREFIX,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return listRaffleHistory(
        fastify.db,
        fastify.config,
        user.id,
        request.query,
      )
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listRaffleHistory',
      querystring: RaffleHistoryQuery,
      response: { 200: RaffleHistory, ...failures },
    },
    url: `${PREFIX}/history`,
  })

  app.route({
    handler: (request) =>
      getRaffle(
        fastify.db,
        fastify.config,
        request.params.slug,
        request.user?.id,
      ),
    method: 'GET',
    preHandler: fastify.auth.optional,
    schema: {
      operationId: 'getRaffle',
      params: RaffleParams,
      response: { 200: RaffleDetail, ...publicFailures },
    },
    url: `${PREFIX}/:slug`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply.code(201).send(
        await enterRaffleRound(
          fastify.db,
          fastify.config,
          user.id,
          request.params.roundId,
          {
            idempotencyKey: request.headers['idempotency-key'],
            shares: request.body.shares,
          },
        ),
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      body: RaffleEntryInput,
      headers: RaffleEntryHeaders,
      operationId: 'enterRaffleRound',
      params: RaffleRoundParams,
      response: { 201: RaffleEntry, ...failures },
    },
    url: `${PREFIX}/rounds/:roundId/entries`,
  })

  app.route({
    handler: (request) =>
      verifyRaffleRound(fastify.db, fastify.config, request.params.roundId),
    method: 'GET',
    schema: {
      operationId: 'verifyRaffleRound',
      params: RaffleRoundParams,
      response: { 200: RaffleVerification, ...publicFailures },
    },
    url: `${PREFIX}/rounds/:roundId/verify`,
  })
  done()
}

export default routes
