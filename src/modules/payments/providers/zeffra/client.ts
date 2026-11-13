import { randomUUID } from 'node:crypto'

import { formatAmount } from '@/lib/money'

import { ZeffraRequestError } from './error'
import { signRsaSha256 } from './signature'
import type {
  ZeffraConfig,
  ZeffraDepositInput,
  ZeffraDepositQuery,
  ZeffraDepositResult,
  ZeffraPayoutInput,
  ZeffraPayoutQuery,
  ZeffraPayoutResult,
} from './types'

const ORDER_DECIMALS = 2

interface ZeffraResponse<T> {
  code: number
  data: T
  message: string
}

interface ZeffraDepositData {
  auth_url: string
  merchant_order_no: string
  need_auth: boolean
  order_no: string
}

interface ZeffraPayoutData {
  amount: number
  confirm_url: string
  fail_reason?: string
  merchant_order_no: string
  need_user_confirm: boolean
  order_no: string
  status: number
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function mapStatus(status: number) {
  if (status === 2) {
    return 'succeeded' as const
  }
  if (status === 3) {
    return 'failed' as const
  }
  return 'pending' as const
}

function required(value: string | undefined, key: string) {
  const normalized = value?.trim()
  if (!normalized) {
    throw new ZeffraRequestError(`Missing required Zeffra config: ${key}`, true)
  }
  return normalized
}

export class ZeffraClient {
  private readonly config: ZeffraConfig

  constructor(config: ZeffraConfig) {
    this.config = config
  }

  isConfigured() {
    return Boolean(
      this.config.merchantCode?.trim() &&
      this.config.privateKey?.trim() &&
      this.config.publicKey?.trim(),
    )
  }

  async createDeposit(input: ZeffraDepositInput): Promise<ZeffraDepositResult> {
    const payload = await this.post<ZeffraDepositData>('/pay', {
      amount: Number(formatAmount(input.amount, ORDER_DECIMALS)),
      auth_return_url: input.authReturnUrl,
      billing_info: {
        address1: input.billing.address1 ?? '',
        address2: input.billing.address2 ?? '',
        city: input.billing.city ?? '',
        country: input.billing.country ?? '',
        email: input.billing.email ?? '',
        first_name: input.billing.firstName ?? '',
        last_name: input.billing.lastName ?? '',
        phone: input.billing.phone ?? '',
        postal_code: input.billing.postalCode ?? '',
        state: input.billing.state ?? '',
      },
      currency: input.currency,
      device_info: {
        browser: input.device.browser ?? '',
        card_input_method: input.device.cardInputMethod ?? 'typed',
        client_ip: input.device.clientIp,
        cookie: input.device.cookie ?? '',
        language: input.device.language ?? '',
        os: input.device.os ?? '',
        screen_resolution: input.device.screenResolution ?? '',
        timezone: input.device.timezone ?? '',
      },
      enable_3d_secure: this.config.enable3ds ? 1 : 0,
      merchant_code: required(this.config.merchantCode, 'ZEFFRA_MERCHANT_CODE'),
      merchant_order_no: input.merchantOrderNo,
      nonce: randomUUID(),
      notify_url: input.notifyUrl,
      payment_code: input.providerPaymentCode,
      timestamp: Math.floor(Date.now() / 1000),
      user_id: input.userId,
      user_registered_at: input.userRegisteredAt,
      website: this.config.website ?? '',
    })

    return {
      authUrl: optionalString(payload.auth_url),
      needAuth: payload.need_auth,
      providerOrderNo: payload.order_no,
    }
  }

  async queryDeposit(merchantOrderNo: string): Promise<ZeffraDepositQuery> {
    const payload = await this.postOrNull<{
      fail_reason?: string
      order_no: string
      status: number
    }>('/query_order', this.queryBody(merchantOrderNo))
    if (!payload) {
      return { found: false }
    }
    return {
      failReason: optionalString(payload.fail_reason),
      found: true,
      providerOrderNo: payload.order_no,
      providerPayload: { status: payload.status },
      status: mapStatus(payload.status),
    }
  }

