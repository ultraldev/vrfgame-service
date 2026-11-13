import { createHash, randomUUID } from 'node:crypto'

import { httpErrors } from '@fastify/sensible'
import { and, eq } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import { errorMessage } from '@/lib/errors'

import type { CryptoDepositService } from './crypto/deposit'
import type { CryptoWithdrawalService } from './crypto/withdrawal'
import type { FiatDepositService } from './fiat/deposit'
import type { FiatPayoutService } from './fiat/payout'
import type { FiatRefundService } from './fiat/refund'
import type {
  KuCoinDepositEvent,
  KuCoinPayAdapter,
  KuCoinWithdrawalEvent,
} from './providers/kucoin/adapter'
import { ZeffraAdapter } from './providers/zeffra/adapter'
import type { ZeffraEvent } from './providers/zeffra/types'

type PaymentEventType = 'deposit' | 'refund' | 'withdrawal'

const FIAT_EVENT_TYPES = {
  deposit: 'deposit',
  payout: 'withdrawal',
  refund: 'refund',
} as const satisfies Record<ZeffraEvent['type'], PaymentEventType>

interface StoredPaymentEvent {
  dedupeKey: string
  eventType: PaymentEventType
  providerEventId?: string
  providerPayload: Record<string, unknown>
}

interface PaymentWebhookServiceOptions {
  cryptoAdapter: KuCoinPayAdapter
  cryptoDeposit: CryptoDepositService
  cryptoWithdrawal: CryptoWithdrawalService
  db: Db
  fiatAdapter: ZeffraAdapter
  fiatDeposit: FiatDepositService
  fiatPayout: FiatPayoutService
  fiatRefund: FiatRefundService
}

function payloadHash(payload: unknown) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function cryptoStoredEvent(
  event: KuCoinDepositEvent | KuCoinWithdrawalEvent,
): StoredPaymentEvent {
  const eventType = event.type === 'deposit' ? 'deposit' : 'withdrawal'
  const reference =
    event.type === 'deposit'
      ? (event.providerTxId ?? event.providerOrderId ?? event.requestId ?? '')
      : (event.requestId ?? event.providerBatchId ?? '')
  return {
    dedupeKey: `${eventType}:${event.status}:${reference}`,
    eventType,
    providerEventId:
      event.type === 'deposit'
        ? (event.providerTxId ?? event.providerOrderId ?? event.requestId)
        : (event.requestId ?? event.providerBatchId),
    providerPayload: event.providerPayload,
  }
}

function fiatStoredEvent(event: ZeffraEvent): StoredPaymentEvent {
  const eventType = FIAT_EVENT_TYPES[event.type]
  return {
    dedupeKey: `${eventType}:${event.status}:${event.providerOrderNo}`,
    eventType,
    providerEventId: `${event.type}:${event.providerOrderNo}`,
    providerPayload: event.providerPayload,
  }
}

export class PaymentWebhookService {
  private readonly cryptoAdapter: KuCoinPayAdapter
  private readonly cryptoDeposit: CryptoDepositService
  private readonly cryptoWithdrawal: CryptoWithdrawalService
  private readonly db: Db
  private readonly fiatAdapter: ZeffraAdapter
  private readonly fiatDeposit: FiatDepositService
  private readonly fiatPayout: FiatPayoutService
  private readonly fiatRefund: FiatRefundService

  constructor(options: PaymentWebhookServiceOptions) {
    this.cryptoAdapter = options.cryptoAdapter
    this.cryptoDeposit = options.cryptoDeposit
    this.cryptoWithdrawal = options.cryptoWithdrawal
    this.db = options.db
    this.fiatAdapter = options.fiatAdapter
    this.fiatDeposit = options.fiatDeposit
    this.fiatPayout = options.fiatPayout
    this.fiatRefund = options.fiatRefund
  }

  async handleCryptoPay(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ) {
    const result = this.cryptoAdapter.verifyWebhook(rawBody, headers)
    const provider = await this.provider(this.cryptoAdapter.providerCode)
    const events = result.events ?? []
    if (result.eventType === 'offchain_payment' || events.length === 0) {
      await this.recordIgnored(provider.id, result.payload)
      return { duplicate: false, ignored: true, processed: 0 }
    }

    let processed = 0
    let duplicate = false
    for (const event of events) {
      const notification = cryptoStoredEvent(event)
      const stored = await this.storeEvent(provider.id, notification)
      if (!stored) {
        duplicate = true
        continue
      }
      await this.processEvent(stored, async () => {
        await (event.type === 'deposit'
          ? this.cryptoDeposit.handleDepositEvent(provider.id, event)
          : this.cryptoWithdrawal.handleWithdrawalEvent(provider.id, event))
      })
      processed += 1
    }
    return { duplicate, ignored: false, processed }
  }

