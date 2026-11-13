import { generateKeyPairSync } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { KuCoinPayAdapter } from '@/modules/payments/providers/kucoin/adapter'
import { KuCoinPayClient } from '@/modules/payments/providers/kucoin/client'
import {
  buildSignatureString,
  normalizePem,
  signRequest,
  verifySignature,
} from '@/modules/payments/providers/kucoin/signature'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
})

const ONCHAIN_PAYMENT_FIELDS = [
  'apiKey',
  'assetUniqueId',
  'chain',
  'currency',
  'paymentAmount',
  'paymentCurrency',
  'paymentOrderType',
  'paymentStatus',
  'payOrderId',
  'requestId',
  'status',
  'subMerchantId',
  'timestamp',
] as const

const PAYOUT_FIELDS = [
  'apiKey',
  'batchNo',
  'chain',
  'currency',
  'payoutType',
  'processingFee',
  'requestId',
  'status',
  'totalAmount',
  'totalCount',
  'totalPaidAmount',
  'totalPayoutFee',
  'timestamp',
] as const

function client() {
  return new KuCoinPayClient({
    apiBaseUrl: 'https://pay.example/api/kucoinpay',
    apiKey: 'api-key',
    privateKey,
    relayAuthBase64: 'relay-auth',
    subMerchantId: 'sub-merchant',
  })
}

