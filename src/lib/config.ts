import { config } from 'dotenv'
import * as z from 'zod'

config({ path: ['.env.local', '.env'], quiet: true })

const logLevels = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const

const seedKeyringSchema = z.record(
  z.string().regex(/^[^:]+$/u),
  z.string().regex(/^[a-fA-F0-9]{64}$/u),
)

const envSchema = z
  .object({
    AUTH_COOKIE_DOMAIN: z.string().trim().optional(),
    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_URL: z.string().min(1),
    BET_MAX_AMOUNT: z.string().trim().min(1).optional(),
    BET_MIN_AMOUNT: z.string().trim().min(1).optional(),
    DATABASE_URL: z.string().min(1),
    HOST: z.string().trim().min(1).default('localhost'),
    KUCOIN_PAY_API_BASE_URL: z
      .url()
      .default('https://pay.tunas.io/api/kucoinpay'),
    KUCOIN_PAY_API_KEY: z.string().trim().min(1).optional(),
    KUCOIN_PAY_ONCHAIN_PAYIN_FEE_BPS: z.coerce
      .number()
      .int()
      .min(0)
      .max(10_000)
      .default(20),
    KUCOIN_PAY_PAYOUT_SERVICE_FEE: z.string().trim().min(1).default('1'),
    KUCOIN_PAY_PLATFORM_PUBLIC_KEY: z.string().trim().min(1).optional(),
    KUCOIN_PAY_PRIVATE_KEY: z.string().trim().min(1).optional(),
    KUCOIN_PAY_RELAY_AUTH_BASE64: z.string().trim().min(1).optional(),
    KUCOIN_PAY_SUB_MERCHANT_ID: z.string().trim().min(1).optional(),
    LOG_LEVEL: z.enum(logLevels).default('info'),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PAYOUT_MAX_AMOUNT: z.string().trim().min(1).optional(),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8000),
    REDIS_URL: z.string().min(1),
    SEED_ENCRYPTION_ACTIVE_KEY_ID: z.string().trim().min(1).optional(),
    SEED_ENCRYPTION_KEYS: z.string().trim().min(1).optional(),
    TRUSTED_ORIGINS: z.string().transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
    WITHDRAW_WAGERING_RATIO: z.coerce.number().int().min(0).default(3),
    WITHDRAW_WAGERING_REPORTING_CURRENCY: z.string().trim().min(1).optional(),
    ZEFFRA_API_BASE_URL: z.url().default('https://api.zeffra.com'),
    ZEFFRA_AUTH_RETURN_URL: z.url().optional(),
    ZEFFRA_ENABLE_3DS: z.enum(['0', '1']).default('1'),
    ZEFFRA_MERCHANT_CODE: z.string().trim().min(1).optional(),
    ZEFFRA_NOTIFY_URL: z.url().optional(),
    ZEFFRA_PRIVATE_KEY: z.string().trim().min(1).optional(),
    ZEFFRA_PUBLIC_KEY: z.string().trim().min(1).optional(),
    ZEFFRA_WEBSITE: z.url().optional(),
  })
  .superRefine((env, context) => {
    const zeffraFields = [
      env.ZEFFRA_MERCHANT_CODE,
      env.ZEFFRA_PRIVATE_KEY,
      env.ZEFFRA_PUBLIC_KEY,
    ]
    const configuredZeffraFields = zeffraFields.filter(Boolean).length
    if (configuredZeffraFields > 0 && configuredZeffraFields < 3) {
      context.addIssue({
        code: 'custom',
        message:
          'ZEFFRA_MERCHANT_CODE, ZEFFRA_PRIVATE_KEY, and ZEFFRA_PUBLIC_KEY must be configured together',
        path: ['ZEFFRA_MERCHANT_CODE'],
      })
    }

    const kuCoinFields = [
      env.KUCOIN_PAY_API_KEY,
      env.KUCOIN_PAY_PLATFORM_PUBLIC_KEY,
      env.KUCOIN_PAY_PRIVATE_KEY,
      env.KUCOIN_PAY_SUB_MERCHANT_ID,
    ]
    const configuredKuCoinFields = kuCoinFields.filter(Boolean).length
    if (configuredKuCoinFields > 0 && configuredKuCoinFields < 4) {
      context.addIssue({
        code: 'custom',
        message:
          'KUCOIN_PAY_API_KEY, PRIVATE_KEY, PLATFORM_PUBLIC_KEY, and SUB_MERCHANT_ID must be configured together',
        path: ['KUCOIN_PAY_API_KEY'],
      })
    }

    const raw = env.SEED_ENCRYPTION_KEYS

    if (!raw) {
      if (env.NODE_ENV === 'production') {
        context.addIssue({
          code: 'custom',
          message: 'SEED_ENCRYPTION_KEYS is required in production',
          path: ['SEED_ENCRYPTION_KEYS'],
        })
      }
      return
    }

    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'SEED_ENCRYPTION_KEYS must be a JSON object',
        path: ['SEED_ENCRYPTION_KEYS'],
      })
      return
    }

    const keys = seedKeyringSchema.safeParse(value)
    if (!keys.success) {
      context.addIssue({
        code: 'custom',
        message: 'SEED_ENCRYPTION_KEYS must map key IDs to 32-byte hex keys',
        path: ['SEED_ENCRYPTION_KEYS'],
      })
      return
    }

    const activeId = env.SEED_ENCRYPTION_ACTIVE_KEY_ID
    if (!activeId) {
      context.addIssue({
        code: 'custom',
        message: 'SEED_ENCRYPTION_ACTIVE_KEY_ID is required with a keyring',
        path: ['SEED_ENCRYPTION_ACTIVE_KEY_ID'],
      })
      return
    }

    if (!(activeId in keys.data)) {
      context.addIssue({
        code: 'custom',
        message: `Active seed encryption key not found: ${activeId}`,
        path: ['SEED_ENCRYPTION_ACTIVE_KEY_ID'],
      })
    }
  })

export type AppConfig = z.infer<typeof envSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.safeParse(env)

  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${z.prettifyError(result.error)}`,
    )
  }

  return result.data
}
