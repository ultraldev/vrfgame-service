import { and, desc, eq, lt, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import { decodeCursor, encodeCursor } from '@/lib/cursor'

import type { FiatHistoryFilters } from './schema'

export type FiatOrderRow = typeof schema.fiatOrder.$inferSelect

export async function findFiatRouteCode(db: Db, routeId: string) {
  const route = await db.query.fiatRoute.findFirst({
    columns: { code: true },
    where: eq(schema.fiatRoute.id, routeId),
  })
  return route?.code ?? ''
}

export async function listFiatOrders<T>(
  db: Db,
  userId: string,
  orderType: 'deposit' | 'payout',
  query: FiatHistoryFilters,
  map: (row: FiatOrderRow) => Promise<T>,
) {
  const filters: SQL[] = [
    eq(schema.fiatOrder.userId, userId),
    eq(schema.fiatOrder.type, orderType),
  ]
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor)
    const createdAt = new Date(cursor.createdAt)
    const condition = or(
      lt(schema.fiatOrder.createdAt, createdAt),
      and(
        eq(schema.fiatOrder.createdAt, createdAt),
        lt(schema.fiatOrder.id, cursor.id),
      ),
    )
    if (condition) {
      filters.push(condition)
    }
  }
  const rows = await db.query.fiatOrder.findMany({
    limit: query.limit + 1,
    orderBy: [desc(schema.fiatOrder.createdAt), desc(schema.fiatOrder.id)],
    where: and(...filters),
  })
  const page = rows.slice(0, query.limit)
  const last = page.at(-1)
  return {
    items: await Promise.all(page.map(map)),
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({
            createdAt: last.createdAt.toISOString(),
            id: last.id,
          })
        : null,
  }
}
