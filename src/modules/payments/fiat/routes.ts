import { httpErrors } from '@fastify/sensible'
import type { ZodTypeProvider } from '@fastify/type-provider-zod'
import type { FastifyInstance, FastifyPluginOptions } from 'fastify'

import { API_PREFIX } from '@/lib/api'

import {
  captureRawBody,
  paymentFailures as failures,
  requestHeaders,
} from '../http'
import {
  FiatDeposit,
  FiatDepositInput,
  FiatHeaders,
  FiatHistoryQuery,
  FiatOptions,
  FiatOptionsQuery,
  FiatOrderList,
  FiatOrderParams,
  FiatPayout,
  FiatPayoutInput,
} from './schema'
import { getFiatOptions } from './service'

const PREFIX = `${API_PREFIX}/wallet/fiat`

function routes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
  done: (error?: Error) => void,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.route({
    handler: (request) => getFiatOptions(fastify.db, request.query.currency),
    method: 'GET',
    schema: {
      operationId: 'getFiatOptions',
      querystring: FiatOptionsQuery,
      response: { 200: FiatOptions, ...failures },
    },
    url: `${PREFIX}/options`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply.code(201).send(
        await fastify.fiatDeposit.create(
          {
            amount: request.body.amount,
            billing: request.body.billing,
            currency: request.body.currency,
            device: request.body.device,
            idempotencyKey: request.headers['idempotency-key'],
            routeCode: request.body.routeCode,
          },
          user.id,
          request.ip,
        ),
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      body: FiatDepositInput,
      headers: FiatHeaders,
      operationId: 'createFiatDeposit',
      response: { 201: FiatDeposit, ...failures },
    },
    url: `${PREFIX}/deposits`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return fastify.fiatDeposit.listOrders(user.id, request.query)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listFiatDeposits',
      querystring: FiatHistoryQuery,
      response: { 200: FiatOrderList, ...failures },
    },
    url: `${PREFIX}/deposits`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return fastify.fiatDeposit.getOrder(user.id, request.params.orderId)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'getFiatDeposit',
      params: FiatOrderParams,
      response: { 200: FiatDeposit, ...failures },
    },
    url: `${PREFIX}/deposits/:orderId`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply.code(201).send(
        await fastify.fiatPayout.request(
          {
            amount: request.body.amount,
            bankCode: request.body.bankCode,
            currency: request.body.currency,
            ext1: request.body.ext1,
            ext2: request.body.ext2,
            ext3: request.body.ext3,
            idempotencyKey: request.headers['idempotency-key'],
            receiveAccount: request.body.receiveAccount,
            receiveAccountExpireAt: request.body.receiveAccountExpireAt,
            recipient: request.body.recipient,
            routeCode: request.body.routeCode,
          },
          user.id,
        ),
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      body: FiatPayoutInput,
      headers: FiatHeaders,
      operationId: 'createFiatPayout',
      response: { 201: FiatPayout, ...failures },
    },
    url: `${PREFIX}/payouts`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return fastify.fiatPayout.listOrders(user.id, request.query)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listFiatPayouts',
      querystring: FiatHistoryQuery,
      response: { 200: FiatOrderList, ...failures },
    },
    url: `${PREFIX}/payouts`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return fastify.fiatPayout.getOrder(user.id, request.params.orderId)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'getFiatPayout',
      params: FiatOrderParams,
      response: { 200: FiatPayout, ...failures },
    },
    url: `${PREFIX}/payouts/:orderId`,
  })

  app.route({
    handler: async (request, reply) => {
      const rawBody = request.rawBody
      if (!rawBody || rawBody.length === 0) {
        throw httpErrors.badRequest('Missing raw body')
      }
      return reply
        .code(200)
        .send(
          await fastify.paymentWebhook.handleZeffra(
            rawBody,
            requestHeaders(request),
          ),
        )
    },
    method: 'POST',
    preParsing: captureRawBody,
    schema: { hide: true },
    url: `${API_PREFIX}/webhooks/zeffra`,
  })
  done()
}

export default routes
