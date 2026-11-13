import { randomUUID } from 'node:crypto'

import { httpErrors } from '@fastify/sensible'
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type Redis from 'ioredis'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import { currency as findCurrency } from '@/lib/currency'
import { decodeCursor, encodeCursor } from '@/lib/cursor'
import { errorMessage } from '@/lib/errors'
import { formatAmount, parseAmount } from '@/lib/money'
import { creditInTransaction } from '@/modules/wallet/ledger'
import { ensureWallet, publishWalletBalance } from '@/modules/wallet/service'
import { WALLET_REFERENCES } from '@/modules/wallet/util'

import type {
  KuCoinDepositEvent,
  KuCoinPayAdapter,
} from '../providers/kucoin/adapter'
import { requireEnabledCryptoRoute } from '../service'
import { ceilBps, hashPaymentRequest } from '../util'
import { Deposit } from './schema'
import type { DepositHistoryFilters, DepositResponse } from './schema'

const ACTIVE_DEPOSIT_STATUSES = ['creating', 'pending', 'processing'] as const
const MAX_ACTIVE_DEPOSIT_ORDERS = 5

type CryptoDepositRow = typeof schema.cryptoDeposit.$inferSelect

interface CreateDepositInput {
  amount: string
  currency: string
  idempotencyKey: string
}

interface CryptoDepositServiceOptions {
  adapter: KuCoinPayAdapter
  db: Db
  redis: Pick<Redis, 'publish'>
}

async function depositResponse(
  db: Db,
  row: CryptoDepositRow,
): Promise<DepositResponse> {
  const active = await findCurrency(db, row.currencyCode)
  const remainingSeconds = row.expiresAt
    ? Math.max(0, Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000))
    : null
  return Deposit.parse({
    actualAmount:
      row.actualAmount === null
        ? null
        : formatAmount(row.actualAmount, active.decimals),
    address: row.address,
    appPayUrl: row.appPayUrl,
    chain: row.chain,
    createdAt: row.createdAt.toISOString(),
    currency: row.currencyCode,
    decimals: active.decimals,
    expectedAmount: formatAmount(row.expectedAmount, active.decimals),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    failureReason: row.failureReason,
    id: row.id,
    platformFee: formatAmount(row.platformFee, active.decimals),
    platformFeeRateBps: row.platformFeeRateBps,
    remainingSeconds,
    status: row.status,
    symbol: row.symbol,
    txHash: row.txHash,
    updatedAt: row.updatedAt.toISOString(),
  })
}

function assertDepositEventMatches(
  order: CryptoDepositRow,
  event: KuCoinDepositEvent,
) {
  if (order.chain !== event.chain || order.symbol !== event.symbol) {
    throw httpErrors.badRequest('Deposit callback asset mismatch')
  }
  if (order.address && event.address && order.address !== event.address) {
    throw httpErrors.badRequest('Deposit callback address mismatch')
  }
  if (
    order.providerOrderId &&
    event.providerOrderId &&
    order.providerOrderId !== event.providerOrderId
  ) {
    throw httpErrors.badRequest('Deposit callback order mismatch')
  }
}

export class CryptoDepositService {
  private readonly adapter: KuCoinPayAdapter
  private readonly db: Db
  private readonly redis: Pick<Redis, 'publish'>

  constructor(options: CryptoDepositServiceOptions) {
    this.adapter = options.adapter
    this.db = options.db
    this.redis = options.redis
  }

  async getConfig(requestedCurrency = 'USDT') {
    const selection = await requireEnabledCryptoRoute(
      this.db,
      requestedCurrency,
      'deposit',
    )
    if (selection.provider.code !== this.adapter.providerCode) {
      throw httpErrors.serviceUnavailable('Crypto deposit provider unavailable')
    }
    const { currency, provider, route } = selection
    return {
      chain: route.chain,
      configured: this.adapter.isConfigured(),
      currency: currency.code,
      decimals: currency.decimals,
      maxDepositAmount:
        route.maxDepositAmount === null
          ? null
          : formatAmount(route.maxDepositAmount, currency.decimals),
      minDepositAmount:
        route.minDepositAmount === null
          ? null
          : formatAmount(route.minDepositAmount, currency.decimals),
      platformFeeRateBps: route.depositFeeRateBps,
      providerCode: provider.code,
      providerName: provider.name,
      symbol: route.symbol,
    }
  }

