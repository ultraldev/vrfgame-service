import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

import { buildApp } from '@/app'
import { loadConfig } from '@/lib/config'
import { openapi } from '@/lib/openapi'

const config = loadConfig({
  ...process.env,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? randomUUID(),
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? 'http://localhost:8000',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://openapi',
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS ?? 'http://localhost:8000',
})
const app = await buildApp({ config })

await app.ready()
await writeFile('openapi.json', `${JSON.stringify(openapi(app), null, 2)}\n`)
await app.close()
