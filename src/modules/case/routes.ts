import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { API_PREFIX } from '@/lib/api'
import { Failure } from '@/lib/schemas'
import {
  getActiveCaseSeed,
  getCrate,
  listCaseOpens,
  listCrates,
  openCrate,
  openCrateBatch,
  rotateActiveCaseSeed,
  verifyCaseOpen,
} from '@/modules/case/service'

import {
  CaseActiveSeed,
  CaseHistoryQuery,
  CaseOpen,
  CaseOpenBatch,
  CaseOpenBatchInput,
  CaseOpenHeaders,
  CaseOpenInput,
  CaseOpenList,
  CaseOpenParams,
  CaseSeedRotation,
  CaseVerification,
  CrateDetail,
  CrateDetailQuery,
  CrateList,
  CrateListQuery,
  CrateParams,
} from './schema'

const PREFIX = API_PREFIX
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
    handler: (request) => listCrates(fastify.db, request.query),
    method: 'GET',
    schema: {
      operationId: 'listCrates',
      querystring: CrateListQuery,
      response: { 200: CrateList, ...publicFailures },
    },
    url: `${PREFIX}/crates`,
  })

  app.route({
    handler: (request) =>
      getCrate(fastify.db, request.params.slug, request.query.currency),
    method: 'GET',
    schema: {
      operationId: 'getCrate',
      params: CrateParams,
      querystring: CrateDetailQuery,
      response: { 200: CrateDetail, ...publicFailures },
    },
    url: `${PREFIX}/crates/:slug`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return getActiveCaseSeed(fastify.db, fastify.config, user.id)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'getCaseActiveSeed',
      response: { 200: CaseActiveSeed, ...failures },
    },
    url: `${PREFIX}/case-seeds/active`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply
        .code(201)
        .send(await rotateActiveCaseSeed(fastify.db, fastify.config, user.id))
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'rotateCaseSeed',
      response: { 201: CaseSeedRotation, ...failures },
    },
    url: `${PREFIX}/case-seeds/rotate`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply.code(201).send(
        await openCrate(fastify.db, fastify.config, user.id, {
          ...request.body,
          idempotencyKey: request.headers['idempotency-key'],
        }),
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      body: CaseOpenInput,
      headers: CaseOpenHeaders,
      operationId: 'openCrate',
      response: { 201: CaseOpen, ...failures },
    },
    url: `${PREFIX}/case-opens`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply.code(201).send(
        await openCrateBatch(fastify.db, fastify.config, user.id, {
          ...request.body,
          idempotencyKey: request.headers['idempotency-key'],
        }),
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      body: CaseOpenBatchInput,
      headers: CaseOpenHeaders,
      operationId: 'openCrateBatch',
      response: { 201: CaseOpenBatch, ...failures },
    },
    url: `${PREFIX}/case-opens/batch`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return listCaseOpens(fastify.db, user.id, request.query)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listCaseOpens',
      querystring: CaseHistoryQuery,
      response: { 200: CaseOpenList, ...failures },
    },
    url: `${PREFIX}/case-opens`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return verifyCaseOpen(
        fastify.db,
        fastify.config,
        user.id,
        request.params.openId,
      )
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'verifyCaseOpen',
      params: CaseOpenParams,
      response: { 200: CaseVerification, ...failures },
    },
    url: `${PREFIX}/case-opens/:openId/verify`,
  })
  done()
}

export default routes
