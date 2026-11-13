import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { API_PREFIX } from '@/lib/api'
import { Failure } from '@/lib/schemas'

import { Board, Position, Query, RewardList, RewardQuery } from './schema'
import { mine, ranking, rewards } from './service'

const PREFIX = `${API_PREFIX}/ranking`
const failures = {
  400: Failure,
  401: Failure,
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
    handler: (request) => ranking(fastify.db, request.query.period),
    method: 'GET',
    preHandler: fastify.auth.optional,
    schema: {
      operationId: 'getRanking',
      querystring: Query,
      response: { 200: Board, ...failures },
    },
    url: PREFIX,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return mine(fastify.db, user.id, request.query.period)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'getMyRanking',
      querystring: Query,
      response: { 200: Position, ...failures },
    },
    url: `${PREFIX}/me`,
  })
  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return rewards(fastify.db, user.id, request.query)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listMyRankingRewards',
      querystring: RewardQuery,
      response: { 200: RewardList, ...failures },
    },
    url: `${PREFIX}/rewards`,
  })
  done()
}

export default routes
