import { eq } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'

export async function currency(db: Db, requested?: string) {
  const code = requested?.trim().toUpperCase()
  if (requested !== undefined && !code) {
    throw Object.assign(new Error('Currency is required'), { statusCode: 400 })
  }

  const row = code
    ? await db.query.currency.findFirst({
        where: eq(schema.currency.code, code),
      })
    : await db.query.currency.findFirst({
        orderBy: (table, { asc }) => [asc(table.code)],
        where: eq(schema.currency.enabled, true),
      })

  if (!row) {
    throw Object.assign(
      new Error(code ? `Unsupported currency: ${code}` : 'No active currency'),
      { statusCode: code ? 400 : 503 },
    )
  }

  return row
}