  async createPayout(input: ZeffraPayoutInput): Promise<ZeffraPayoutResult> {
    const body: Record<string, unknown> = {
      address: input.recipient.address,
      amount: Number(formatAmount(input.amount, ORDER_DECIMALS)),
      bank_code: input.bankCode,
      city: input.recipient.city,
      country: input.recipient.country,
      email: input.recipient.email,
      ext1: input.ext1,
      ext2: input.ext2,
      ext3: input.ext3,
      first_name: input.recipient.firstName,
      last_name: input.recipient.lastName,
      merchant_code: required(this.config.merchantCode, 'ZEFFRA_MERCHANT_CODE'),
      merchant_order_no: input.merchantOrderNo,
      nonce: randomUUID(),
      notify_url: input.notifyUrl,
      payment_code: input.providerPaymentCode,
      phone: input.recipient.phone,
      postal_code: input.recipient.postalCode,
      receive_account: input.receiveAccount,
      receive_account_expire_at: input.receiveAccountExpireAt,
      state: input.recipient.state,
      timestamp: Math.floor(Date.now() / 1000),
      user_id: input.userId,
    }
    if (input.recipient.birthday) {
      body.birthday = input.recipient.birthday
    }
    const payload = await this.post<ZeffraPayoutData>('/payout', body)
    return {
      confirmUrl: optionalString(payload.confirm_url),
      needUserConfirm: payload.need_user_confirm,
      providerOrderNo: payload.order_no,
    }
  }

  async queryPayout(merchantOrderNo: string): Promise<ZeffraPayoutQuery> {
    const payload = await this.postOrNull<ZeffraPayoutData>(
      '/query_payout',
      this.queryBody(merchantOrderNo),
    )
    if (!payload) {
      return { found: false }
    }
    return {
      confirmUrl: optionalString(payload.confirm_url),
      failReason: optionalString(payload.fail_reason),
      found: true,
      needUserConfirm: payload.need_user_confirm,
      providerOrderNo: payload.order_no,
      providerPayload: {
        identifier: payload.order_no,
        status: payload.status,
      },
      status: mapStatus(payload.status),
    }
  }

  private queryBody(merchantOrderNo: string) {
    return {
      merchant_code: required(this.config.merchantCode, 'ZEFFRA_MERCHANT_CODE'),
      merchant_order_no: merchantOrderNo,
      nonce: randomUUID(),
      timestamp: Math.floor(Date.now() / 1000),
    }
  }

  private async post<T>(path: string, body: Record<string, unknown>) {
    const response = await this.send<T>(path, body)
    if (!response.ok || response.payload.code !== 200) {
      throw new ZeffraRequestError(
        `Zeffra request rejected (${response.payload.code}): ${response.payload.message}`,
        response.payload.code !== 429,
      )
    }
    return response.payload.data
  }

  private async postOrNull<T>(path: string, body: Record<string, unknown>) {
    const response = await this.send<T>(path, body)
    if (!response.ok || response.payload.code !== 200) {
      return null
    }
    return response.payload.data
  }

  private async send<T>(path: string, body: Record<string, unknown>) {
    const json = JSON.stringify(body)
    const signature = signRsaSha256(
      json,
      required(this.config.privateKey, 'ZEFFRA_PRIVATE_KEY'),
    )
    let response: Response
    try {
      response = await fetch(
        `${this.config.apiBaseUrl.replace(/\/$/u, '')}${path}`,
        {
          body: json,
          headers: {
            'content-type': 'application/json',
            'x-sign': signature,
          },
          method: 'POST',
          signal: AbortSignal.timeout(20_000),
        },
      )
    } catch (error) {
      throw new ZeffraRequestError(
        `Zeffra request failed: ${error instanceof Error ? error.message : String(error)}`,
        false,
      )
    }
    let payload: ZeffraResponse<T>
    try {
      payload = (await response.json()) as ZeffraResponse<T>
    } catch {
      throw new ZeffraRequestError('Zeffra returned invalid JSON', false)
    }
    return { ok: response.ok, payload }
  }
}
