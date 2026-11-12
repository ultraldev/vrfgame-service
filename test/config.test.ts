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
      LOG_LEVEL: 'info',
      NODE_ENV: 'development',
      PORT: 8000,
      REDIS_URL: 'redis://localhost:6379',
      TRUSTED_ORIGINS: ['http://localhost:3000'],
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
      LOG_LEVEL: 'debug',
      NODE_ENV: 'test',
      PORT: 9000,
      REDIS_URL: 'redis://localhost:6380',
      TRUSTED_ORIGINS: ['http://localhost:3000'],
    })
  })

  it('rejects invalid configuration', () => {
    expect(() => loadConfig({ PORT: 'invalid' })).toThrow(
      'Invalid environment configuration',
    )
  })
})
