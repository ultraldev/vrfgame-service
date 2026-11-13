import { randomUUID } from 'node:crypto'

import { httpErrors } from '@fastify/sensible'
import { and, asc, eq, inArray, lt } from 'drizzle-orm'
import type Redis from 'ioredis'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import { currency as findCurrency } from '@/lib/currency'
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

import type { ZeffraAdapter } from '../providers/zeffra/adapter'
import { ZeffraRequestError } from '../providers/zeffra/error'
import type { ZeffraEvent, ZeffraRecipient } from '../providers/zeffra/types'
import { requireEnabledFiatRoute } from '../service'
import { ceilBps, hashPaymentRequest } from '../util'
import { findFiatRouteCode, listFiatOrders } from './order'
import type { FiatOrderRow } from './order'
import { FiatPayout } from './schema'
import type { FiatHistoryFilters, FiatPayoutResponse } from './schema'
import { resolveFiatPayoutAccount } from './util'

const RECONCILE_AFTER_MS = 5 * 60 * 1000
const STALE_SUBMIT_MS = 2 * 60 * 1000

interface FiatPayoutServiceOptions {
  adapter: ZeffraAdapter
  db: Db
  redis: Pick<Redis, 'publish'>
  wagering: WageringGateOptions
}

interface RequestPayoutInput {
  amount: string
  bankCode?: string
  currency: string
  ext1?: string
  ext2?: string
  ext3?: string
  idempotencyKey: string
  receiveAccount: string
  receiveAccountExpireAt?: string
  recipient?: ZeffraRecipient
  routeCode: string
}

interface PayoutRequestPayload {
  bankCode?: string
  ext1?: string
  ext2?: string
  ext3?: string
  receiveAccount: string
  receiveAccountExpireAt?: string
  recipient: ZeffraRecipient
}

function requestPayload(row: FiatOrderRow): PayoutRequestPayload {
  const payload = row.requestPayload
  if (
    !payload ||
    typeof payload.receiveAccount !== 'string' ||
    typeof payload.recipient !== 'object' ||
    payload.recipient === null
  ) {
    throw new Error('Fiat payout request payload is missing')
  }
  return payload as unknown as PayoutRequestPayload
}

async function payoutResponse(
  db: Db,
  row: FiatOrderRow,
): Promise<FiatPayoutResponse> {
  const active = await findCurrency(db, row.currencyCode)
  const routeCode = await findFiatRouteCode(db, row.routeId)
  return FiatPayout.parse({
    amount: formatAmount(row.amount, active.decimals),
    confirmUrl: row.confirmUrl,
    createdAt: row.createdAt.toISOString(),
    currency: row.currencyCode,
    failureReason: row.failureReason,
    id: row.id,
    needUserConfirm: row.needUserConfirm,
    payoutAmount: formatAmount(row.payoutAmount ?? 0n, active.decimals),
    routeCode,
    status: row.status,
    type: 'payout',
    updatedAt: row.updatedAt.toISOString(),
    userFee: formatAmount(row.userFee, active.decimals),
  })
}

export class FiatPayoutService {
  private readonly adapter: ZeffraAdapter
  private readonly db: Db
  private readonly redis: Pick<Redis, 'publish'>
  private readonly wagering: WageringGateOptions

  constructor(options: FiatPayoutServiceOptions) {
    this.adapter = options.adapter
    this.db = options.db
    this.redis = options.redis
    this.wagering = options.wagering
  }