  async handleZeffra(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ) {
    if (!this.fiatAdapter.verifyWebhook(rawBody, headers)) {
      throw httpErrors.badRequest('Invalid Zeffra callback signature')
    }
    const event = ZeffraAdapter.parseWebhook(rawBody)
    const provider = await this.provider(this.fiatAdapter.providerCode)
    const stored = await this.storeEvent(provider.id, fiatStoredEvent(event))
    if (!stored) {
      return { duplicate: true, ignored: false, processed: 0 }
    }
    await this.processEvent(stored, () =>
      this.handleFiatEvent(provider.id, event),
    )
    return { duplicate: false, ignored: false, processed: 1 }
  }

  private async handleFiatEvent(providerId: string, event: ZeffraEvent) {
    switch (event.type) {
      case 'deposit': {
        await this.fiatDeposit.handleDepositEvent(providerId, event)
        return
      }
      case 'payout': {
        await this.fiatPayout.handlePayoutEvent(providerId, event)
        return
      }
      case 'refund': {
        await this.fiatRefund.handleRefundEvent(providerId, event)
        return
      }
      default: {
        throw new Error('Unsupported Zeffra event')
      }
    }
  }

  private async provider(providerCode: string) {
    const provider = await this.db.query.paymentProvider.findFirst({
      where: eq(schema.paymentProvider.code, providerCode),
    })
    if (!provider) {
      throw httpErrors.notFound('Payment provider not found')
    }
    return provider
  }

  private async processEvent(
    stored: typeof schema.paymentWebhookEvent.$inferSelect,
    handle: () => Promise<void>,
  ) {
    try {
      await handle()
      await this.db
        .update(schema.paymentWebhookEvent)
        .set({ processedAt: new Date(), processingStatus: 'processed' })
        .where(eq(schema.paymentWebhookEvent.id, stored.id))
    } catch (error) {
      await this.db
        .update(schema.paymentWebhookEvent)
        .set({
          processedAt: new Date(),
          processingError: errorMessage(error).slice(0, 500),
          processingStatus: 'failed',
        })
        .where(eq(schema.paymentWebhookEvent.id, stored.id))
      throw error
    }
  }

  private async recordIgnored(
    providerId: string,
    payload: Record<string, unknown>,
  ) {
    const hash = payloadHash(payload)
    await this.db
      .insert(schema.paymentWebhookEvent)
      .values({
        dedupeKey: `deposit:ignored:${hash}`,
        eventType: 'deposit',
        id: randomUUID(),
        payload,
        payloadHash: hash,
        processedAt: new Date(),
        processingStatus: 'ignored',
        providerId,
        signatureValid: true,
      })
      .onConflictDoNothing({
        target: [
          schema.paymentWebhookEvent.providerId,
          schema.paymentWebhookEvent.dedupeKey,
        ],
      })
  }

  private async storeEvent(providerId: string, event: StoredPaymentEvent) {
    const hash = payloadHash(event.providerPayload)
    const [stored] = await this.db
      .insert(schema.paymentWebhookEvent)
      .values({
        dedupeKey: event.dedupeKey,
        eventType: event.eventType,
        id: randomUUID(),
        payload: event.providerPayload,
        payloadHash: hash,
        processingStatus: 'processing',
        providerEventId: event.providerEventId,
        providerId,
        signatureValid: true,
      })
      .onConflictDoNothing({
        target: [
          schema.paymentWebhookEvent.providerId,
          schema.paymentWebhookEvent.dedupeKey,
        ],
      })
      .returning()
    if (stored) {
      return stored
    }

    const existing = await this.db.query.paymentWebhookEvent.findFirst({
      where: and(
        eq(schema.paymentWebhookEvent.providerId, providerId),
        eq(schema.paymentWebhookEvent.dedupeKey, event.dedupeKey),
      ),
    })
    if (!existing) {
      return null
    }
    const staleProcessing =
      existing.processingStatus === 'processing' &&
      existing.receivedAt.getTime() < Date.now() - 5 * 60 * 1000
    if (
      existing.processingStatus !== 'failed' &&
      existing.processingStatus !== 'received' &&
      !staleProcessing
    ) {
      return null
    }
    const [retried] = await this.db
      .update(schema.paymentWebhookEvent)
      .set({
        payload: event.providerPayload,
        payloadHash: hash,
        processedAt: null,
        processingError: null,
        processingStatus: 'processing',
        signatureValid: true,
      })
      .where(eq(schema.paymentWebhookEvent.id, existing.id))
      .returning()
    return retried ?? null
  }
}
