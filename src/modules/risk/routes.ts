import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { API_PREFIX } from '@/lib/api'
import { Failure } from '@/lib/schemas'
import {
  createExclusion,
  listExclusions,
  listLimits,
  updateLimits,
} from '@/modules/risk/service'

import {
  CreateExclusion,
  RiskExclusion,
  RiskExclusionList,
  RiskLimitList,
  UpdateLimits,
  UserRiskLimits,
} from './schema'

const PREFIX = `${API_PREFIX}/risk`
const failures = {
  400: Failure,
  401: Failure,
  403: Failure,
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
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply
        .code(201)
        .send(await createExclusion(fastify.db, user.id, request.body))
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      body: CreateExclusion,
      operationId: 'createRiskExclusion',
      response: { 201: RiskExclusion, ...failures },
    },
    url: `${PREFIX}/exclusions`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return listExclusions(fastify.db, user.id)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listRiskExclusions',
      response: { 200: RiskExclusionList, ...failures },
    },
    url: `${PREFIX}/exclusions`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return listLimits(fastify.db, user.id)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listRiskLimits',
      response: { 200: RiskLimitList, ...failures },
    },
    url: `${PREFIX}/limits`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return updateLimits(fastify.db, user.id, request.body)
    },
    method: 'PATCH',
    preHandler: fastify.auth.required,
    schema: {
      body: UpdateLimits,
      operationId: 'updateRiskLimits',
      response: { 200: UserRiskLimits, ...failures },
    },
    url: `${PREFIX}/limits`,
  })

  done()
}

export default routes
