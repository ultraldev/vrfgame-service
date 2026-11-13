import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { API_PREFIX } from '@/lib/api'
import { Failure } from '@/lib/schemas'

import {
  FavoriteGameList,
  FavoriteStatus,
  GameDetail,
  GameList,
  GameListQuery,
  GameParams,
  GamePlayReceipt,
  RecentGameList,
  RecentGameQuery,
} from './schema'
import {
  addFavoriteGame,
  getGame,
  listFavoriteGames,
  listGames,
  listRecentGames,
  recordGamePlay,
  removeFavoriteGame,
} from './service'

const PREFIX = `${API_PREFIX}/games`
const publicFailures = {
  400: Failure,
  403: Failure,
  500: Failure,
  503: Failure,
}
const publicDetailFailures = {
  ...publicFailures,
  404: Failure,
}
const protectedFailures = {
  401: Failure,
  403: Failure,
  500: Failure,
  503: Failure,
}
const protectedDetailFailures = {
  ...protectedFailures,
  400: Failure,
  404: Failure,
}

function routes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
  done: (error?: Error) => void,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.route({
    handler: (request) =>
      listGames(fastify.db, request.query, request.user?.id),
    method: 'GET',
    preHandler: fastify.auth.optional,
    schema: {
      operationId: 'listGames',
      querystring: GameListQuery,
      response: { 200: GameList, ...publicFailures },
    },
    url: PREFIX,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return listFavoriteGames(fastify.db, user.id)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listFavoriteGames',
      response: { 200: FavoriteGameList, ...protectedFailures },
    },
    url: `${PREFIX}/favorites`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return listRecentGames(fastify.db, user.id, request.query)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listRecentGames',
      querystring: RecentGameQuery,
      response: { 200: RecentGameList, ...protectedFailures },
    },
    url: `${PREFIX}/recent`,
  })

  app.route({
    handler: (request) =>
      getGame(fastify.db, request.params.slug, request.user?.id),
    method: 'GET',
    preHandler: fastify.auth.optional,
    schema: {
      operationId: 'getGame',
      params: GameParams,
      response: { 200: GameDetail, ...publicDetailFailures },
    },
    url: `${PREFIX}/:slug`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return addFavoriteGame(fastify.db, user.id, request.params.slug)
    },
    method: 'PUT',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'addFavoriteGame',
      params: GameParams,
      response: { 200: FavoriteStatus, ...protectedDetailFailures },
    },
    url: `${PREFIX}/:slug/favorite`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return removeFavoriteGame(fastify.db, user.id, request.params.slug)
    },
    method: 'DELETE',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'removeFavoriteGame',
      params: GameParams,
      response: { 200: FavoriteStatus, ...protectedDetailFailures },
    },
    url: `${PREFIX}/:slug/favorite`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return recordGamePlay(fastify.db, user.id, request.params.slug)
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'recordGamePlay',
      params: GameParams,
      response: { 200: GamePlayReceipt, ...protectedDetailFailures },
    },
    url: `${PREFIX}/:slug/plays`,
  })

  done()
}

export default routes
