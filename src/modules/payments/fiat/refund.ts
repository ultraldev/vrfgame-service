import { randomUUID } from 'node:crypto'

import { and, eq, ne } from 'drizzle-orm'
import type Redis from 'ioredis'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import { chargebackInTransaction } from '@/modules/wallet/ledger'
import { ensureWallet, publishWalletBalance } from '@/modules/wallet/service'
import { WALLET_REFERENCES } from '@/modules/wallet/util'

import type { ZeffraEvent } from '../providers/zeffra/types'
import { hashPaymentRequest } from '../util'

const REFUND_STATUS = {
  failed: 'failed',
  pending: 'pending',
  succeeded: 'succeeded',
} as const

interface FiatRefundServiceOptions {
  db: Db
  redis: Pick<Redis, 'publish'>
}

export class FiatRefundService {
  private readonly db: Db
  private readonly redis: Pick<Redis, 'publish'>

  constructor(options: FiatRefundServiceOptions) {
    this.db = options.db
    this.redis = options.redis
  }

  async handleRefundEvent(providerId: string, event: ZeffraEvent) {
    if (event.type !== 'refund') {
      throw new Error('Expected a fiat refund event')
    }
    const refundAmount = BigInt(event.amount)
    if (refundAmount <= 0n) {
      throw Object.assign(new Error('Refund amount must be positive'), {
        statusCode: 400,
      })
    }
    const original = await this.db.query.fiatOrder.findFirst({
      where: and(
        eq(schema.fiatOrder.providerId, providerId),
        eq(schema.fiatOrder.merchantOrderNo, event.merchantOrderNo),
        eq(schema.fiatOrder.type, 'deposit'),
      ),
    })
    if (!original) {
      throw Object.assign(new Error('Original fiat deposit not found'), {
        statusCode: 404,
      })
    }
    if (event.currency && event.currency !== original.currencyCode) {
      throw Object.assign(new Error('Fiat refund currency mismatch'), {
        statusCode: 400,
      })
    }
    if (refundAmount > original.amount) {
      throw Object.assign(new Error('Fiat refund exceeds original deposit'), {
        statusCode: 400,
      })
    }
    if (!original.ledgerTransactionId) {
      throw Object.assign(new Error('Fiat deposit has not been credited'), {
        statusCode: 409,
      })
    }

    const requestHash = hashPaymentRequest({
      amount: refundAmount,
      currency: original.currencyCode,
      merchantOrderNo: event.merchantOrderNo,
      providerOrderNo: event.providerOrderNo,
    })
    const result = await this.db.transaction(async (tx) => {
      const [lockedOriginal] = await tx
        .select()
        .from(schema.fiatOrder)
        .where(eq(schema.fiatOrder.id, original.id))
        .for('update')
      if (!lockedOriginal || !lockedOriginal.ledgerTransactionId) {
        throw Object.assign(new Error('Fiat deposit has not been credited'), {
          statusCode: 409,
        })
      }

      const existing = await tx.query.fiatOrder.findFirst({
        where: and(
          eq(schema.fiatOrder.providerId, providerId),
          eq(schema.fiatOrder.providerOrderNo, event.providerOrderNo),
          eq(schema.fiatOrder.type, 'refund'),
        ),
      })
      if (existing && existing.amount !== refundAmount) {
        throw Object.assign(
          new Error('Fiat refund identifier is already in use'),
          { statusCode: 409 },
        )
      }
      if (existing?.status === 'succeeded') {
        return null
      }

      const refundId = existing?.id ?? randomUUID()
      const refundStatus = REFUND_STATUS[event.status]
      const failureReason =
        event.status === 'failed'
          ? (event.failReason ?? 'Zeffra refund failed').slice(0, 500)
          : null
      await (existing
        ? tx
            .update(schema.fiatOrder)
            .set({
              failureReason,
              providerPayload: event.providerPayload,
              status: refundStatus,
            })
            .where(eq(schema.fiatOrder.id, refundId))
        : tx.insert(schema.fiatOrder).values({
            amount: refundAmount,
            currencyCode: lockedOriginal.currencyCode,
            failureReason,
            id: refundId,
            idempotencyKey: `fiat-refund:${providerId}:${event.providerOrderNo}`,
            merchantOrderNo: event.merchantOrderNo,
            originalOrderId: lockedOriginal.id,
            providerId,
            providerOrderNo: event.providerOrderNo,
            providerPayload: event.providerPayload,
            requestHash,
            routeId: lockedOriginal.routeId,
            status: refundStatus,
            type: 'refund',
            userId: lockedOriginal.userId,
          }))

      if (event.status !== 'succeeded') {
        return null
      }

      const refunds = await tx.query.fiatOrder.findMany({
        columns: { amount: true },
        where: and(
          eq(schema.fiatOrder.providerId, providerId),
          eq(schema.fiatOrder.originalOrderId, lockedOriginal.id),
          eq(schema.fiatOrder.type, 'refund'),
          eq(schema.fiatOrder.status, 'succeeded'),
          ne(schema.fiatOrder.id, refundId),
        ),
      })
      const alreadyRefunded = refunds.reduce(
        (total, refund) => total + refund.amount,
        0n,
      )
      if (alreadyRefunded + refundAmount > lockedOriginal.amount) {
        throw Object.assign(
          new Error('Fiat refunds exceed the original deposit'),
          { statusCode: 409 },
        )
      }

      const wallet = await ensureWallet(
        tx,
        lockedOriginal.userId,
        lockedOriginal.currencyCode,
      )
      const mutation = await chargebackInTransaction(tx, {
        amount: refundAmount,
        idempotencyKey: `fiat-refund:${providerId}:${event.providerOrderNo}`,
        reference: {
          referenceId: refundId,
          referenceType: WALLET_REFERENCES.depositRefund,
        },
        walletId: wallet.id,
      })
      await tx
        .update(schema.fiatOrder)
        .set({
          failureReason: null,
          ledgerTransactionId: mutation.transactionId,
          providerPayload: event.providerPayload,
          settledAt: new Date(),
          status: 'succeeded',
          walletId: wallet.id,
        })
        .where(eq(schema.fiatOrder.id, refundId))
      return {
        currency: lockedOriginal.currencyCode,
        userId: lockedOriginal.userId,
      }
    })
    if (result) {
      await publishWalletBalance(
        this.redis,
        this.db,
        result.userId,
        result.currency,
      )
    }
  }
}
