import type { FastifyInstance, FastifyPluginOptions } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { API_PREFIX } from '@/lib/api'
import { Failure } from '@/lib/schemas'
import { balance, balances, transactions } from '@/modules/wallet/service'

import { Item, List, Query, Transactions, TransactionsQuery } from './schema'

const PREFIX = `${API_PREFIX}/wallet`
const failures = {
  400: Failure,
  401: Failure,
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
      return balance(fastify.db, user.id, request.query.currency)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'getWalletBalance',
      querystring: Query,
      response: { 200: Item, ...failures },
    },
    url: `${PREFIX}/balance`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return balances(fastify.db, user.id)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listWalletBalances',
      response: { 200: List, ...failures },
    },
    url: `${PREFIX}/balances`,
  })

  app.route({
    handler: (request) => {
      const { user } = fastify.auth.session(request)
      return transactions(fastify.db, user.id, request.query)
    },
    method: 'GET',
    preHandler: fastify.auth.required,
    schema: {
      operationId: 'listWalletTransactions',
      querystring: TransactionsQuery,
      response: { 200: Transactions, ...failures },
    },
    url: `${PREFIX}/transactions`,
  })
  done()
}

export default routes
