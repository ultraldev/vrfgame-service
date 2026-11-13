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
  CreateDepositHeaders,
  CreateDepositInput,
  Deposit,
  DepositConfig,
  DepositConfigQuery,
  DepositHistoryQuery,
  DepositList,
  DepositParams,
  Withdrawal,
  WithdrawalConfig,
  WithdrawalConfigQuery,
  WithdrawalFee,
  WithdrawalFeeQuery,
  WithdrawalHeaders,
  WithdrawalHistoryQuery,
  WithdrawalList,
  WithdrawalParams,
  WithdrawalRequestInput,
} from './schema'

const PREFIX = `${API_PREFIX}/wallet/crypto`
function routes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
  done: (error?: Error) => void,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>()

  app.route({
    handler: (request) =>
      fastify.cryptoDeposit.getConfig(request.query.currency),
    method: 'GET',
    schema: {
      operationId: 'getCryptoDepositConfig',
      querystring: DepositConfigQuery,
      response: { 200: DepositConfig, ...failures },
    },
    url: `${PREFIX}/deposit-config`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply.code(201).send(
        await fastify.cryptoDeposit.create(
          {
            amount: request.body.amount,
            currency: request.body.currency,
            idempotencyKey: request.headers['idempotency-key'],
          },
          user.id,
        ),
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      body: CreateDepositInput,
      headers: CreateDepositHeaders,
      operationId: 'createCryptoDeposit',
      response: { 201: Deposit, ...failures },
    },
    url: `${PREFIX}/deposits`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return fastify.cryptoDeposit.listDeposits(user.id, request.query)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listCryptoDeposits',
      querystring: DepositHistoryQuery,
      response: { 200: DepositList, ...failures },
    },
    url: `${PREFIX}/deposits`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return fastify.cryptoDeposit.getDeposit(user.id, request.params.depositId)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'getCryptoDeposit',
      params: DepositParams,
      response: { 200: Deposit, ...failures },
    },
    url: `${PREFIX}/deposits/:depositId`,
  })

  app.route({
    handler: (request) =>
      fastify.cryptoWithdrawal.getConfig(request.query.currency),
    method: 'GET',
    schema: {
      operationId: 'getCryptoWithdrawalConfig',
      querystring: WithdrawalConfigQuery,
      response: { 200: WithdrawalConfig, ...failures },
    },
    url: `${PREFIX}/withdrawal-config`,
  })

  app.route({
    handler: (request) =>
      fastify.cryptoWithdrawal.getFee(
        request.query.currency,
        request.query.amount,
      ),
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'getCryptoWithdrawalFee',
      querystring: WithdrawalFeeQuery,
      response: { 200: WithdrawalFee, ...failures },
    },
    url: `${PREFIX}/withdrawals/fee`,
  })

  app.route({
    handler: async (request, reply) => {
      const { user } = fastify.auth.session(request)
      return reply.code(201).send(
        await fastify.cryptoWithdrawal.request(
          {
            address: request.body.address,
            amount: request.body.amount,
            currency: request.body.currency,
            idempotencyKey: request.headers['idempotency-key'],
          },
          user.id,
        ),
      )
    },
    method: 'POST',
    preHandler: fastify.auth.required,
    schema: {
      body: WithdrawalRequestInput,
      headers: WithdrawalHeaders,
      operationId: 'createCryptoWithdrawal',
      response: { 201: Withdrawal, ...failures },
    },
    url: `${PREFIX}/withdrawals`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return fastify.cryptoWithdrawal.listWithdrawals(user.id, request.query)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listCryptoWithdrawals',
      querystring: WithdrawalHistoryQuery,
      response: { 200: WithdrawalList, ...failures },
    },
    url: `${PREFIX}/withdrawals`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return fastify.cryptoWithdrawal.getWithdrawal(
        user.id,
        request.params.withdrawalId,
      )
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'getCryptoWithdrawal',
      params: WithdrawalParams,
      response: { 200: Withdrawal, ...failures },
    },
    url: `${PREFIX}/withdrawals/:withdrawalId`,
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
          await fastify.paymentWebhook.handleCryptoPay(
            rawBody,
            requestHeaders(request),
          ),
        )
    },
    method: 'POST',
    preParsing: captureRawBody,
    schema: { hide: true },
    url: `${API_PREFIX}/webhooks/kucoin-pay`,
  })
  done()
}

export default routes
