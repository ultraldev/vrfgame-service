import { randomUUID } from 'node:crypto'

import { httpErrors } from '@fastify/sensible'
import { and, asc, eq, inArray, isNull, lt } from 'drizzle-orm'
import type Redis from 'ioredis'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import { currency as findCurrency } from '@/lib/currency'
import { errorMessage } from '@/lib/errors'
import { formatAmount, parseAmount } from '@/lib/money'
import { creditInTransaction } from '@/modules/wallet/ledger'
import { ensureWallet, publishWalletBalance } from '@/modules/wallet/service'
import { WALLET_REFERENCES } from '@/modules/wallet/util'

import type { ZeffraAdapter } from '../providers/zeffra/adapter'
import { ZeffraRequestError } from '../providers/zeffra/error'
import type { ZeffraEvent } from '../providers/zeffra/types'
import { requireEnabledFiatRoute } from '../service'
import { hashPaymentRequest, ceilBps } from '../util'
import { findFiatRouteCode, listFiatOrders } from './order'
import type { FiatOrderRow } from './order'
import { FiatDeposit } from './schema'
import type { FiatDepositResponse, FiatHistoryFilters } from './schema'
import { resolveFiatBilling, resolveFiatDevice } from './util'

const EXPIRE_AFTER_MS = 24 * 60 * 60 * 1000
const RECONCILE_AFTER_MS = 5 * 60 * 1000

interface FiatDepositServiceOptions {
  adapter: ZeffraAdapter
  db: Db
  redis: Pick<Redis, 'publish'>
}

interface CreateDepositInput {
  amount: string
  currency: string
  idempotencyKey: string
  billing?: {
    address1?: string
    address2?: string
    city?: string
    country?: string
    email?: string
    firstName?: string
    lastName?: string
    phone?: string
    postalCode?: string
    state?: string
  }
  device?: {
    browser?: string
    cardInputMethod?: 'typed' | 'pasted'
    cookie?: string
    language?: string
    os?: string
    screenResolution?: string
    timezone?: string
  }
  routeCode: string
}

async function depositResponse(
  db: Db,
  row: FiatOrderRow,
): Promise<FiatDepositResponse> {
  const active = await findCurrency(db, row.currencyCode)
  const routeCode = await findFiatRouteCode(db, row.routeId)
  return FiatDeposit.parse({
    amount: formatAmount(row.amount, active.decimals),
    authUrl: row.authUrl,
    createdAt: row.createdAt.toISOString(),
    currency: row.currencyCode,
    failureReason: row.failureReason,
    id: row.id,
    needAuth: row.needAuth,
    routeCode,
    status: row.status,
    type: 'deposit',
    updatedAt: row.updatedAt.toISOString(),
  })
}

export class FiatDepositService {
  private readonly adapter: ZeffraAdapter
  private readonly db: Db
  private readonly redis: Pick<Redis, 'publish'>

  constructor(options: FiatDepositServiceOptions) {
    this.adapter = options.adapter
    this.db = options.db
    this.redis = options.redis
  }

  async expireDeposits() {
    const rows = await this.db
      .update(schema.fiatOrder)
      .set({
        failureReason: 'Fiat deposit expired',
        retryable: false,
        status: 'expired',
      })
      .where(
        and(
          eq(schema.fiatOrder.type, 'deposit'),
          eq(schema.fiatOrder.status, 'pending'),
          lt(
            schema.fiatOrder.createdAt,
            new Date(Date.now() - EXPIRE_AFTER_MS),
          ),
          isNull(schema.fiatOrder.ledgerTransactionId),
        ),
      )
      .returning({ id: schema.fiatOrder.id })
    return rows.length
  }

