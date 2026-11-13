import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { API_PREFIX } from '@/lib/api'
import { Failure } from '@/lib/schemas'

import {
  MinesActiveSeed,
  MinesBetHeaders,
  MinesBetParams,
  MinesCashOut,
  MinesGame,
  MinesHistory,
  MinesHistoryQuery,
  MinesReveal,
  MinesRevealInput,
  MinesSeedRotation,
  MinesStartInput,
  MinesVerification,
} from './schema'
import {
  cashOutMinesBet,
  getActiveMinesBet,
  getMinesActiveSeed,
  listMinesBets,
  revealMinesTile,
  rotateMinesSeed,
  startMinesBet,
  verifyMinesBet,
} from './service'

const PREFIX = `${API_PREFIX}/games/mines`
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
      return getMinesActiveSeed(fastify.db, fastify.config, user.id)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'getMinesActiveSeed',
      response: { 200: MinesActiveSeed, ...failures },
    },
    url: `${PREFIX}/seeds/active`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply
        .code(201)
        .send(await rotateMinesSeed(fastify.db, fastify.config, user.id))
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'rotateMinesSeed',
      response: { 201: MinesSeedRotation, ...failures },
    },
    url: `${PREFIX}/seeds/rotate`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply.code(201).send(
        await startMinesBet(fastify.db, fastify.config, user.id, {
          ...request.body,
          idempotencyKey: request.headers['idempotency-key'],
        }),
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      body: MinesStartInput,
      headers: MinesBetHeaders,
      operationId: 'startMinesBet',
      response: { 201: MinesGame, ...failures },
    },
    url: `${PREFIX}/bets`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return getActiveMinesBet(fastify.db, user.id)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'getActiveMinesBet',
      response: { 200: MinesGame.nullable(), ...failures },
    },
    url: `${PREFIX}/bets/active`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return revealMinesTile(
        fastify.db,
        fastify.config,
        user.id,
        request.params.betId,
        request.body.tileIndex,
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      body: MinesRevealInput,
      operationId: 'revealMinesTile',
      params: MinesBetParams,
      response: { 200: MinesReveal, ...failures },
    },
    url: `${PREFIX}/bets/:betId/reveals`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return cashOutMinesBet(
        fastify.db,
        fastify.config,
        user.id,
        request.params.betId,
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'cashOutMinesBet',
      params: MinesBetParams,
      response: { 200: MinesCashOut, ...failures },
    },
    url: `${PREFIX}/bets/:betId/cashout`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return listMinesBets(fastify.db, user.id, request.query)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listMinesBets',
      querystring: MinesHistoryQuery,
      response: { 200: MinesHistory, ...failures },
    },
    url: `${PREFIX}/bets`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return verifyMinesBet(
        fastify.db,
        fastify.config,
        user.id,
        request.params.betId,
      )
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'verifyMinesBet',
      params: MinesBetParams,
      response: { 200: MinesVerification, ...failures },
    },
    url: `${PREFIX}/bets/:betId/verify`,
  })

  done()
}

export default routes