  async create(input: CreateDepositInput, userId: string) {
    const selection = await requireEnabledCryptoRoute(
      this.db,
      input.currency,
      'deposit',
    )
    if (selection.provider.code !== this.adapter.providerCode) {
      throw httpErrors.serviceUnavailable('Crypto deposit provider unavailable')
    }
    if (!this.adapter.isConfigured()) {
      throw httpErrors.serviceUnavailable('KuCoin Pay is not configured')
    }
    const { currency, provider, route } = selection
    const amount = parseAmount(input.amount, currency.decimals)
    if (amount <= 0n) {
      throw httpErrors.badRequest('Deposit amount must be positive')
    }
    if (route.minDepositAmount !== null && amount < route.minDepositAmount) {
      throw httpErrors.badRequest('Deposit amount is below the route minimum')
    }
    if (route.maxDepositAmount !== null && amount > route.maxDepositAmount) {
      throw httpErrors.badRequest('Deposit amount exceeds the route maximum')
    }

    const requestHash = hashPaymentRequest({
      amount,
      currency: currency.code,
      provider: provider.code,
      route: route.code,
    })
    const existing = await this.db.query.cryptoDeposit.findFirst({
      where: and(
        eq(schema.cryptoDeposit.userId, userId),
        eq(schema.cryptoDeposit.idempotencyKey, input.idempotencyKey),
      ),
    })
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw httpErrors.conflict(
          'Idempotency key was already used with different parameters',
        )
      }
      return depositResponse(this.db, existing)
    }

    const orderId = randomUUID()
    const platformFee = ceilBps(amount, route.depositFeeRateBps)
    const [created] = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`deposit-orders:${userId}:${currency.code}`}, 0))`,
      )
      const activeOrders = await tx.query.cryptoDeposit.findMany({
        columns: { id: true },
        limit: MAX_ACTIVE_DEPOSIT_ORDERS,
        where: and(
          eq(schema.cryptoDeposit.userId, userId),
          inArray(schema.cryptoDeposit.status, [...ACTIVE_DEPOSIT_STATUSES]),
          or(
            isNull(schema.cryptoDeposit.expiresAt),
            sql`${schema.cryptoDeposit.expiresAt} >= now()`,
          ),
        ),
      })
      if (activeOrders.length >= MAX_ACTIVE_DEPOSIT_ORDERS) {
        throw httpErrors.badRequest(
          `You can have at most ${MAX_ACTIVE_DEPOSIT_ORDERS} active deposit orders`,
        )
      }
      return tx
        .insert(schema.cryptoDeposit)
        .values({
          chain: route.chain,
          currencyCode: currency.code,
          expectedAmount: amount,
          id: orderId,
          idempotencyKey: input.idempotencyKey,
          platformFee,
          platformFeeRateBps: route.depositFeeRateBps,
          providerId: provider.id,
          requestHash,
          requestId: orderId,
          routeId: route.id,
          status: 'creating',
          symbol: route.symbol,
          userId,
        })
        .onConflictDoNothing({
          target: [
            schema.cryptoDeposit.userId,
            schema.cryptoDeposit.idempotencyKey,
          ],
        })
        .returning()
    })

    if (!created) {
      const raced = await this.db.query.cryptoDeposit.findFirst({
        where: and(
          eq(schema.cryptoDeposit.userId, userId),
          eq(schema.cryptoDeposit.idempotencyKey, input.idempotencyKey),
        ),
      })
      if (!raced) {
        throw httpErrors.conflict('Deposit order claim failed')
      }
      if (raced.requestHash !== requestHash) {
        throw httpErrors.conflict(
          'Idempotency key was already used with different parameters',
        )
      }
      return depositResponse(this.db, raced)
    }

    try {
      const result = await this.adapter.createDeposit({
        amount,
        chain: route.chain,
        currency: currency.code,
        decimals: currency.decimals,
        requestId: orderId,
        symbol: route.symbol,
      })
      const [updated] = await this.db
        .update(schema.cryptoDeposit)
        .set({
          address: result.address,
          appPayUrl: result.appPayUrl ?? null,
          expiresAt: result.expiresAt,
          providerOrderId: result.providerOrderId,
          providerPayload: result.providerPayload,
          status: 'pending',
        })
        .where(eq(schema.cryptoDeposit.id, orderId))
        .returning()
      if (!updated) {
        throw new Error('Failed to update deposit order')
      }
      return depositResponse(this.db, updated)
    } catch (error) {
      await this.db
        .update(schema.cryptoDeposit)
        .set({
          failureReason: errorMessage(error).slice(0, 500),
          status: 'failed',
        })
        .where(eq(schema.cryptoDeposit.id, orderId))
      throw error
    }
  }

  async getDeposit(userId: string, depositId: string) {
    const row = await this.db.query.cryptoDeposit.findFirst({
      where: and(
        eq(schema.cryptoDeposit.id, depositId),
        eq(schema.cryptoDeposit.userId, userId),
      ),
    })
    if (!row) {
      throw httpErrors.notFound('Deposit not found')
    }
    return depositResponse(this.db, row)
  }

  async listDeposits(userId: string, query: DepositHistoryFilters) {
    const filters: SQL[] = [eq(schema.cryptoDeposit.userId, userId)]
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor)
      const createdAt = new Date(cursor.createdAt)
      const condition = or(
        lt(schema.cryptoDeposit.createdAt, createdAt),
        and(
          eq(schema.cryptoDeposit.createdAt, createdAt),
          lt(schema.cryptoDeposit.id, cursor.id),
        ),
      )
      if (condition) {
        filters.push(condition)
      }
    }
    const rows = await this.db.query.cryptoDeposit.findMany({
      limit: query.limit + 1,
      orderBy: [
        desc(schema.cryptoDeposit.createdAt),
        desc(schema.cryptoDeposit.id),
      ],
      where: and(...filters),
    })
    const page = rows.slice(0, query.limit)
    const last = page.at(-1)
    return {
      items: await Promise.all(
        page.map((row) => depositResponse(this.db, row)),
      ),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    }
  }

  async expireDeposits() {
    const expired = await this.db
      .update(schema.cryptoDeposit)
      .set({ status: 'expired' })
      .where(
        and(
          eq(schema.cryptoDeposit.status, 'pending'),
          isNull(schema.cryptoDeposit.ledgerTransactionId),
          sql`${schema.cryptoDeposit.expiresAt} is not null and ${schema.cryptoDeposit.expiresAt} <= now()`,
        ),
      )
      .returning({ id: schema.cryptoDeposit.id })
    return expired.length
  }

  async reconcileDeposits() {
    if (!this.adapter.isConfigured()) {
      return 0
    }
    const providerId = await this.providerId()
    const rows = await this.db.query.cryptoDeposit.findMany({
      limit: 20,
      orderBy: [schema.cryptoDeposit.createdAt],
      where: and(
        inArray(schema.cryptoDeposit.status, [
          'pending',
          'processing',
          'expired',
        ]),
        isNull(schema.cryptoDeposit.ledgerTransactionId),
        sql`${schema.cryptoDeposit.createdAt} >= now() - interval '24 hours'`,
      ),
    })
    let processed = 0
    for (const row of rows) {
      if (!row.address || row.providerId !== providerId) {
        continue
      }
      try {
        const event = await this.adapter.queryDeposit({
          address: row.address,
          createdAt: row.createdAt,
          currency: row.currencyCode,
          requestId: row.requestId,
        })
        if (event) {
          await this.handleDepositEvent(row.providerId, event)
          processed += 1
        }
        await this.db
          .update(schema.cryptoDeposit)
          .set({
            checkAttempts: sql`${schema.cryptoDeposit.checkAttempts} + 1`,
            lastCheckError: null,
            lastCheckedAt: new Date(),
          })
          .where(eq(schema.cryptoDeposit.id, row.id))
      } catch (error) {
        await this.db
          .update(schema.cryptoDeposit)
          .set({
            checkAttempts: sql`${schema.cryptoDeposit.checkAttempts} + 1`,
            lastCheckError: errorMessage(error).slice(0, 500),
            lastCheckedAt: new Date(),
          })
          .where(eq(schema.cryptoDeposit.id, row.id))
      }
    }
    return processed
  }

  private async providerId() {
    const provider = await this.db.query.paymentProvider.findFirst({
      columns: { id: true },
      where: eq(schema.paymentProvider.code, this.adapter.providerCode),
    })
    if (!provider) {
      throw httpErrors.notFound('Payment provider not found')
    }
    return provider.id
  }

  private async findDepositForEvent(
    providerId: string,
    event: KuCoinDepositEvent,
  ) {
    if (event.requestId) {
      const order = await this.db.query.cryptoDeposit.findFirst({
        where: and(
          eq(schema.cryptoDeposit.providerId, providerId),
          eq(schema.cryptoDeposit.requestId, event.requestId),
        ),
      })
      if (order) {
        return order
      }
    }
    if (event.providerOrderId) {
      const order = await this.db.query.cryptoDeposit.findFirst({
        where: and(
          eq(schema.cryptoDeposit.providerId, providerId),
          eq(schema.cryptoDeposit.providerOrderId, event.providerOrderId),
        ),
      })
      if (order) {
        return order
      }
    }
    if (event.address) {
      return this.db.query.cryptoDeposit.findFirst({
        where: and(
          eq(schema.cryptoDeposit.providerId, providerId),
          eq(schema.cryptoDeposit.address, event.address),
        ),
      })
    }
    return null
  }

  async handleDepositEvent(providerId: string, event: KuCoinDepositEvent) {
    const order = await this.findDepositForEvent(providerId, event)
    if (!order) {
      throw httpErrors.notFound('Deposit order not found')
    }
    assertDepositEventMatches(order, event)

    const active = await findCurrency(this.db, order.currencyCode)
    const amount = event.amount
      ? parseAmount(event.amount, active.decimals)
      : 0n
    if (event.status !== 'succeeded') {
      await this.recordProgressEvent(order, event, amount)
      return
    }
    if (!event.providerTxId || amount <= 0n || !event.address) {
      throw httpErrors.badRequest(
        'Completed deposit callback is missing transaction data',
      )
    }
    const existingByTx = await this.db.query.cryptoDeposit.findFirst({
      where: and(
        eq(schema.cryptoDeposit.providerId, providerId),
        eq(schema.cryptoDeposit.providerTxId, event.providerTxId),
      ),
    })
    if (existingByTx && existingByTx.id !== order.id) {
      throw httpErrors.conflict('Provider deposit transaction was already used')
    }

    const settlement = await this.settleDeposit(
      providerId,
      order,
      event,
      amount,
    )
    if (settlement.mutation) {
      await publishWalletBalance(
        this.redis,
        this.db,
        settlement.userId,
        order.currencyCode,
      )
    }
  }

  private async recordProgressEvent(
    order: CryptoDepositRow,
    event: KuCoinDepositEvent,
    amount: bigint,
  ) {
    await this.db
      .update(schema.cryptoDeposit)
      .set({
        actualAmount: amount > 0n ? amount : order.actualAmount,
        address: event.address ?? order.address,
        failureReason:
          event.status === 'failed'
            ? (event.failureReason ?? 'KuCoin Pay deposit failed').slice(0, 500)
            : null,
        providerOrderId: event.providerOrderId ?? order.providerOrderId,
        status: event.status === 'failed' ? 'failed' : 'processing',
      })
      .where(eq(schema.cryptoDeposit.id, order.id))
  }

  private settleDeposit(
    providerId: string,
    order: CryptoDepositRow,
    event: KuCoinDepositEvent,
    amount: bigint,
  ) {
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(schema.cryptoDeposit)
        .where(eq(schema.cryptoDeposit.id, order.id))
        .for('update')
      if (!locked) {
        throw httpErrors.notFound('Deposit order not found')
      }
      if (locked.status === 'succeeded' && locked.ledgerTransactionId) {
        return { mutation: null, userId: locked.userId }
      }
      const wallet = await ensureWallet(tx, locked.userId, locked.currencyCode)
      const mutation = await creditInTransaction(tx, {
        amount,
        idempotencyKey: `crypto-deposit:${providerId}:${event.providerTxId}`,
        reference: {
          referenceId: locked.id,
          referenceType: WALLET_REFERENCES.deposit,
        },
        walletId: wallet.id,
      })
      const platformFee = ceilBps(amount, locked.platformFeeRateBps ?? 0)
      await tx
        .update(schema.cryptoDeposit)
        .set({
          actualAmount: amount,
          address: event.address,
          failureReason: null,
          ledgerTransactionId: mutation.transactionId,
          platformFee,
          providerOrderId: event.providerOrderId ?? locked.providerOrderId,
          providerPayload: event.providerPayload,
          providerTxId: event.providerTxId,
          status: 'succeeded',
          txHash: event.txHash ?? null,
          walletId: wallet.id,
        })
        .where(eq(schema.cryptoDeposit.id, locked.id))
      return { mutation, userId: locked.userId }
    })
  }
}
