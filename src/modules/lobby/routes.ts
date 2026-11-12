import type { FastifyInstance, FastifyPluginOptions } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { API_PREFIX } from '@/lib/api'
import { Failure } from '@/lib/schemas'

import { Crates, Games, Lobby, Query, Raffles } from './schema'
import { listCrates, listGames, listRaffle, lobby } from './service'

const PREFIX = `${API_PREFIX}/lobby`
const failures = {
  400: Failure,
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
    handler: (request) => lobby(fastify.db, request.query.currency),
    method: 'GET',
    preHandler: fastify.auth.optional,
    schema: {
      operationId: 'lobby',
      querystring: Query,
      response: { 200: Lobby, ...failures },
    },
    url: PREFIX,
  })

  app.route({
    handler: () => listGames(fastify.db),
    method: 'GET',
    preHandler: fastify.auth.optional,
    schema: {
      operationId: 'lobbyGames',
      response: { 200: Games, ...failures },
    },
    url: `${PREFIX}/games`,
  })

  app.route({
    handler: () => listRaffle(fastify.db),
    method: 'GET',
    preHandler: fastify.auth.optional,
    schema: {
      operationId: 'lobbyRaffle',
      response: { 200: Raffles, ...failures },
    },
    url: `${PREFIX}/raffle`,
  })

  app.route({
    handler: (request) => listCrates(fastify.db, request.query.currency),
    method: 'GET',
    preHandler: fastify.auth.optional,
    schema: {
      operationId: 'lobbyCrates',
      querystring: Query,
      response: { 200: Crates, ...failures },
    },
    url: `${PREFIX}/crates`,
  })
  done()
}

export default routes