function jsonResponse(payload: Record<string, unknown>) {
  return Response.json(payload, {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
}

function webhook() {
  const adapter = new KuCoinPayAdapter({
    apiBaseUrl: 'https://pay.example/api/kucoinpay',
    apiKey: 'api-key',
    platformPublicKey: publicKey,
    privateKey,
    subMerchantId: 'sub-merchant',
  })
  const timestamp = '1700000000000'
  const payload = {
    address: 'TJQkdKTCjcnDnmg3CeRSgDdqaFoEvFLoBb',
    assetUniqueId: 'asset-1',
    chain: 'trx',
    currency: 'USDT',
    orderType: 'ONCHAIN_PAYMENT',
    payOrderId: 'kpo_1',
    paymentAmount: '10.00',
    paymentCurrency: 'USDT',
    paymentOrderType: 'ONCHAIN',
    paymentStatus: 'FULL_PAYMENT',
    requestId: 'deposit-1',
    status: 'USER_PAY_COMPLETED',
    subMerchantId: 'sub-merchant',
    txId: 'tx-1',
  }
  const signingString = buildSignatureString({
    apiKey: 'api-key',
    fieldOrder: ONCHAIN_PAYMENT_FIELDS,
    fields: payload,
    timestamp,
  })
  return {
    adapter,
    payload,
    rawBody: Buffer.from(JSON.stringify(payload)),
    signature: signRequest(signingString, privateKey),
    timestamp,
  }
}

describe('KuCoin Pay', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('signatures', () => {
    it('builds ordered signing strings and skips empty fields', () => {
      expect(
        buildSignatureString({
          apiKey: 'api-key',
          fieldOrder: ['apiKey', 'requestId', 'subMerchantId', 'timestamp'],
          fields: { requestId: 'request-1', subMerchantId: '' },
          timestamp: '1700000000000',
        }),
      ).toBe('apiKey=api-key&requestId=request-1&timestamp=1700000000000')
    })

    it('round-trips RSA-SHA256 signatures', () => {
      const signingString = 'apiKey=api-key&requestId=request-1'
      const signature = signRequest(signingString, privateKey)
      expect(
        verifySignature({ publicKey, signature, signingString }),
      ).toBeTruthy()
      expect(
        verifySignature({
          publicKey,
          signature,
          signingString: `${signingString}&tampered=true`,
        }),
      ).toBeFalsy()
    })

    it('accepts escaped PEM newlines', () => {
      expect(normalizePem(privateKey.replaceAll('\n', '\\n'))).toBe(privateKey)
    })
  })

  describe('client', () => {
    it('creates a signed on-chain deposit order', async () => {
      let captured: { init?: RequestInit; url?: string } = {}
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>((input, init) => {
          captured = { init, url: String(input) }
          return Promise.resolve(
            jsonResponse({
              code: '200',
              data: {
                address: 'TJQkdKTCjcnDnmg3CeRSgDdqaFoEvFLoBb',
                appPayUrl: 'https://pay.example/checkout/order-1',
                chain: 'trx',
                cryptoAmount: '10',
                cryptoCurrency: 'USDT',
                expireTime: 1_800_000_000_000,
                payOrderId: 'kpo_1',
                qrcodeUrl: 'https://pay.example/qr/order-1',
                requestId: 'deposit-order-1',
              },
              msg: 'success',
              retry: false,
              success: true,
            }),
          )
        }),
      )

      await expect(
        client().createOnchainOrder({
          amount: 10_000_000n,
          chain: 'trx',
          currency: 'USDT',
          decimals: 6,
          requestId: 'deposit-order-1',
        }),
      ).resolves.toMatchObject({
        address: 'TJQkdKTCjcnDnmg3CeRSgDdqaFoEvFLoBb',
        payOrderId: 'kpo_1',
        requestId: 'deposit-order-1',
      })
      expect(captured.url).toBe(
        'https://pay.example/api/kucoinpay/api/v1/onchain/payment/create',
      )
      expect(captured.init?.headers).toMatchObject({
        Authorization: 'Basic relay-auth',
        'PAY-API-KEY': 'api-key',
        'PAY-API-VERSION': '1.0',
      })
      expect(JSON.parse(String(captured.init?.body))).toMatchObject({
        chain: 'trx',
        cryptoAmount: '10.00',
        cryptoCurrency: 'USDT',
        requestId: 'deposit-order-1',
        subMerchantId: 'sub-merchant',
      })
    })

    it('submits one payout detail with a stable merchant reference', async () => {
      let body: Record<string, unknown> = {}
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>((_input, init) => {
          body = JSON.parse(String(init?.body)) as Record<string, unknown>
          return Promise.resolve(
            jsonResponse({
              code: '200',
              data: { batchNo: 'kpbw_1', requestId: 'withdraw-1' },
              msg: 'success',
              retry: false,
              success: true,
            }),
          )
        }),
      )

      await expect(
        client().createPayout({
          amount: 12_340_000n,
          batchName: 'VRF Game withdraw-1',
          chain: 'trx',
          currency: 'USDT',
          decimals: 6,
          merchantRef: 'withdraw-1',
          receiverAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
        }),
      ).resolves.toStrictEqual({
        batchNo: 'kpbw_1',
        requestId: 'withdraw-1',
      })
      expect(body.withdrawDetailDtoList).toStrictEqual([
        {
          amount: '12.34',
          detailId: 'withdraw-1',
          receiverAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
          remark: 'VRF Game withdrawal',
        },
      ])
    })

    it('queries payout batches, fees, and on-chain orders', async () => {
      const fetchMock = vi.fn<typeof fetch>()
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            code: '200',
            data: {
              batchNo: 'kpbw_1',
              requestId: 'withdraw-1',
              status: 'SUCCEEDED_FULL',
              withdrawDetailDtoList: [
                { detailId: 'withdraw-1', status: 'SUCCEEDED' },
              ],
            },
            success: true,
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            code: '200',
            data: { withdrawAmount: '10.115', withdrawFee: '0.115' },
            success: true,
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            code: '200',
            items: [
              {
                address: 'TJQkdKTCjcnDnmg3CeRSgDdqaFoEvFLoBb',
                assetUniqueId: 'asset-1',
                paymentAmount: '10',
                paymentStatus: 'FULL_PAYMENT',
                requestId: 'deposit-order-1',
                status: 'SUCCEEDED',
              },
            ],
            success: true,
          }),
        )
      vi.stubGlobal('fetch', fetchMock)

      await expect(client().queryPayout('withdraw-1')).resolves.toMatchObject({
        batchNo: 'kpbw_1',
        status: 'SUCCEEDED_FULL',
      })
      await expect(
        client().queryPayoutFee({
          amount: 10_000_000n,
          chain: 'trx',
          currency: 'USDT',
          decimals: 6,
        }),
      ).resolves.toMatchObject({ withdrawFee: '0.115' })
      await expect(
        client().queryOnchainOrders({
          address: 'TJQkdKTCjcnDnmg3CeRSgDdqaFoEvFLoBb',
          currency: 'USDT',
          endTime: 2,
          requestId: 'deposit-order-1',
          startTime: 1,
        }),
      ).resolves.toMatchObject([
        { assetUniqueId: 'asset-1', paymentStatus: 'FULL_PAYMENT' },
      ])
    })
  })

  describe('adapter webhooks', () => {
    it('verifies and parses completed on-chain deposits', () => {
      const input = webhook()
      const result = input.adapter.verifyWebhook(input.rawBody, {
        'pay-api-sign': input.signature,
        'pay-api-timestamp': input.timestamp,
      })
      expect(result.eventType).toBe('onchain_payment')
      if (result.eventType !== 'onchain_payment') {
        throw new Error('Expected on-chain callback')
      }
      expect(result.events[0]).toMatchObject({
        amount: '10.00',
        chain: 'TRON',
        providerOrderId: 'kpo_1',
        providerTxId: 'asset-1',
        requestId: 'deposit-1',
        status: 'succeeded',
        symbol: 'USDT',
      })
    })

    it('rejects tampered webhook payloads', () => {
      const input = webhook()
      expect(() =>
        input.adapter.verifyWebhook(
          Buffer.from(
            JSON.stringify({ ...input.payload, paymentAmount: '99' }),
          ),
          {
            'pay-api-sign': input.signature,
            'pay-api-timestamp': input.timestamp,
          },
        ),
      ).toThrow('Invalid KuCoin Pay callback signature')
    })

    it('verifies and parses payout webhooks', () => {
      const adapter = new KuCoinPayAdapter({
        apiBaseUrl: 'https://pay.example/api/kucoinpay',
        apiKey: 'api-key',
        platformPublicKey: publicKey,
        privateKey,
        subMerchantId: 'sub-merchant',
      })
      const timestamp = '1700000000000'
      const payload = {
        batchNo: 'batch-1',
        chain: 'trx',
        currency: 'USDT',
        orderType: 'PAYOUT',
        payoutType: 'ONCHAIN',
        processingFee: '0.10',
        requestId: 'withdraw-1',
        status: 'SUCCEEDED_FULL',
        totalAmount: '10.00',
        totalCount: 1,
        totalPaidAmount: '10.00',
        totalPayoutFee: '0.10',
        withdrawDetailDtoList: [
          {
            amount: '10.00',
            detailId: 'withdraw-1',
            payoutFee: '0.10',
            receiverAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
            status: 'SUCCEEDED',
          },
        ],
      }
      const signingString = buildSignatureString({
        apiKey: 'api-key',
        fieldOrder: PAYOUT_FIELDS,
        fields: payload,
        timestamp,
      })
      const result = adapter.verifyWebhook(
        Buffer.from(JSON.stringify(payload)),
        {
          'pay-api-sign': signRequest(signingString, privateKey),
          'pay-api-timestamp': timestamp,
        },
      )
      expect(result.eventType).toBe('payout')
      expect(result.events?.[0]).toMatchObject({
        amount: '10.00',
        requestId: 'withdraw-1',
        status: 'succeeded',
        type: 'withdrawal',
      })
    })
  })
})
