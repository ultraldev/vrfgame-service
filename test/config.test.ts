import { describe, expect, it } from 'vitest'

import { loadConfig } from '@/lib/config'

describe(loadConfig, () => {
  it('provides development defaults', () => {
    const config = loadConfig({
      BETTER_AUTH_SECRET: 'test-secret',
      BETTER_AUTH_URL: 'http://localhost:8000',
      DATABASE_URL: 'postgresql://localhost/vrfgame',
      REDIS_URL: 'redis://localhost:6379',
      TRUSTED_ORIGINS: 'http://localhost:3000',
    })

    expect(config).toStrictEqual({
      BETTER_AUTH_SECRET: 'test-secret',
      BETTER_AUTH_URL: 'http://localhost:8000',
      DATABASE_URL: 'postgresql://localhost/vrfgame',
      HOST: 'localhost',
      KUCOIN_PAY_API_BASE_URL: 'https://pay.tunas.io/api/kucoinpay',
      KUCOIN_PAY_ONCHAIN_PAYIN_FEE_BPS: 20,
      KUCOIN_PAY_PAYOUT_SERVICE_FEE: '1',
      LOG_LEVEL: 'info',
      NODE_ENV: 'development',
      PORT: 8000,
      REDIS_URL: 'redis://localhost:6379',
      TRUSTED_ORIGINS: ['http://localhost:3000'],
      WITHDRAW_WAGERING_RATIO: 3,
      ZEFFRA_API_BASE_URL: 'https://api.zeffra.com',
      ZEFFRA_ENABLE_3DS: '1',
    })
  })

  it('coerces the port and preserves explicit settings', () => {
    const config = loadConfig({
      BETTER_AUTH_SECRET: 'test-secret',
      BETTER_AUTH_URL: 'http://localhost:8000',
      DATABASE_URL: 'postgresql://localhost/vrfgame_test',
      HOST: '127.0.0.1',
      LOG_LEVEL: 'debug',
      NODE_ENV: 'test',
      PORT: '9000',
      REDIS_URL: 'redis://localhost:6380',
      TRUSTED_ORIGINS: 'http://localhost:3000',
    })

    expect(config).toStrictEqual({
      BETTER_AUTH_SECRET: 'test-secret',
      BETTER_AUTH_URL: 'http://localhost:8000',
      DATABASE_URL: 'postgresql://localhost/vrfgame_test',
      HOST: '127.0.0.1',
      KUCOIN_PAY_API_BASE_URL: 'https://pay.tunas.io/api/kucoinpay',
      KUCOIN_PAY_ONCHAIN_PAYIN_FEE_BPS: 20,
      KUCOIN_PAY_PAYOUT_SERVICE_FEE: '1',
      LOG_LEVEL: 'debug',
      NODE_ENV: 'test',
      PORT: 9000,
      REDIS_URL: 'redis://localhost:6380',
      TRUSTED_ORIGINS: ['http://localhost:3000'],
      WITHDRAW_WAGERING_RATIO: 3,
      ZEFFRA_API_BASE_URL: 'https://api.zeffra.com',
      ZEFFRA_ENABLE_3DS: '1',
    })
  })

  it('rejects invalid configuration', () => {
    expect(() => loadConfig({ PORT: 'invalid' })).toThrow(
      'Invalid environment configuration',
    )
  })

  it('requires complete KuCoin credentials when any are configured', () => {
    expect(() =>
      loadConfig({
        BETTER_AUTH_SECRET: 'test-secret',
        BETTER_AUTH_URL: 'http://localhost:8000',
        DATABASE_URL: 'postgresql://localhost/vrfgame',
        KUCOIN_PAY_API_KEY: 'api-key',
        REDIS_URL: 'redis://localhost:6379',
        TRUSTED_ORIGINS: 'http://localhost:3000',
      }),
    ).toThrow('must be configured together')
  })

  it('requires complete Zeffra credentials when any are configured', () => {
    expect(() =>
      loadConfig({
        BETTER_AUTH_SECRET: 'test-secret',
        BETTER_AUTH_URL: 'http://localhost:8000',
        DATABASE_URL: 'postgresql://localhost/vrfgame',
        REDIS_URL: 'redis://localhost:6379',
        TRUSTED_ORIGINS: 'http://localhost:3000',
        ZEFFRA_MERCHANT_CODE: 'merchant-1',
      }),
    ).toThrow('must be configured together')
  })

  it('requires seed encryption keys in production', () => {
    expect(() =>
      loadConfig({
        BETTER_AUTH_SECRET: 'test-secret',
        BETTER_AUTH_URL: 'https://api.example.com',
        DATABASE_URL: 'postgresql://localhost/vrfgame',
        NODE_ENV: 'production',
        REDIS_URL: 'redis://localhost:6379',
        TRUSTED_ORIGINS: 'https://example.com',
      }),
    ).toThrow('SEED_ENCRYPTION_KEYS is required in production')
  })

  it('validates the seed encryption keyring', () => {
    expect(() =>
      loadConfig({
        BETTER_AUTH_SECRET: 'test-secret',
        BETTER_AUTH_URL: 'https://api.example.com',
        DATABASE_URL: 'postgresql://localhost/vrfgame',
        NODE_ENV: 'production',
        REDIS_URL: 'redis://localhost:6379',
        SEED_ENCRYPTION_ACTIVE_KEY_ID: '2026-11',
        SEED_ENCRYPTION_KEYS: JSON.stringify({
          '2026-11': '11'.repeat(32),
        }),
        TRUSTED_ORIGINS: 'https://example.com',
      }),
    ).not.toThrow()

    expect(() =>
      loadConfig({
        BETTER_AUTH_SECRET: 'test-secret',
        BETTER_AUTH_URL: 'https://api.example.com',
        DATABASE_URL: 'postgresql://localhost/vrfgame',
        NODE_ENV: 'production',
        REDIS_URL: 'redis://localhost:6379',
        SEED_ENCRYPTION_ACTIVE_KEY_ID: 'missing',
        SEED_ENCRYPTION_KEYS: JSON.stringify({
          '2026-11': '11'.repeat(32),
        }),
        TRUSTED_ORIGINS: 'https://example.com',
      }),
    ).toThrow('Active seed encryption key not found')
  })
})
