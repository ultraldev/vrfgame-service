import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

import { CryptoDepositService } from '@/modules/payments/crypto/deposit'
import { CryptoWithdrawalService } from '@/modules/payments/crypto/withdrawal'
import { FiatDepositService } from '@/modules/payments/fiat/deposit'
import { FiatPayoutService } from '@/modules/payments/fiat/payout'
import { FiatRefundService } from '@/modules/payments/fiat/refund'
import { KuCoinPayAdapter } from '@/modules/payments/providers/kucoin/adapter'
import { ZeffraAdapter } from '@/modules/payments/providers/zeffra/adapter'
import { PaymentRuntime } from '@/modules/payments/runtime'
import { PaymentWebhookService } from '@/modules/payments/webhook'

declare module 'fastify' {
  interface FastifyInstance {
    cryptoDeposit: CryptoDepositService
    cryptoWithdrawal: CryptoWithdrawalService
    fiatDeposit: FiatDepositService
    fiatPayout: FiatPayoutService
    paymentWebhook: PaymentWebhookService
  }
}

function payments(
  fastify: FastifyInstance,
  _options: unknown,
  done: (error?: Error) => void,
) {
  const cryptoAdapter = new KuCoinPayAdapter({
    apiBaseUrl: fastify.config.KUCOIN_PAY_API_BASE_URL,
    apiKey: fastify.config.KUCOIN_PAY_API_KEY,
    platformPublicKey: fastify.config.KUCOIN_PAY_PLATFORM_PUBLIC_KEY,
    privateKey: fastify.config.KUCOIN_PAY_PRIVATE_KEY,
    relayAuthBase64: fastify.config.KUCOIN_PAY_RELAY_AUTH_BASE64,
    subMerchantId: fastify.config.KUCOIN_PAY_SUB_MERCHANT_ID,
  })
  const fiatAdapter = new ZeffraAdapter({
    apiBaseUrl: fastify.config.ZEFFRA_API_BASE_URL,
    authReturnUrl: fastify.config.ZEFFRA_AUTH_RETURN_URL,
    enable3ds: fastify.config.ZEFFRA_ENABLE_3DS === '1',
    merchantCode: fastify.config.ZEFFRA_MERCHANT_CODE,
    notifyUrl: fastify.config.ZEFFRA_NOTIFY_URL,
    privateKey: fastify.config.ZEFFRA_PRIVATE_KEY,
    publicKey: fastify.config.ZEFFRA_PUBLIC_KEY,
    website: fastify.config.ZEFFRA_WEBSITE,
  })
  const cryptoDeposit = new CryptoDepositService({
    adapter: cryptoAdapter,
    db: fastify.db,
    redis: fastify.redis,
  })
  const cryptoWithdrawal = new CryptoWithdrawalService({
    adapter: cryptoAdapter,
    db: fastify.db,
    redis: fastify.redis,
    wagering: {
      ratio: fastify.config.WITHDRAW_WAGERING_RATIO,
      reportingCurrency: fastify.config.WITHDRAW_WAGERING_REPORTING_CURRENCY,
    },
  })
  const fiatDeposit = new FiatDepositService({
    adapter: fiatAdapter,
    db: fastify.db,
    redis: fastify.redis,
  })
  const fiatPayout = new FiatPayoutService({
    adapter: fiatAdapter,
    db: fastify.db,
    redis: fastify.redis,
    wagering: {
      ratio: fastify.config.WITHDRAW_WAGERING_RATIO,
      reportingCurrency: fastify.config.WITHDRAW_WAGERING_REPORTING_CURRENCY,
    },
  })
  const fiatRefund = new FiatRefundService({
    db: fastify.db,
    redis: fastify.redis,
  })
  const webhook = new PaymentWebhookService({
    cryptoAdapter,
    cryptoDeposit,
    cryptoWithdrawal,
    db: fastify.db,
    fiatAdapter,
    fiatDeposit,
    fiatPayout,
    fiatRefund,
  })
  const runtime = new PaymentRuntime({
    cryptoDeposit,
    cryptoWithdrawal,
    fiatDeposit,
    fiatPayout,
    logger: fastify.log,
    redis: fastify.redis,
  })

  fastify.decorate('cryptoDeposit', cryptoDeposit)
  fastify.decorate('cryptoWithdrawal', cryptoWithdrawal)
  fastify.decorate('fiatDeposit', fiatDeposit)
  fastify.decorate('fiatPayout', fiatPayout)
  fastify.decorate('paymentWebhook', webhook)

  fastify.addHook('onReady', async () => {
    if (fastify.config.NODE_ENV !== 'test') {
      await runtime.start()
    }
  })
  fastify.addHook('onClose', async () => {
    await runtime.stop()
  })
  done()
}

export default fp(payments, { name: 'payments' })
