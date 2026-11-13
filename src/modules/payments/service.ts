import { httpErrors } from '@fastify/sensible'
import { and, asc, eq } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'

import type { PaymentDirection } from './util'
import { paymentRouteAvailable } from './util'

export async function findEnabledCryptoRoute(
  db: Db,
  currencyCode: string,
  direction: PaymentDirection,
) {
  return await db
    .select({
      currency: schema.currency,
      provider: schema.paymentProvider,
      route: schema.cryptoRoute,
    })
    .from(schema.cryptoRoute)
    .innerJoin(
      schema.paymentProvider,
      eq(schema.cryptoRoute.providerId, schema.paymentProvider.id),
    )
    .innerJoin(
      schema.currency,
      eq(schema.cryptoRoute.currencyCode, schema.currency.code),
    )
    .where(
      and(
        eq(schema.cryptoRoute.currencyCode, currencyCode.trim().toUpperCase()),
        eq(schema.cryptoRoute.enabled, true),
        eq(
          direction === 'deposit'
            ? schema.cryptoRoute.depositEnabled
            : schema.cryptoRoute.withdrawalEnabled,
          true,
        ),
        eq(schema.paymentProvider.enabled, true),
        eq(
          direction === 'deposit'
            ? schema.paymentProvider.depositEnabled
            : schema.paymentProvider.withdrawalEnabled,
          true,
        ),
        eq(schema.currency.enabled, true),
        eq(schema.currency.walletEnabled, true),
      ),
    )
    .orderBy(asc(schema.cryptoRoute.priority), asc(schema.cryptoRoute.id))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

export async function requireEnabledCryptoRoute(
  db: Db,
  currencyCode: string,
  direction: PaymentDirection,
) {
  const selection = await findEnabledCryptoRoute(db, currencyCode, direction)
  if (!selection) {
    throw httpErrors.serviceUnavailable(
      `No enabled crypto ${direction} route for ${currencyCode}`,
    )
  }
  if (
    !paymentRouteAvailable({
      currencyEnabled: selection.currency.enabled,
      currencyWalletEnabled: selection.currency.walletEnabled,
      direction,
      providerDepositEnabled: selection.provider.depositEnabled,
      providerEnabled: selection.provider.enabled,
      providerWithdrawalEnabled: selection.provider.withdrawalEnabled,
      routeDepositEnabled: selection.route.depositEnabled,
      routeEnabled: selection.route.enabled,
      routeWithdrawalEnabled: selection.route.withdrawalEnabled,
    })
  ) {
    throw httpErrors.serviceUnavailable(
      `Crypto ${direction} route is currently unavailable`,
    )
  }
  return selection
}

export function findEnabledFiatRoutes(
  db: Db,
  currencyCode: string,
  direction: PaymentDirection,
) {
  return db
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
        eq(
          direction === 'deposit'
            ? schema.fiatRoute.depositEnabled
            : schema.fiatRoute.withdrawalEnabled,
          true,
        ),
        eq(schema.paymentProvider.enabled, true),
        eq(
          direction === 'deposit'
            ? schema.paymentProvider.depositEnabled
            : schema.paymentProvider.withdrawalEnabled,
          true,
        ),
        eq(schema.currency.enabled, true),
        eq(schema.currency.walletEnabled, true),
      ),
    )
    .orderBy(asc(schema.fiatRoute.priority), asc(schema.fiatRoute.code))
}

export async function requireEnabledFiatRoute(
  db: Db,
  routeCode: string,
  currencyCode: string,
  direction: PaymentDirection,
) {
  const rows = await findEnabledFiatRoutes(db, currencyCode, direction)
  const selection = rows.find((row) => row.route.code === routeCode)
  if (!selection) {
    throw httpErrors.serviceUnavailable(
      `No enabled fiat ${direction} route for ${routeCode}`,
    )
  }
  return selection
}