  async create(input: CreateDepositInput, userId: string, clientIp: string) {
    const { amount, requestHash, selection } = await this.context(input)
    const { currency, provider, route } = selection
    const existing = await this.db.query.fiatOrder.findFirst({
      where: and(
        eq(schema.fiatOrder.userId, userId),
        eq(schema.fiatOrder.idempotencyKey, input.idempotencyKey),
      ),
    })
    let orderId: string
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw httpErrors.conflict(
          'Idempotency key was already used with different parameters',
        )
      }
      if (existing.status !== 'failed' || !existing.retryable) {
        return depositResponse(this.db, existing)
      }
      const [reclaimed] = await this.db
        .update(schema.fiatOrder)
        .set({
          authUrl: null,
          confirmUrl: null,
          failureReason: null,
          needAuth: false,
          providerOrderNo: null,
          providerPayload: null,
          retryable: false,
          settledAt: null,
          status: 'creating',
        })
        .where(
          and(
            eq(schema.fiatOrder.id, existing.id),
            eq(schema.fiatOrder.status, 'failed'),
            eq(schema.fiatOrder.retryable, true),
          ),
        )
        .returning()
      if (!reclaimed) {
        const current = await this.db.query.fiatOrder.findFirst({
          where: eq(schema.fiatOrder.id, existing.id),
        })
        if (!current) {
          throw httpErrors.notFound('Fiat deposit not found')
        }
        return depositResponse(this.db, current)
      }
      orderId = reclaimed.id
    } else {
      const providerFee =
        route.depositFeeFixed + ceilBps(amount, route.depositFeeRateBps)
      orderId = randomUUID()
      const [created] = await this.db
        .insert(schema.fiatOrder)
        .values({
          amount,
          currencyCode: currency.code,
          id: orderId,
          idempotencyKey: input.idempotencyKey,
          merchantOrderNo: orderId,
          providerFee,
          providerId: provider.id,
          requestHash,
          routeId: route.id,
          status: 'creating',
          type: 'deposit',
          userId,
        })
        .onConflictDoNothing({
          target: [schema.fiatOrder.userId, schema.fiatOrder.idempotencyKey],
        })
        .returning()
      if (!created) {
        const replay = await this.db.query.fiatOrder.findFirst({
          where: and(
            eq(schema.fiatOrder.userId, userId),
            eq(schema.fiatOrder.idempotencyKey, input.idempotencyKey),
          ),
        })
        if (!replay || replay.requestHash !== requestHash) {
          throw httpErrors.conflict(
            'Idempotency key was already used with different parameters',
          )
        }
        return depositResponse(this.db, replay)
      }
    }

    const user = await this.db.query.user.findFirst({
      where: eq(schema.user.id, userId),
    })
    if (!user) {
      throw httpErrors.notFound('User not found')
    }

    try {
      const result = await this.adapter.createDeposit({
        amount,
        billing: resolveFiatBilling(user, input.billing),
        currency: currency.code,
        device: resolveFiatDevice(userId, clientIp, input.device),
        merchantOrderNo: orderId,
        providerPaymentCode: route.providerPaymentCode,
        userId,
        userRegisteredAt: Math.floor(user.createdAt.getTime() / 1000),
      })
      const [updated] = await this.db
        .update(schema.fiatOrder)
        .set({
          authUrl: result.authUrl ?? null,
          failureReason: null,
          needAuth: result.needAuth,
          providerOrderNo: result.providerOrderNo,
          retryable: false,
          status: 'pending',
        })
        .where(eq(schema.fiatOrder.id, orderId))
        .returning()
      if (!updated) {
        throw new Error('Failed to update fiat deposit')
      }
      return depositResponse(this.db, updated)
    } catch (error) {
      const retryable = error instanceof ZeffraRequestError && error.retryable
      await this.db
        .update(schema.fiatOrder)
        .set({
          failureReason: errorMessage(error).slice(0, 500),
          retryable,
          status: retryable ? 'failed' : 'submit_unconfirmed',
        })
        .where(eq(schema.fiatOrder.id, orderId))
      throw error
    }
  }

  async getOrder(userId: string, orderId: string) {
    const row = await this.db.query.fiatOrder.findFirst({
      where: and(
        eq(schema.fiatOrder.id, orderId),
        eq(schema.fiatOrder.userId, userId),
        eq(schema.fiatOrder.type, 'deposit'),
      ),
    })
    if (!row) {
      throw httpErrors.notFound('Fiat deposit not found')
    }
    return depositResponse(this.db, row)
  }

  listOrders(userId: string, query: FiatHistoryFilters) {
    return listFiatOrders(this.db, userId, 'deposit', query, (row) =>
      depositResponse(this.db, row),
    )
  }

  async handleDepositEvent(providerId: string, event: ZeffraEvent) {
    const order = await this.db.query.fiatOrder.findFirst({
      where: and(
        eq(schema.fiatOrder.providerId, providerId),
        eq(schema.fiatOrder.merchantOrderNo, event.merchantOrderNo),
        eq(schema.fiatOrder.type, 'deposit'),
      ),
    })
    if (!order) {
      throw httpErrors.notFound('Fiat deposit not found')
    }
    if (event.currency && event.currency !== order.currencyCode) {
      throw httpErrors.badRequest('Fiat deposit callback currency mismatch')
    }
    if (BigInt(event.amount) !== order.amount) {
      throw httpErrors.badRequest('Fiat deposit callback amount mismatch')
    }
    if (event.status === 'succeeded') {
      await this.settleDeposit(order, event)
      return
    }
    if (event.status === 'failed') {
      await this.db
        .update(schema.fiatOrder)
        .set({
          failureReason: event.failReason ?? 'Zeffra deposit failed',
          providerOrderNo: event.providerOrderNo,
          providerPayload: event.providerPayload,
          retryable: false,
          status: 'failed',
        })
        .where(eq(schema.fiatOrder.id, order.id))
    }
  }

  async reconcileDeposits() {
    if (!this.adapter.isConfigured()) {
      return 0
    }
    const cutoff = new Date(Date.now() - RECONCILE_AFTER_MS)
    const rows = await this.db.query.fiatOrder.findMany({
      limit: 50,
      orderBy: [asc(schema.fiatOrder.createdAt)],
      where: and(
        eq(schema.fiatOrder.type, 'deposit'),
        inArray(schema.fiatOrder.status, [
          'creating',
          'pending',
          'submit_unconfirmed',
        ]),
        lt(schema.fiatOrder.createdAt, cutoff),
        isNull(schema.fiatOrder.ledgerTransactionId),
      ),
    })
    let processed = 0
    for (const row of rows) {
      try {
        const result = await this.adapter.queryDeposit(row.merchantOrderNo)
        if (!result.found) {
          if (row.status === 'creating') {
            await this.db
              .update(schema.fiatOrder)
              .set({
                failureReason: 'Zeffra order was not found after submission',
                retryable: true,
                status: 'failed',
              })
              .where(eq(schema.fiatOrder.id, row.id))
          } else if (
            row.status === 'pending' &&
            Date.now() - row.createdAt.getTime() >= EXPIRE_AFTER_MS
          ) {
            await this.db
              .update(schema.fiatOrder)
              .set({ retryable: false, status: 'expired' })
              .where(eq(schema.fiatOrder.id, row.id))
          }
          continue
        }
        if (result.status === 'pending') {
          await this.db
            .update(schema.fiatOrder)
            .set({
              providerOrderNo: result.providerOrderNo ?? row.providerOrderNo,
              providerPayload: result.providerPayload,
              retryable: false,
              status: 'pending',
            })
            .where(eq(schema.fiatOrder.id, row.id))
          if (Date.now() - row.createdAt.getTime() >= EXPIRE_AFTER_MS) {
            await this.db
              .update(schema.fiatOrder)
              .set({ status: 'expired' })
              .where(eq(schema.fiatOrder.id, row.id))
          }
          continue
        }
        await (result.status === 'succeeded'
          ? this.settleDeposit(row, result)
          : this.db
              .update(schema.fiatOrder)
              .set({
                failureReason: result.failReason ?? 'Zeffra deposit failed',
                providerPayload: result.providerPayload,
                retryable: false,
                status: 'failed',
              })
              .where(eq(schema.fiatOrder.id, row.id)))
        processed += 1
      } catch (error) {
        await this.db
          .update(schema.fiatOrder)
          .set({ failureReason: errorMessage(error).slice(0, 500) })
          .where(eq(schema.fiatOrder.id, row.id))
      }
    }
    return processed
  }

  private async context(input: CreateDepositInput) {
    const selection = await requireEnabledFiatRoute(
      this.db,
      input.routeCode,
      input.currency,
      'deposit',
    )
    if (selection.provider.code !== this.adapter.providerCode) {
      throw httpErrors.serviceUnavailable('Fiat deposit provider unavailable')
    }
    if (!this.adapter.isConfigured()) {
      throw httpErrors.serviceUnavailable('Zeffra is not configured')
    }
    if (selection.currency.decimals !== this.adapter.orderDecimals) {
      throw httpErrors.serviceUnavailable(
        'Fiat route currency precision is not supported',
      )
    }
    if (selection.route.billingRequired && !input.billing) {
      throw httpErrors.badRequest('Billing information is required')
    }
    const amount = parseAmount(input.amount, selection.currency.decimals)
    if (amount <= 0n) {
      throw httpErrors.badRequest('Deposit amount must be positive')
    }
    if (
      selection.route.minDepositAmount !== null &&
      amount < selection.route.minDepositAmount
    ) {
      throw httpErrors.badRequest('Deposit amount is below the route minimum')
    }
    if (
      selection.route.maxDepositAmount !== null &&
      amount > selection.route.maxDepositAmount
    ) {
      throw httpErrors.badRequest('Deposit amount exceeds the route maximum')
    }
    return {
      amount,
      requestHash: hashPaymentRequest({
        amount,
        currency: selection.currency.code,
        provider: selection.provider.code,
        route: selection.route.code,
      }),
      selection,
    }
  }

  private async settleDeposit(
    order: FiatOrderRow,
    provider: {
      providerOrderNo?: string
      providerPayload?: Record<string, unknown>
    } = {},
  ) {
    const wallet = await ensureWallet(this.db, order.userId, order.currencyCode)
    const result = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(schema.fiatOrder)
        .where(eq(schema.fiatOrder.id, order.id))
        .for('update')
      if (!locked || locked.ledgerTransactionId) {
        return null
      }
      const mutation = await creditInTransaction(tx, {
        amount: locked.amount,
        idempotencyKey: `fiat-deposit:${locked.id}`,
        reference: {
          referenceId: locked.id,
          referenceType: WALLET_REFERENCES.deposit,
        },
        walletId: wallet.id,
      })
      await tx
        .update(schema.fiatOrder)
        .set({
          ledgerTransactionId: mutation.transactionId,
          providerOrderNo: provider.providerOrderNo ?? locked.providerOrderNo,
          providerPayload: provider.providerPayload ?? locked.providerPayload,
          settledAt: new Date(),
          status: 'succeeded',
          walletId: wallet.id,
        })
        .where(eq(schema.fiatOrder.id, locked.id))
      return mutation
    })
    if (result) {
      await publishWalletBalance(
        this.redis,
        this.db,
        order.userId,
        order.currencyCode,
      )
    }
  }
}
