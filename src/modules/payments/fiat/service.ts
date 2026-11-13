import { and, asc, eq, or } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'

import { fiatRouteOption } from './util'

export async function getFiatOptions(db: Db, currencyCode: string) {
  const rows = await db
    .select({
      currency: schema.currency,
      provider: schema.paymentProvider,
      route: schema.fiatRoute,
    })
    .from(schema.fiatRoute)
    .innerJoin(
      schema.paymentProvider,
      eq(schema.fiatRoute.providerId, schema.paymentProvider.id),
    )
    .innerJoin(
      schema.currency,
      eq(schema.fiatRoute.currencyCode, schema.currency.code),
    )
    .where(
      and(
        eq(schema.fiatRoute.currencyCode, currencyCode.trim().toUpperCase()),
        eq(schema.fiatRoute.enabled, true),
        or(
          eq(schema.fiatRoute.depositEnabled, true),
          eq(schema.fiatRoute.withdrawalEnabled, true),
        ),
        eq(schema.paymentProvider.enabled, true),
        or(
          eq(schema.paymentProvider.depositEnabled, true),
          eq(schema.paymentProvider.withdrawalEnabled, true),
        ),
        eq(schema.currency.enabled, true),
        eq(schema.currency.walletEnabled, true),
      ),
    )
    .orderBy(asc(schema.fiatRoute.priority), asc(schema.fiatRoute.code))
  return {
    items: rows.map(({ currency, provider, route }) =>
      fiatRouteOption(currency, provider, route),
    ),
  }
}
