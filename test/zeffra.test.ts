import { generateKeyPairSync } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ZeffraAdapter } from '@/modules/payments/providers/zeffra/adapter'
import {
  signRsaSha256,
  verifyRsaSha256,
} from '@/modules/payments/providers/zeffra/signature'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
})

function adapter() {
  return new ZeffraAdapter({
    apiBaseUrl: 'https://zeffra.example',
    authReturnUrl: 'https://game.example/wallet/fiat/return',
    enable3ds: true,
    merchantCode: 'merchant-1',
    notifyUrl: 'https://game.example/api/v1/webhooks/zeffra',
    privateKey,
    publicKey,
    website: 'https://game.example',
  })
}

function signedHeaders(payload: Record<string, unknown>) {
  const rawBody = Buffer.from(JSON.stringify(payload))
  return {
    rawBody,
    'x-sign': signRsaSha256(rawBody.toString('utf-8'), privateKey),
  }
}

function jsonResponse(payload: Record<string, unknown>) {
  return Response.json(payload, {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
}

describe('Zeffra', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('round-trips callback signatures over the exact raw JSON', () => {
    const rawBody = Buffer.from('{"amount":"10.00","order_no":"z-1"}')
    const signature = signRsaSha256(rawBody.toString('utf-8'), privateKey)
    expect(
      verifyRsaSha256(rawBody.toString('utf-8'), signature, publicKey),
    ).toBeTruthy()
    expect(
      verifyRsaSha256(
        Buffer.from('{"amount":"99.00","order_no":"z-1"}').toString('utf-8'),
        signature,
        publicKey,
      ),
    ).toBeFalsy()
  })

  it('distinguishes safe provider rejections from ambiguous request failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json(
            { code: 430, data: null, message: 'declined' },
            { status: 200 },
          ),
        ),
      ),
    )
    await expect(
      adapter().createDeposit({
        amount: 1000n,
        billing: {},
        currency: 'USD',
        device: { clientIp: '127.0.0.1' },
        merchantOrderNo: 'deposit-rejected',
        providerPaymentCode: '111',
        userId: 'user-1',
        userRegisteredAt: 1_700_000_000,
      }),
    ).rejects.toMatchObject({ retryable: true })

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.reject(new Error('connection reset'))),
    )
    await expect(
      adapter().createDeposit({
        amount: 1000n,
        billing: {},
        currency: 'USD',
        device: { clientIp: '127.0.0.1' },
        merchantOrderNo: 'deposit-ambiguous',
        providerPaymentCode: '111',
        userId: 'user-1',
        userRegisteredAt: 1_700_000_000,
      }),
    ).rejects.toMatchObject({ retryable: false })
  })

  it('signs and submits deposit orders with the configured return and notify URLs', async () => {
    let request: { body?: string; headers?: RequestInit['headers'] } = {}
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>((_input, init) => {
        request = {
          body: typeof init?.body === 'string' ? init.body : undefined,
          headers: init?.headers,
        }
        return Promise.resolve(
          jsonResponse({
            code: 200,
            data: {
              auth_url: 'https://zeffra.example/auth',
              merchant_order_no: 'deposit-1',
              need_auth: true,
              order_no: 'zf-1',
            },
            message: 'ok',
          }),
        )
      }),
    )

    const result = await adapter().createDeposit({
      amount: 1000n,
      billing: { email: 'player@example.com' },
      currency: 'USD',
      device: { clientIp: '127.0.0.1' },
      merchantOrderNo: 'deposit-1',
      providerPaymentCode: '111',
      userId: 'user-1',
      userRegisteredAt: 1_700_000_000,
    })

    expect(result).toStrictEqual({
      authUrl: 'https://zeffra.example/auth',
      needAuth: true,
      providerOrderNo: 'zf-1',
    })
    expect(request.body).toBeTypeOf('string')
    const body = request.body ?? ''
    const headers = new Headers(request.headers)
    expect(
      verifyRsaSha256(body, headers.get('x-sign') ?? '', publicKey),
    ).toBeTruthy()
    expect(JSON.parse(body)).toMatchObject({
      amount: 10,
      auth_return_url: 'https://game.example/wallet/fiat/return',
      currency: 'USD',
      merchant_code: 'merchant-1',
      merchant_order_no: 'deposit-1',
      notify_url: 'https://game.example/api/v1/webhooks/zeffra',
      payment_code: '111',
    })
  })

  it('signs payout requests and preserves payout confirmation metadata', async () => {
    let captured: { body?: string; headers?: RequestInit['headers'] } = {}
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>((_input, init) => {
        captured = {
          body: typeof init?.body === 'string' ? init.body : undefined,
          headers: init?.headers,
        }
        return Promise.resolve(
          jsonResponse({
            code: 200,
            data: {
              amount: 9.7,
              confirm_url: 'https://zeffra.example/confirm',
              merchant_order_no: 'payout-1',
              need_user_confirm: true,
              order_no: 'zf-2',
              status: 1,
            },
            message: 'ok',
          }),
        )
      }),
    )

    const result = await adapter().createPayout({
      amount: 970n,
      bankCode: 'paypal',
      currency: 'USD',
      merchantOrderNo: 'payout-1',
      providerPaymentCode: '112',
      receiveAccount: 'payer@example.com',
      recipient: {
        address: '1 Main St',
        city: 'Los Angeles',
        country: 'US',
        email: 'player@example.com',
        firstName: 'Test',
        lastName: 'Player',
        phone: '+12025550123',
        postalCode: '90001',
        state: 'CA',
      },
      userId: 'user-1',
    })

    expect(result).toStrictEqual({
      confirmUrl: 'https://zeffra.example/confirm',
      needUserConfirm: true,
      providerOrderNo: 'zf-2',
    })
    const body = captured.body ?? ''
    const headers = new Headers(captured.headers)
    expect(
      verifyRsaSha256(body, headers.get('x-sign') ?? '', publicKey),
    ).toBeTruthy()
    expect(JSON.parse(body)).toMatchObject({
      amount: 9.7,
      merchant_code: 'merchant-1',
      merchant_order_no: 'payout-1',
      payment_code: '112',
      receive_account: 'payer@example.com',
    })
  })

  it('parses deposit, payout, and refund callbacks', () => {
    const deposit = signedHeaders({
      amount: '10.00',
      currency: 'USD',
      merchant_order_no: 'deposit-1',
      order_no: 'zf-1',
      status: 2,
    })
    expect(ZeffraAdapter.parseWebhook(deposit.rawBody)).toMatchObject({
      amount: '1000',
      currency: 'USD',
      merchantOrderNo: 'deposit-1',
      providerOrderNo: 'zf-1',
      status: 'succeeded',
      type: 'deposit',
    })

    const payout = signedHeaders({
      amount: '9.70',
      fail_reason: 'rejected',
      identifier: 'receipt-1',
      merchant_order_no: 'payout-1',
      order_no: 'zf-2',
      status: 3,
    })
    expect(ZeffraAdapter.parseWebhook(payout.rawBody)).toMatchObject({
      amount: '970',
      failReason: 'rejected',
      merchantOrderNo: 'payout-1',
      providerOrderNo: 'zf-2',
      status: 'failed',
      type: 'payout',
    })

    const refund = signedHeaders({
      merchant_order_no: 'deposit-1',
      refund_amount: '2.50',
      refund_currency: 'USD',
      refund_no: 'refund-1',
      refund_status: 3,
    })
    expect(ZeffraAdapter.parseWebhook(refund.rawBody)).toMatchObject({
      amount: '250',
      currency: 'USD',
      merchantOrderNo: 'deposit-1',
      providerOrderNo: 'refund-1',
      status: 'succeeded',
      type: 'refund',
    })
  })

  it('rejects malformed callback JSON with a client error', () => {
    expect(() => ZeffraAdapter.parseWebhook(Buffer.from('{'))).toThrow(
      'Invalid Zeffra callback body',
    )
  })

  it('verifies signed callbacks and rejects missing or tampered signatures', () => {
    const payload = {
      amount: '10.00',
      currency: 'USD',
      merchant_order_no: 'deposit-1',
      order_no: 'zf-1',
      status: 2,
    }
    const signed = signedHeaders(payload)
    expect(
      adapter().verifyWebhook(signed.rawBody, {
        'x-sign': signed['x-sign'],
      }),
    ).toBeTruthy()
    expect(adapter().verifyWebhook(signed.rawBody, {})).toBeFalsy()
    expect(
      adapter().verifyWebhook(
        Buffer.from(JSON.stringify({ ...payload, amount: '9.00' })),
        { 'x-sign': signed['x-sign'] },
      ),
    ).toBeFalsy()
  })
})
