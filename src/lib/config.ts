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

const envSchema = z.object({
  AUTH_COOKIE_DOMAIN: z.string().trim().optional(),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  HOST: z.string().trim().min(1).default('localhost'),
  LOG_LEVEL: z.enum(logLevels).default('info'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8000),
  REDIS_URL: z.string().min(1),
  TRUSTED_ORIGINS: z.string().transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ),
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
