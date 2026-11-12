import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: ['.env.local', '.env'], quiet: true })

const url = process.env.DATABASE_URL

if (!url) {
  throw new Error('DATABASE_URL is required')
}

export default defineConfig({
  dbCredentials: { url },
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/db/schema/index.ts',
  strict: true,
  verbose: true,
})
