import { parseAmount } from '@/lib/money'

import { ZeffraClient } from './client'
import { verifyRsaSha256 } from './signature'
import type {
  ZeffraConfig,
  ZeffraDepositInput,
  ZeffraEvent,
  ZeffraOrderStatus,
  ZeffraPayoutInput,
} from './types'

function optionalString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function eventStatus(status: number) {
  if (status === 2) {
    return 'succeeded' as const
  }
  if (status === 3) {
    return 'failed' as const
  }
  return 'pending' as const
}

function refundStatus(status: number): ZeffraOrderStatus {
  if (status === 3) {
    return 'succeeded'
  }
  if (status === 4) {
    return 'failed'
  }
  return 'pending'
}

function paymentError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode })
}

function toMinorUnits(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw paymentError('Invalid Zeffra callback amount', 400)
  }
  return parseAmount(String(value), 2).toString()
}

export class ZeffraAdapter {
  readonly orderDecimals = 2
  readonly providerCode = 'zeffra'
  private readonly client: ZeffraClient
  private readonly config: ZeffraConfig

  constructor(config: ZeffraConfig) {
    this.config = config
    this.client = new ZeffraClient(config)
  }

  isConfigured() {
    return this.client.isConfigured()
  }

  createDeposit(
    input: Omit<ZeffraDepositInput, 'authReturnUrl' | 'notifyUrl'>,
  ) {
    if (!this.config.authReturnUrl || !this.config.notifyUrl) {
      throw paymentError('Zeffra return or notify URL is not configured', 503)
    }
    return this.client.createDeposit({
      ...input,
      authReturnUrl: this.config.authReturnUrl,
      notifyUrl: this.config.notifyUrl,
    })
  }

  createPayout(input: Omit<ZeffraPayoutInput, 'notifyUrl'>) {
    if (!this.config.notifyUrl) {
      throw paymentError('Zeffra notify URL is not configured', 503)
    }
    return this.client.createPayout({
      ...input,
      notifyUrl: this.config.notifyUrl,
    })
  }

  queryDeposit(merchantOrderNo: string) {
    return this.client.queryDeposit(merchantOrderNo)
  }

  queryPayout(merchantOrderNo: string) {
    return this.client.queryPayout(merchantOrderNo)
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>) {
    const signature = headers['x-sign']
    const publicKey = this.config.publicKey?.trim()
    if (!signature || !publicKey) {
      return false
    }
    return verifyRsaSha256(rawBody.toString('utf-8'), signature, publicKey)
  }

  static parseWebhook(rawBody: Buffer): ZeffraEvent {
    let value: unknown
    try {
      value = JSON.parse(rawBody.toString('utf-8'))
    } catch {
      throw paymentError('Invalid Zeffra callback body', 400)
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw paymentError('Invalid Zeffra callback body', 400)
    }
    const payload = value as Record<string, unknown>
    if (payload.refund_no !== undefined) {
      return {
        amount: toMinorUnits(payload.refund_amount),
        currency: String(payload.refund_currency ?? payload.currency ?? ''),
        failReason: optionalString(payload.fail_reason),
        merchantOrderNo: String(payload.merchant_order_no),
        providerOrderNo: String(payload.refund_no),
        providerPayload: payload,
        status: refundStatus(Number(payload.refund_status)),
        type: 'refund',
      }
    }
    if (payload.identifier !== undefined) {
      return {
        amount: toMinorUnits(payload.amount),
        failReason: optionalString(payload.fail_reason),
        merchantOrderNo: String(payload.merchant_order_no),
        providerOrderNo: String(payload.order_no),
        providerPayload: payload,
        status: eventStatus(Number(payload.status)),
        type: 'payout',
      }
    }
    return {
      amount: toMinorUnits(payload.amount),
      currency: String(payload.currency),
      failReason: optionalString(payload.fail_reason),
      merchantOrderNo: String(payload.merchant_order_no),
      providerOrderNo: String(payload.order_no),
      providerPayload: payload,
      status: eventStatus(Number(payload.status)),
      type: 'deposit',
    }
  }
}