  async request(input: RequestPayoutInput, userId: string) {
    await assertWithdrawalAllowed(this.db, userId)
    const context = await this.context(input, userId)
    const {
      currency,
      payoutAmount,
      payload,
      provider,
      requestHash,
      route,
      userFee,
    } = context
    const existing = await this.db.query.fiatOrder.findFirst({
      where: and(
        eq(schema.fiatOrder.userId, userId),
        eq(schema.fiatOrder.idempotencyKey, input.idempotencyKey),
      ),
    })
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw httpErrors.conflict(
          'Idempotency key was already used with different parameters',
        )
      }
      return payoutResponse(this.db, existing)
    }

    const wallet = await ensureWallet(this.db, userId, currency.code)
    const orderId = randomUUID()
    const review =
      route.reviewWithdrawAmount !== null &&
      context.amount >= route.reviewWithdrawAmount

    try {
      const created = await this.db.transaction(async (tx) => {
        await assertWageringAllowed(
          tx,
          userId,
          currency.code,
          context.amount,
          this.wagering,
        )
        const hold = await lockInTransaction(tx, {
          amount: context.amount,
          idempotencyKey: `fiat-payout:${orderId}:lock`,
          reference: {
            referenceId: orderId,
            referenceType: WALLET_REFERENCES.withdrawLock,
          },
          walletId: wallet.id,
        })
        const [order] = await tx
          .insert(schema.fiatOrder)
          .values({
            amount: context.amount,
            currencyCode: currency.code,
            id: orderId,
            idempotencyKey: input.idempotencyKey,
            ledgerLockTransactionId: hold.transactionId,
            merchantOrderNo: orderId,
            payoutAmount,
            providerFee: route.payoutFeeFixed,
            providerId: provider.id,
            requestHash,
            requestPayload: payload as unknown as Record<string, unknown>,
            routeId: route.id,
            status: review ? 'pending_review' : 'queued',
            type: 'payout',
            userFee,
            userId,
            walletId: wallet.id,
          })
          .returning()
        if (!order) {
          throw new Error('Failed to create fiat payout')
        }
        return order
      })
      await publishWalletBalance(this.redis, this.db, userId, currency.code)
      return payoutResponse(this.db, created)
    } catch (error) {
      if (findErrorCode(error) !== '23505') {
        throw error
      }
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
      return payoutResponse(this.db, replay)
    }
  }

  private async context(input: RequestPayoutInput, userId: string) {
    const selection = await requireEnabledFiatRoute(
      this.db,
      input.routeCode,
      input.currency,
      'withdrawal',
    )
    if (selection.provider.code !== this.adapter.providerCode) {
      throw httpErrors.serviceUnavailable('Fiat payout provider unavailable')
    }
    if (!this.adapter.isConfigured()) {
      throw httpErrors.serviceUnavailable('Zeffra is not configured')
    }
    const { currency, provider, route } = selection
    if (currency.decimals !== this.adapter.orderDecimals) {
      throw httpErrors.serviceUnavailable(
        'Fiat route currency precision is not supported',
      )
    }
    const amount = parseAmount(input.amount, currency.decimals)
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
    const userFee = ceilBps(amount, route.payoutFeeRateBps)
    const payoutAmount = amount - userFee
    if (payoutAmount <= 0n) {
      throw httpErrors.badRequest('Withdrawal amount must exceed the user fee')
    }
    const account = resolveFiatPayoutAccount({
      receiveAccount: input.receiveAccount,
      receiveAccountExpireAt: input.receiveAccountExpireAt,
      recipient: input.recipient,
      route,
      userId,
    })
    const payload: PayoutRequestPayload = {
      bankCode: input.bankCode,
      ext1: input.ext1,
      ext2: input.ext2,
      ext3: input.ext3,
      ...account,
    }
    const requestHash = hashPaymentRequest({
      amount,
      bankCode: input.bankCode ?? '',
      currency: currency.code,
      ext1: input.ext1 ?? '',
      ext2: input.ext2 ?? '',
      ext3: input.ext3 ?? '',
      provider: provider.code,
      receiveAccount: account.receiveAccount,
      receiveAccountExpireAt: account.receiveAccountExpireAt,
      recipient: JSON.stringify(account.recipient),
      route: route.code,
    })
    return {
      amount,
      currency,
      payload,
      payoutAmount,
      provider,
      requestHash,
      route,
      userFee,
    }
  }

  async approveReview(orderId: string) {
    const row = await this.db.query.fiatOrder.findFirst({
      where: and(
        eq(schema.fiatOrder.id, orderId),
        eq(schema.fiatOrder.type, 'payout'),
      ),
    })
    if (!row) {
      throw httpErrors.notFound('Fiat payout not found')
    }
    if (row.status !== 'pending_review') {
      throw httpErrors.badRequest('Withdrawal is not awaiting review')
    }
    const route = await this.db.query.fiatRoute.findFirst({
      where: eq(schema.fiatRoute.id, row.routeId),
    })
    if (!route) {
      throw httpErrors.notFound('Fiat route not found')
    }
    if (!this.adapter.isConfigured()) {
      throw httpErrors.serviceUnavailable('Zeffra is not configured')
    }
    await assertWithdrawalAllowed(this.db, row.userId)
    const selection = await requireEnabledFiatRoute(
      this.db,
      route.code,
      row.currencyCode,
      'withdrawal',
    )
    if (selection.currency.decimals !== this.adapter.orderDecimals) {
      throw httpErrors.serviceUnavailable(
        'Fiat route currency precision is not supported',
      )
    }
    const [approved] = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(schema.fiatOrder)
        .where(eq(schema.fiatOrder.id, orderId))
        .for('update')
      if (!locked || locked.status !== 'pending_review') {
        throw httpErrors.badRequest('Withdrawal is not awaiting review')
      }
      await assertWageringAllowed(
        tx,
        locked.userId,
        locked.currencyCode,
        0n,
        this.wagering,
      )
      return tx
        .update(schema.fiatOrder)
        .set({ failureReason: null, status: 'queued' })
        .where(eq(schema.fiatOrder.id, orderId))
        .returning()
    })
    if (!approved) {
      throw new Error('Failed to approve fiat payout')
    }
    return payoutResponse(this.db, approved)
  }

  async rejectReview(orderId: string, reason?: string) {
    const row = await this.db.query.fiatOrder.findFirst({
      where: and(
        eq(schema.fiatOrder.id, orderId),
        eq(schema.fiatOrder.type, 'payout'),
      ),
    })
    if (!row) {
      throw httpErrors.notFound('Fiat payout not found')
    }
    if (row.status !== 'pending_review') {
      throw httpErrors.badRequest('Withdrawal is not awaiting review')
    }
    await this.fail(orderId, reason?.trim() || 'Rejected by operator', [
      'pending_review',
    ])
    return this.getOrder(row.userId, orderId)
  }

  async getOrder(userId: string, orderId: string) {
    const row = await this.db.query.fiatOrder.findFirst({
      where: and(
        eq(schema.fiatOrder.id, orderId),
        eq(schema.fiatOrder.userId, userId),
        eq(schema.fiatOrder.type, 'payout'),
      ),
    })
    if (!row) {
      throw httpErrors.notFound('Fiat payout not found')
    }
    return payoutResponse(this.db, row)
  }

  listOrders(userId: string, query: FiatHistoryFilters) {
    return listFiatOrders(this.db, userId, 'payout', query, (row) =>
      payoutResponse(this.db, row),
    )
  }

  async processPending() {
    if (!this.adapter.isConfigured()) {
      return 0
    }
    await this.db
      .update(schema.fiatOrder)
      .set({
        failureReason: 'Submission outcome was not confirmed before recovery',
        status: 'submit_unconfirmed',
      })
      .where(
        and(
          eq(schema.fiatOrder.type, 'payout'),
          eq(schema.fiatOrder.status, 'submitting'),
          lt(
            schema.fiatOrder.updatedAt,
            new Date(Date.now() - STALE_SUBMIT_MS),
          ),
        ),
      )
    const rows = await this.db.query.fiatOrder.findMany({
      limit: 20,
      orderBy: [asc(schema.fiatOrder.createdAt)],
      where: and(
        eq(schema.fiatOrder.type, 'payout'),
        eq(schema.fiatOrder.status, 'queued'),
      ),
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

  async handlePayoutEvent(providerId: string, event: ZeffraEvent) {
    const row = await this.db.query.fiatOrder.findFirst({
      where: and(
        eq(schema.fiatOrder.providerId, providerId),
        eq(schema.fiatOrder.merchantOrderNo, event.merchantOrderNo),
        eq(schema.fiatOrder.type, 'payout'),
      ),
    })
    if (!row) {
      throw httpErrors.notFound('Fiat payout not found')
    }
    if (
      row.payoutAmount !== null &&
      BigInt(event.amount) !== row.payoutAmount
    ) {
      throw httpErrors.badRequest('Fiat payout callback amount mismatch')
    }
    if (event.status === 'succeeded') {
      await this.settle(row, event)
      return
    }
    if (event.status === 'failed') {
      await this.fail(
        row.id,
        event.failReason ?? 'Zeffra payout failed',
        undefined,
        event,
      )
      return
    }
    await this.db
      .update(schema.fiatOrder)
      .set({
        providerOrderNo: event.providerOrderNo,
        providerPayload: event.providerPayload,
        status: row.status === 'pending_approval' ? row.status : 'processing',
      })
      .where(eq(schema.fiatOrder.id, row.id))
  }

  async reconcilePayouts() {
    if (!this.adapter.isConfigured()) {
      return 0
    }
    const rows = await this.db.query.fiatOrder.findMany({
      limit: 50,
      orderBy: [asc(schema.fiatOrder.createdAt)],
      where: and(
        eq(schema.fiatOrder.type, 'payout'),
        inArray(schema.fiatOrder.status, [
          'submit_unconfirmed',
          'processing',
          'pending_approval',
        ]),
        lt(
          schema.fiatOrder.createdAt,
          new Date(Date.now() - RECONCILE_AFTER_MS),
        ),
      ),
    })
    let processed = 0
    for (const row of rows) {
      try {
        const result = await this.adapter.queryPayout(row.merchantOrderNo)
        if (!result.found) {
          continue
        }
        if (result.status === 'succeeded') {
          await this.settle(row, result)
          processed += 1
        } else if (result.status === 'failed') {
          await this.fail(
            row.id,
            result.failReason ?? 'Zeffra payout failed',
            undefined,
            result,
          )
          processed += 1
        } else {
          await this.db
            .update(schema.fiatOrder)
            .set({
              confirmUrl: result.confirmUrl ?? row.confirmUrl,
              needUserConfirm: result.needUserConfirm ?? row.needUserConfirm,
              providerOrderNo: result.providerOrderNo ?? row.providerOrderNo,
              providerPayload: result.providerPayload,
              status: result.needUserConfirm
                ? 'pending_approval'
                : 'processing',
            })
            .where(eq(schema.fiatOrder.id, row.id))
        }
      } catch (error) {
        await this.db
          .update(schema.fiatOrder)
          .set({ failureReason: errorMessage(error).slice(0, 500) })
          .where(eq(schema.fiatOrder.id, row.id))
      }
    }
    return processed
  }

  private claim(orderId: string) {
    return this.db
      .update(schema.fiatOrder)
      .set({ status: 'submitting' })
      .where(
        and(
          eq(schema.fiatOrder.id, orderId),
          eq(schema.fiatOrder.status, 'queued'),
        ),
      )
      .returning()
      .then((rows) => rows[0] ?? null)
  }

  private async submit(row: FiatOrderRow) {
    const route = await this.db.query.fiatRoute.findFirst({
      where: eq(schema.fiatRoute.id, row.routeId),
    })
    if (!route) {
      await this.fail(row.id, 'Fiat route not found')
      return
    }
    try {
      const payload = requestPayload(row)
      const result = await this.adapter.createPayout({
        amount: row.payoutAmount ?? row.amount,
        bankCode: payload.bankCode,
        currency: row.currencyCode,
        ext1: payload.ext1,
        ext2: payload.ext2,
        ext3: payload.ext3,
        merchantOrderNo: row.merchantOrderNo,
        providerPaymentCode: route.providerPaymentCode,
        receiveAccount: payload.receiveAccount,
        receiveAccountExpireAt: payload.receiveAccountExpireAt,
        recipient: payload.recipient,
        userId: row.userId,
      })
      await this.db
        .update(schema.fiatOrder)
        .set({
          confirmUrl: result.confirmUrl ?? null,
          needUserConfirm: result.needUserConfirm,
          providerOrderNo: result.providerOrderNo,
          status: result.needUserConfirm ? 'pending_approval' : 'processing',
          submittedAt: new Date(),
        })
        .where(eq(schema.fiatOrder.id, row.id))
    } catch (error) {
      const retryable = error instanceof ZeffraRequestError && error.retryable
      await (retryable
        ? this.fail(row.id, errorMessage(error))
        : this.db
            .update(schema.fiatOrder)
            .set({
              failureReason: errorMessage(error).slice(0, 500),
              status: 'submit_unconfirmed',
            })
            .where(eq(schema.fiatOrder.id, row.id)))
    }
  }

  private async settle(
    row: FiatOrderRow,
    provider: {
      providerOrderNo?: string
      providerPayload?: Record<string, unknown>
    } = {},
  ) {
    const result = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(schema.fiatOrder)
        .where(eq(schema.fiatOrder.id, row.id))
        .for('update')
      if (!locked || locked.status === 'succeeded') {
        return null
      }
      const settled = await settleLockInTransaction(tx, {
        idempotencyKey: `fiat-payout:${locked.id}:settle`,
        lockedAmount: locked.amount,
        payout: 0n,
        reference: {
          referenceId: locked.id,
          referenceType: WALLET_REFERENCES.withdraw,
        },
        walletId: locked.walletId ?? '',
      })
      await tx
        .update(schema.fiatOrder)
        .set({
          confirmUrl: null,
          failureReason: null,
          ledgerSettleTransactionId: settled.transactionId,
          needUserConfirm: false,
          providerOrderNo: provider.providerOrderNo ?? locked.providerOrderNo,
          providerPayload: provider.providerPayload ?? locked.providerPayload,
          settledAt: new Date(),
          status: 'succeeded',
        })
        .where(eq(schema.fiatOrder.id, locked.id))
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

  private async fail(
    orderId: string,
    reason: string,
    expected?: readonly string[],
    provider: {
      providerOrderNo?: string
      providerPayload?: Record<string, unknown>
    } = {},
  ) {
    const result = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(schema.fiatOrder)
        .where(eq(schema.fiatOrder.id, orderId))
        .for('update')
      if (
        !locked ||
        locked.status === 'succeeded' ||
        locked.status === 'failed' ||
        (expected && !expected.includes(locked.status))
      ) {
        return null
      }
      const unlocked = await unlockInTransaction(tx, {
        amount: locked.amount,
        idempotencyKey: `fiat-payout:${locked.id}:unlock`,
        reference: {
          referenceId: locked.id,
          referenceType: WALLET_REFERENCES.withdrawUnlock,
        },
        walletId: locked.walletId ?? '',
      })
      await tx
        .update(schema.fiatOrder)
        .set({
          confirmUrl: null,
          failureReason: reason.slice(0, 500),
          ledgerUnlockTransactionId: unlocked.transactionId,
          needUserConfirm: false,
          providerOrderNo: provider.providerOrderNo ?? locked.providerOrderNo,
          providerPayload: provider.providerPayload ?? locked.providerPayload,
          settledAt: new Date(),
          status: 'failed',
        })
        .where(eq(schema.fiatOrder.id, locked.id))
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
