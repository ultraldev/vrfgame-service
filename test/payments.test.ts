import { describe, expect, it } from 'vitest'

import {
  resolveFiatBilling,
  resolveFiatDevice,
  resolveFiatPayoutAccount,
} from '@/modules/payments/fiat/util'
import { paymentRouteAvailable } from '@/modules/payments/util'

const available = {
  currencyEnabled: true,
  currencyWalletEnabled: true,
  direction: 'deposit' as const,
  providerDepositEnabled: true,
  providerEnabled: true,
  providerWithdrawalEnabled: true,
  routeDepositEnabled: true,
  routeEnabled: true,
  routeWithdrawalEnabled: true,
}

describe('payment route availability', () => {
  it('requires provider, route, and wallet availability', () => {
    expect(paymentRouteAvailable(available)).toBeTruthy()
    expect(
      paymentRouteAvailable({ ...available, providerEnabled: false }),
    ).toBeFalsy()
    expect(
      paymentRouteAvailable({ ...available, routeDepositEnabled: false }),
    ).toBeFalsy()
    expect(
      paymentRouteAvailable({ ...available, currencyWalletEnabled: false }),
    ).toBeFalsy()
  })

  it('keeps deposit and withdrawal capabilities independent', () => {
    expect(
      paymentRouteAvailable({ ...available, providerDepositEnabled: false }),
    ).toBeFalsy()
    expect(
      paymentRouteAvailable({
        ...available,
        direction: 'withdrawal',
        providerDepositEnabled: false,
      }),
    ).toBeTruthy()
    expect(
      paymentRouteAvailable({
        ...available,
        direction: 'withdrawal',
        routeWithdrawalEnabled: false,
      }),
    ).toBeFalsy()
  })
})

describe('payment route guards', () => {
  it('guards player deposit endpoints', async () => {
    const { build } = await import('@test/helper')
    const { vi } = await import('vitest')
    const app = await build()
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(null)
    const depositId = '00000000-0000-4000-8000-000000000000'
    const withdrawalId = '00000000-0000-4000-8000-000000000001'
    const fiatOrderId = '00000000-0000-4000-8000-000000000002'
    const responses = await Promise.all([
      app.inject({
        body: { amount: '10.00', currency: 'USDT' },
        headers: { 'idempotency-key': 'deposit-1' },
        method: 'POST',
        url: '/api/v1/wallet/crypto/deposits',
      }),
      app.inject({ method: 'GET', url: '/api/v1/wallet/crypto/deposits' }),
      app.inject({
        method: 'GET',
        url: `/api/v1/wallet/crypto/deposits/${depositId}`,
      }),
      app.inject({
        method: 'GET',
        url: '/api/v1/wallet/crypto/withdrawals/fee?currency=USDT&amount=10.00',
      }),
      app.inject({
        body: {
          address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
          amount: '10.00',
          currency: 'USDT',
        },
        headers: { 'idempotency-key': 'withdraw-1' },
        method: 'POST',
        url: '/api/v1/wallet/crypto/withdrawals',
      }),
      app.inject({ method: 'GET', url: '/api/v1/wallet/crypto/withdrawals' }),
      app.inject({
        method: 'GET',
        url: `/api/v1/wallet/crypto/withdrawals/${withdrawalId}`,
      }),
      app.inject({
        body: {
          amount: '10.00',
          currency: 'USD',
          routeCode: 'zeffra-apple-pay',
        },
        headers: { 'idempotency-key': 'fiat-deposit-1' },
        method: 'POST',
        url: '/api/v1/wallet/fiat/deposits',
      }),
      app.inject({ method: 'GET', url: '/api/v1/wallet/fiat/deposits' }),
      app.inject({
        method: 'GET',
        url: `/api/v1/wallet/fiat/deposits/${fiatOrderId}`,
      }),
      app.inject({
        body: {
          amount: '10.00',
          currency: 'USD',
          receiveAccount: 'payer@example.com',
          routeCode: 'zeffra-paypal',
        },
        headers: { 'idempotency-key': 'fiat-payout-1' },
        method: 'POST',
        url: '/api/v1/wallet/fiat/payouts',
      }),
      app.inject({ method: 'GET', url: '/api/v1/wallet/fiat/payouts' }),
      app.inject({
        method: 'GET',
        url: `/api/v1/wallet/fiat/payouts/${fiatOrderId}`,
      }),
    ])
    expect(responses.map((response) => response.statusCode)).toStrictEqual([
      401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401,
    ])
  })
})

describe('fiat provider defaults', () => {
  it('merges user identity with explicit billing details', () => {
    expect(
      resolveFiatBilling(
        { email: 'player@example.com', name: 'Ada Lovelace' },
        { city: 'London' },
      ),
    ).toMatchObject({
      city: 'London',
      country: 'US',
      email: 'player@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
  })

  it('builds stable device defaults while preserving explicit fields', () => {
    const first = resolveFiatDevice('user-1', '127.0.0.1', {
      language: 'zh-CN',
    })
    const second = resolveFiatDevice('user-1', '127.0.0.1')
    expect(first).toMatchObject({
      clientIp: '127.0.0.1',
      language: 'zh-CN',
    })
    expect(second.cookie).toBe(first.cookie)
  })
})

describe('fiat payout accounts', () => {
  const recipient = {
    address: '1 Main St',
    city: 'Los Angeles',
    country: 'US',
    email: 'player@example.com',
    firstName: 'Test',
    lastName: 'Player',
    phone: '+12025550123',
    postalCode: '90001',
    state: 'CA',
  }

  it('normalizes PayPal accounts and builds a virtual recipient', () => {
    expect(
      resolveFiatPayoutAccount({
        receiveAccount: 'Player@Example.com',
        route: { payoutAccountType: 'paypal' },
        userId: 'user-1',
      }),
    ).toMatchObject({
      receiveAccount: 'player@example.com',
      receiveAccountExpireAt: '12/2035',
      recipient: { email: 'player@example.com' },
    })
  })

  it('requires card recipient and expiry details', () => {
    expect(() =>
      resolveFiatPayoutAccount({
        receiveAccount: '4111111111111111',
        route: { payoutAccountType: 'card' },
        userId: 'user-1',
      }),
    ).toThrow('Card payout recipient is required')
    expect(
      resolveFiatPayoutAccount({
        receiveAccount: '4111111111111111',
        receiveAccountExpireAt: '12/2030',
        recipient,
        route: { payoutAccountType: 'card' },
        userId: 'user-1',
      }),
    ).toMatchObject({
      receiveAccount: '4111111111111111',
      receiveAccountExpireAt: '12/2030',
    })
  })

  it('normalizes Cash App cashtags', () => {
    expect(
      resolveFiatPayoutAccount({
        receiveAccount: 'Player',
        route: { payoutAccountType: 'cash_app' },
        userId: 'user-1',
      }),
    ).toMatchObject({ receiveAccount: '$Player' })
  })
})
