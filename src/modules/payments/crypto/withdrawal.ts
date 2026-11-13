import { randomUUID } from 'node:crypto'

import { httpErrors } from '@fastify/sensible'
import { and, asc, desc, eq, inArray, lt, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type Redis from 'ioredis'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import { currency as findCurrency } from '@/lib/currency'
import { decodeCursor, encodeCursor } from '@/lib/cursor'
import { errorMessage, findErrorCode } from '@/lib/errors'
import { formatAmount, parseAmount } from '@/lib/money'
import { assertWithdrawalAllowed } from '@/modules/risk/service'
import { assertWageringAllowed } from '@/modules/risk/wagering'
import type { WageringGateOptions } from '@/modules/risk/wagering'
import {
  lockInTransaction,
  settleLockInTransaction,
  unlockInTransaction,
} from '@/modules/wallet/ledger'
import { ensureWallet, publishWalletBalance } from '@/modules/wallet/service'
import { WALLET_REFERENCES } from '@/modules/wallet/util'

import { KuCoinPayAdapter } from '../providers/kucoin/adapter'
import type { KuCoinWithdrawalEvent } from '../providers/kucoin/adapter'
import { KuCoinPayoutError } from '../providers/kucoin/payout-error'
import { requireEnabledCryptoRoute } from '../service'
import { hashPaymentRequest } from '../util'
import { Withdrawal } from './schema'
import type { WithdrawalHistoryFilters, WithdrawalResponse } from './schema'

const FEE_CACHE_MS = 10_000
const STALE_SUBMIT_MS = 2 * 60 * 1000
const TERMINAL_STATUSES = ['succeeded', 'failed', 'cancelled'] as const
const RECONCILE_STATUSES = [
  'submit_unconfirmed',
  'processing',
  'pending_approval',
] as const

type CryptoWithdrawalRow = typeof schema.cryptoWithdrawal.$inferSelect

interface RequestWithdrawalInput {
  address: string
  amount: string
  currency: string
  idempotencyKey: string
}

interface CryptoWithdrawalServiceOptions {
  adapter: KuCoinPayAdapter
  db: Db
  redis: Pick<Redis, 'publish'>
  wagering: WageringGateOptions
}

interface FeeQuote {
  expiresAt: number
  fee: bigint
  platformFee: bigint
  receiveAmount: bigint
}

function isTerminal(status: string) {
  return TERMINAL_STATUSES.some((value) => value === status)
}

async function withdrawalResponse(
  db: Db,
  row: CryptoWithdrawalRow,
): Promise<WithdrawalResponse> {
  const active = await findCurrency(db, row.currencyCode)
  return Withdrawal.parse({
    address: row.toAddress,
    amount: formatAmount(row.amount, active.decimals),
    chain: row.chain,
    createdAt: row.createdAt.toISOString(),
    currency: row.currencyCode,
    decimals: active.decimals,
    failureReason: row.failureReason,
    fee: formatAmount(row.fee, active.decimals),
    feeQuotedAt: row.feeQuotedAt?.toISOString() ?? null,
    id: row.id,
    platformFee: formatAmount(row.platformFee, active.decimals),
    providerFee: formatAmount(row.providerFee, active.decimals),
    quotedFee: formatAmount(row.quotedFee, active.decimals),
    receiveAmount: formatAmount(row.amount - row.fee, active.decimals),
    status: row.status,
    symbol: row.symbol,
    txHash: row.txHash,
    updatedAt: row.updatedAt.toISOString(),
  })
}

function assertWithdrawalEventMatches(
  row: CryptoWithdrawalRow,
  event: KuCoinWithdrawalEvent,
  decimals: number,
) {
  if (row.chain !== event.chain || row.symbol !== event.symbol) {
    throw httpErrors.badRequest('Withdrawal callback asset mismatch')
  }
  if (event.address && event.address !== row.toAddress) {
    throw httpErrors.badRequest('Withdrawal callback address mismatch')
  }
  if (event.amount && parseAmount(event.amount, decimals) !== row.amount) {
    throw httpErrors.badRequest('Withdrawal callback amount mismatch')
  }
}

export class CryptoWithdrawalService {
  private readonly adapter: KuCoinPayAdapter
  private readonly db: Db
  private readonly feeCache = new Map<string, FeeQuote>()
  private readonly redis: Pick<Redis, 'publish'>
  private readonly wagering: WageringGateOptions

  constructor(options: CryptoWithdrawalServiceOptions) {
    this.adapter = options.adapter
    this.db = options.db
    this.redis = options.redis
    this.wagering = options.wagering
  }

  async getConfig(requestedCurrency = 'USDT') {
    const selection = await requireEnabledCryptoRoute(
      this.db,
      requestedCurrency,
      'withdrawal',
    )
    if (selection.provider.code !== this.adapter.providerCode) {
      throw httpErrors.serviceUnavailable('Crypto withdrawal unavailable')
    }
    const { currency, provider, route } = selection
    return {
      chain: route.chain,
      configured: this.adapter.isConfigured(),
      currency: currency.code,
      decimals: currency.decimals,
      maxWithdrawAmount:
        route.maxWithdrawAmount === null
          ? null
          : formatAmount(route.maxWithdrawAmount, currency.decimals),
      minWithdrawAmount:
        route.minWithdrawAmount === null
          ? null
          : formatAmount(route.minWithdrawAmount, currency.decimals),
      platformFee: formatAmount(route.payoutFeeFixed, currency.decimals),
      providerCode: provider.code,
      providerName: provider.name,
      symbol: route.symbol,
    }
  }

  async getFee(requestedCurrency: string, amountRaw: string) {
    const selection = await requireEnabledCryptoRoute(
      this.db,
      requestedCurrency,
      'withdrawal',
    )
    if (!this.adapter.isConfigured()) {
      throw httpErrors.serviceUnavailable('KuCoin Pay is not configured')
    }
    if (selection.provider.code !== this.adapter.providerCode) {
      throw httpErrors.serviceUnavailable('Crypto withdrawal unavailable')
    }
    const { currency, route } = selection
    const amount = parseAmount(amountRaw, currency.decimals)
    CryptoWithdrawalService.assertRouteAmount(amount, route)
    const cacheKey = `${route.providerId}:${route.id}:${amount}`
    const now = Date.now()
    const cached = this.feeCache.get(cacheKey)
    const quote =
      cached && cached.expiresAt > now
        ? cached
        : await this.adapter.quoteWithdrawal({
            amount,
            chain: route.chain,
            currency: currency.code,
            decimals: currency.decimals,
            platformFeeFixed: route.payoutFeeFixed,
            symbol: route.symbol,
          })
    if (!cached || cached.expiresAt <= now) {
      this.feeCache.set(cacheKey, {
        expiresAt: now + FEE_CACHE_MS,
        fee: quote.fee,
        platformFee: quote.platformFee,
        receiveAmount: quote.receiveAmount,
      })
    }
    const expiresAt =
      cached && cached.expiresAt > now ? cached.expiresAt : now + FEE_CACHE_MS
    return {
      amount: formatAmount(amount, currency.decimals),
      chain: route.chain,
      currency: currency.code,
      expiresAt: new Date(expiresAt).toISOString(),
      fee: formatAmount(quote.fee, currency.decimals),
      platformFee: formatAmount(quote.platformFee, currency.decimals),
      quotedAt: new Date(now).toISOString(),
      receiveAmount: formatAmount(quote.receiveAmount, currency.decimals),
    }
  }

  async request(input: RequestWithdrawalInput, userId: string) {
    await assertWithdrawalAllowed(this.db, userId)
    const selection = await requireEnabledCryptoRoute(
      this.db,
      input.currency,
      'withdrawal',
    )
    if (selection.provider.code !== this.adapter.providerCode) {
      throw httpErrors.serviceUnavailable('Crypto withdrawal unavailable')
    }
    if (!this.adapter.isConfigured()) {
      throw httpErrors.serviceUnavailable('KuCoin Pay is not configured')
    }
    const { currency, provider, route } = selection
    if (!KuCoinPayAdapter.isValidAddress(route.chain, input.address)) {
      throw httpErrors.badRequest('Invalid withdrawal address')
    }
    const amount = parseAmount(input.amount, currency.decimals)
    CryptoWithdrawalService.assertRouteAmount(amount, route)
    const requestHash = hashPaymentRequest({
      address: input.address,
      amount,
      currency: currency.code,
      provider: provider.code,
      route: route.code,
    })
    const existing = await this.db.query.cryptoWithdrawal.findFirst({
      where: and(
        eq(schema.cryptoWithdrawal.userId, userId),
        eq(schema.cryptoWithdrawal.idempotencyKey, input.idempotencyKey),
      ),
    })
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw httpErrors.conflict(
          'Idempotency key was already used with different parameters',
        )
      }
      return withdrawalResponse(this.db, existing)
    }

    const quote = await this.adapter.quoteWithdrawal({
      amount,
      chain: route.chain,
      currency: currency.code,
      decimals: currency.decimals,
      platformFeeFixed: route.payoutFeeFixed,
      symbol: route.symbol,
    })
    const wallet = await ensureWallet(this.db, userId, currency.code)
    const withdrawalId = randomUUID()

    try {
      const result = await this.db.transaction(async (tx) => {
        await assertWageringAllowed(
          tx,
          userId,
          currency.code,
          amount,
          this.wagering,
        )
        const hold = await lockInTransaction(tx, {
          amount,
          idempotencyKey: `crypto-withdrawal:${withdrawalId}:lock`,
          reference: {
            referenceId: withdrawalId,
            referenceType: WALLET_REFERENCES.withdrawLock,
          },
          walletId: wallet.id,
        })
        const [created] = await tx
          .insert(schema.cryptoWithdrawal)
          .values({
            amount,
            chain: route.chain,
            currencyCode: currency.code,
            fee: quote.fee,
            feeQuotedAt: new Date(),
            id: withdrawalId,
            idempotencyKey: input.idempotencyKey,
            ledgerLockTransactionId: hold.transactionId,
            platformFee: quote.platformFee,
            providerFee: 0n,
            providerId: provider.id,
            quotedFee: quote.fee,
            requestHash,
            routeId: route.id,
            status: 'queued',
            symbol: route.symbol,
            toAddress: input.address,
            userId,
            walletId: wallet.id,
          })
          .returning()
        if (!created) {
          throw new Error('Failed to create withdrawal')
        }
        return created
      })
      await publishWalletBalance(this.redis, this.db, userId, currency.code)
      return withdrawalResponse(this.db, result)
    } catch (error) {
      if (findErrorCode(error) !== '23505') {
        throw error
      }
      const replay = await this.db.query.cryptoWithdrawal.findFirst({
        where: and(
          eq(schema.cryptoWithdrawal.userId, userId),
          eq(schema.cryptoWithdrawal.idempotencyKey, input.idempotencyKey),
        ),
      })
      if (!replay) {
        throw error
      }
      if (replay.requestHash !== requestHash) {
        throw httpErrors.conflict(
          'Idempotency key was already used with different parameters',
        )
      }
      return withdrawalResponse(this.db, replay)
    }
  }

  async getWithdrawal(userId: string, withdrawalId: string) {
    const row = await this.db.query.cryptoWithdrawal.findFirst({
      where: and(
        eq(schema.cryptoWithdrawal.id, withdrawalId),
        eq(schema.cryptoWithdrawal.userId, userId),
      ),
    })
    if (!row) {
      throw httpErrors.notFound('Withdrawal not found')
    }
    return withdrawalResponse(this.db, row)
  }

  async listWithdrawals(userId: string, query: WithdrawalHistoryFilters) {
    const filters: SQL[] = [eq(schema.cryptoWithdrawal.userId, userId)]
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor)
      const createdAt = new Date(cursor.createdAt)
      const condition = or(
        lt(schema.cryptoWithdrawal.createdAt, createdAt),
        and(
          eq(schema.cryptoWithdrawal.createdAt, createdAt),
          lt(schema.cryptoWithdrawal.id, cursor.id),
        ),
      )
      if (condition) {
        filters.push(condition)
      }
    }
    const rows = await this.db.query.cryptoWithdrawal.findMany({
      limit: query.limit + 1,
      orderBy: [
        desc(schema.cryptoWithdrawal.createdAt),
        desc(schema.cryptoWithdrawal.id),
      ],
      where: and(...filters),
    })
    const page = rows.slice(0, query.limit)
    const last = page.at(-1)
    return {
      items: await Promise.all(
        page.map((row) => withdrawalResponse(this.db, row)),
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

  async processPending() {
    if (!this.adapter.isConfigured()) {
      return 0
    }
    const rows = await this.db.query.cryptoWithdrawal.findMany({
      limit: 20,
      orderBy: [asc(schema.cryptoWithdrawal.createdAt)],
      where: eq(schema.cryptoWithdrawal.status, 'queued'),
    })
    let submitted = 0
    for (const row of rows) {
      const claimed = await this.claim(row.id)
      if (!claimed) {
        continue
      }
      await this.submit(claimed)
      submitted += 1
    }
    return submitted
  }

  async reconcileWithdrawals() {
    if (!this.adapter.isConfigured()) {
      return 0
    }
    await this.db
      .update(schema.cryptoWithdrawal)
      .set({
        lastCheckError: 'Submission outcome was not confirmed before recovery',
        status: 'submit_unconfirmed',
      })
      .where(
        and(
          eq(schema.cryptoWithdrawal.status, 'submitting'),
          lt(
            schema.cryptoWithdrawal.updatedAt,
            new Date(Date.now() - STALE_SUBMIT_MS),
          ),
        ),
      )
    const rows = await this.db.query.cryptoWithdrawal.findMany({
      limit: 20,
      orderBy: [asc(schema.cryptoWithdrawal.createdAt)],
      where: inArray(schema.cryptoWithdrawal.status, [...RECONCILE_STATUSES]),
    })
    let reconciled = 0
    for (const row of rows) {
      try {
        const event = await this.adapter.queryWithdrawal(
          row.id,
          row.externalRefId ?? undefined,
        )
        if (event) {
          await this.handleWithdrawalEvent(row.providerId, event)
          reconciled += 1
        }
        await this.db
          .update(schema.cryptoWithdrawal)
          .set({
            lastCheckError: null,
            lastCheckedAt: new Date(),
          })
          .where(eq(schema.cryptoWithdrawal.id, row.id))
      } catch (error) {
        await this.db
          .update(schema.cryptoWithdrawal)
          .set({
            lastCheckError: errorMessage(error).slice(0, 500),
            lastCheckedAt: new Date(),
          })
          .where(eq(schema.cryptoWithdrawal.id, row.id))
      }
    }
    return reconciled
  }

  async handleWithdrawalEvent(
    providerId: string,
    event: KuCoinWithdrawalEvent,
  ) {
    if (!event.requestId) {
      throw httpErrors.badRequest('Withdrawal callback request ID is missing')
    }
    const row = await this.db.query.cryptoWithdrawal.findFirst({
      where: and(
        eq(schema.cryptoWithdrawal.id, event.requestId),
        eq(schema.cryptoWithdrawal.providerId, providerId),
      ),
    })
    if (!row) {
      throw httpErrors.notFound('Withdrawal not found')
    }
    const active = await findCurrency(this.db, row.currencyCode)
    assertWithdrawalEventMatches(row, event, active.decimals)
    if (isTerminal(row.status)) {
      return
    }
    if (event.status === 'succeeded') {
      await this.complete(row, event, active.decimals)
      return
    }
    if (event.status === 'failed') {
      await this.fail(row.id, event.failureReason ?? 'KuCoin Pay payout failed')
      return
    }
    await this.db
      .update(schema.cryptoWithdrawal)
      .set({
        externalRefId: event.providerBatchId ?? row.externalRefId,
        lastCheckError: null,
        lastCheckedAt: new Date(),
        providerPayload: event.providerPayload,
        status: event.status,
        txHash: event.txHash ?? row.txHash,
      })
      .where(eq(schema.cryptoWithdrawal.id, row.id))
  }

  private static assertRouteAmount(
    amount: bigint,
    route: typeof schema.cryptoRoute.$inferSelect,
  ) {
    if (amount <= 0n) {
      throw httpErrors.badRequest('Withdrawal amount must be positive')
    }
    if (route.minWithdrawAmount !== null && amount < route.minWithdrawAmount) {
      throw httpErrors.badRequest(
        'Withdrawal amount is below the route minimum',
      )
    }
    if (route.maxWithdrawAmount !== null && amount > route.maxWithdrawAmount) {
      throw httpErrors.badRequest('Withdrawal amount exceeds the route maximum')
    }
  }

  private claim(withdrawalId: string) {
    return this.db
      .update(schema.cryptoWithdrawal)
      .set({ status: 'submitting' })
      .where(
        and(
          eq(schema.cryptoWithdrawal.id, withdrawalId),
          eq(schema.cryptoWithdrawal.status, 'queued'),
        ),
      )
      .returning()
      .then((rows) => rows[0] ?? null)
  }

  private async submit(row: CryptoWithdrawalRow) {
    try {
      const active = await findCurrency(this.db, row.currencyCode)
      const result = await this.adapter.submitWithdrawal({
        amount: row.amount,
        chain: row.chain,
        currency: row.currencyCode,
        decimals: active.decimals,
        platformFeeFixed: row.platformFee,
        requestId: row.id,
        symbol: row.symbol,
        toAddress: row.toAddress,
      })
      await this.db
        .update(schema.cryptoWithdrawal)
        .set({
          externalRefId: result.externalRefId,
          fee: result.fee,
          lastCheckError: null,
          platformFee: result.platformFee,
          providerFee: result.fee,
          status: result.status,
          submittedAt: new Date(),
        })
        .where(eq(schema.cryptoWithdrawal.id, row.id))
    } catch (error) {
      const failureClass =
        error instanceof KuCoinPayoutError ? error.failureClass : 'unknown'
      if (failureClass === 'rejected') {
        await this.fail(row.id, errorMessage(error))
        return
      }
      await this.db
        .update(schema.cryptoWithdrawal)
        .set({
          lastCheckError: errorMessage(error).slice(0, 500),
          status:
            failureClass === 'retry_later' ? 'queued' : 'submit_unconfirmed',
        })
        .where(eq(schema.cryptoWithdrawal.id, row.id))
    }
  }

  private async complete(
    row: CryptoWithdrawalRow,
    event: KuCoinWithdrawalEvent,
    decimals: number,
  ) {
    const providerFee = event.providerFee
      ? parseAmount(event.providerFee, decimals)
      : row.providerFee
    const result = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(schema.cryptoWithdrawal)
        .where(eq(schema.cryptoWithdrawal.id, row.id))
        .for('update')
      if (!locked) {
        throw httpErrors.notFound('Withdrawal not found')
      }
      if (locked.status === 'succeeded') {
        return null
      }
      const settled = await settleLockInTransaction(tx, {
        idempotencyKey: `crypto-withdrawal:${locked.id}:settle`,
        lockedAmount: locked.amount,
        payout: 0n,
        reference: {
          referenceId: locked.id,
          referenceType: WALLET_REFERENCES.withdraw,
        },
        walletId: locked.walletId,
      })
      await tx
        .update(schema.cryptoWithdrawal)
        .set({
          externalRefId: event.providerBatchId ?? locked.externalRefId,
          failureReason: null,
          fee: providerFee,
          ledgerSettleTransactionId: settled.transactionId,
          providerFee,
          providerPayload: event.providerPayload,
          settledAt: new Date(),
          status: 'succeeded',
          txHash: event.txHash ?? locked.txHash,
        })
        .where(eq(schema.cryptoWithdrawal.id, locked.id))
      return locked
    })
    if (result) {
      await publishWalletBalance(
        this.redis,
        this.db,
        result.userId,
        result.currencyCode,
      )
    }
  }

  private async fail(withdrawalId: string, reason: string) {
    const result = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(schema.cryptoWithdrawal)
        .where(eq(schema.cryptoWithdrawal.id, withdrawalId))
        .for('update')
      if (!locked || isTerminal(locked.status)) {
        return null
      }
      const unlocked = await unlockInTransaction(tx, {
        amount: locked.amount,
        idempotencyKey: `crypto-withdrawal:${locked.id}:unlock`,
        reference: {
          referenceId: locked.id,
          referenceType: WALLET_REFERENCES.withdrawUnlock,
        },
        walletId: locked.walletId,
      })
      await tx
        .update(schema.cryptoWithdrawal)
        .set({
          failureReason: reason.slice(0, 500),
          ledgerUnlockTransactionId: unlocked.transactionId,
          settledAt: new Date(),
          status: 'failed',
        })
        .where(eq(schema.cryptoWithdrawal.id, locked.id))
      return locked
    })
    if (result) {
      await publishWalletBalance(
        this.redis,
        this.db,
        result.userId,
        result.currencyCode,
      )
    }
  }
}
