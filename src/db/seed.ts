import { generateRandomString, hashPassword } from 'better-auth/crypto'
import { eq, sql } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'dev@example.com'
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Password@123'
const HOUSE_EMAIL = 'house@system.local'
const KUCOIN_PAY_PROVIDER_ID = 'kucoinpay'
const KUCOIN_PAY_TRON_USDT_ROUTE_ID = 'kucoinpay-tron-usdt'
const ZEFFRA_PROVIDER_ID = 'zeffra'

const GAMES = [
  { name: 'Dice', slug: 'dice' },
  { name: 'Crash', slug: 'crash' },
  { name: 'Mines', slug: 'mines' },
  { name: 'Hilo', slug: 'hilo' },
  { name: 'Plinko', slug: 'plinko' },
  { name: 'Wheel', slug: 'wheel' },
]

async function seedCurrencies(db: Db) {
  const currencies = [
    {
      bettingEnabled: true,
      code: 'USDT',
      decimals: 6,
      enabled: true,
      locale: 'en-US',
      symbol: 'USDT',
      type: 'crypto',
      walletEnabled: true,
    },
    {
      bettingEnabled: true,
      code: 'USD',
      decimals: 2,
      enabled: true,
      locale: 'en-US',
      symbol: 'USD',
      type: 'fiat',
      walletEnabled: true,
    },
  ]

  await Promise.all(
    currencies.map((currency) =>
      db
        .insert(schema.currency)
        .values(currency)
        .onConflictDoUpdate({
          set: {
            bettingEnabled: sql`excluded.betting_enabled`,
            decimals: sql`excluded.decimals`,
            enabled: sql`excluded.enabled`,
            locale: sql`excluded.locale`,
            symbol: sql`excluded.symbol`,
            type: sql`excluded.type`,
            walletEnabled: sql`excluded.wallet_enabled`,
          },
          target: schema.currency.code,
        }),
    ),
  )
}

async function seedAdmin(db: Db) {
  const existing = await db.query.user.findFirst({
    where: eq(schema.user.email, ADMIN_EMAIL),
  })
  if (existing) {
    return
  }

  const userId = generateRandomString(32, 'a-z', 'A-Z', '0-9')
  await db.insert(schema.user).values({
    email: ADMIN_EMAIL,
    emailVerified: true,
    id: userId,
    name: 'Admin',
    role: 'admin',
  })
  await db.insert(schema.account).values({
    accountId: userId,
    id: generateRandomString(32, 'a-z', 'A-Z', '0-9'),
    password: await hashPassword(ADMIN_PASSWORD),
    providerId: 'credential',
    userId,
  })
}

async function seedHouse(db: Db) {
  const existing = await db.query.user.findFirst({
    where: eq(schema.user.email, HOUSE_EMAIL),
  })
  if (existing) {
    return
  }

  await db.insert(schema.user).values({
    email: HOUSE_EMAIL,
    emailVerified: true,
    id: generateRandomString(32, 'a-z', 'A-Z', '0-9'),
    name: 'House',
    role: 'system',
  })
}

async function seedGames(db: Db) {
  await Promise.all(
    GAMES.map(async (game) => {
      const existing = await db.query.game.findFirst({
        where: eq(schema.game.slug, game.slug),
      })
      if (existing) {
        await db
          .update(schema.game)
          .set({ name: game.name })
          .where(eq(schema.game.id, existing.id))
        return
      }

      await db.insert(schema.game).values({
        category: 'inhouse',
        id: generateRandomString(32, 'a-z', 'A-Z', '0-9'),
        launchType: 'internal',
        name: game.name,
        slug: game.slug,
      })
    }),
  )
}

async function seedPaymentProvider(db: Db) {
  await db
    .insert(schema.paymentProvider)
    .values({
      code: 'zeffra',
      depositEnabled: true,
      enabled: true,
      id: ZEFFRA_PROVIDER_ID,
      name: 'Zeffra',
      withdrawalEnabled: true,
    })
    .onConflictDoUpdate({
      set: {
        depositEnabled: true,
        enabled: true,
        name: 'Zeffra',
        withdrawalEnabled: true,
      },
      target: schema.paymentProvider.code,
    })

  await db
    .insert(schema.paymentProvider)
    .values({
      code: 'kucoinpay',
      depositEnabled: true,
      enabled: true,
      id: KUCOIN_PAY_PROVIDER_ID,
      name: 'KuCoin Pay',
      withdrawalEnabled: true,
    })
    .onConflictDoUpdate({
      set: {
        code: 'kucoinpay',
        depositEnabled: true,
        enabled: true,
        name: 'KuCoin Pay',
        withdrawalEnabled: true,
      },
      target: schema.paymentProvider.code,
    })

  await db
    .insert(schema.cryptoRoute)
    .values({
      chain: 'TRON',
      code: KUCOIN_PAY_TRON_USDT_ROUTE_ID,
      currencyCode: 'USDT',
      depositEnabled: true,
      depositFeeRateBps: 20,
      enabled: true,
      id: KUCOIN_PAY_TRON_USDT_ROUTE_ID,
      minWithdrawAmount: 1_000_000n,
      payoutFeeFixed: 1_000_000n,
      priority: 0,
      providerId: KUCOIN_PAY_PROVIDER_ID,
      symbol: 'USDT',
      withdrawalEnabled: true,
    })
    .onConflictDoUpdate({
      set: {
        chain: 'TRON',
        currencyCode: 'USDT',
        depositEnabled: true,
        depositFeeRateBps: 20,
        enabled: true,
        minWithdrawAmount: 1_000_000n,
        payoutFeeFixed: 1_000_000n,
        providerId: KUCOIN_PAY_PROVIDER_ID,
        symbol: 'USDT',
        withdrawalEnabled: true,
      },
      target: schema.cryptoRoute.code,
    })

  const fiatRoutes = [
    {
      billingRequired: true,
      code: 'zeffra-apple-pay',
      country: 'US',
      depositEnabled: true,
      depositFeeFixed: 30n,
      depositFeeRateBps: 900,
      maxDepositAmount: 50_000n,
      maxWithdrawAmount: null,
      minDepositAmount: 100n,
      minWithdrawAmount: null,
      paymentMethod: 'apple_pay',
      payoutAccountType: null,
      payoutFeeFixed: 0n,
      payoutFeeRateBps: 0,
      priority: 0,
      providerPaymentCode: '111',
      reviewWithdrawAmount: null,
      withdrawalEnabled: false,
    },
    {
      billingRequired: true,
      code: 'zeffra-cash-app',
      country: 'US',
      depositEnabled: true,
      depositFeeFixed: 30n,
      depositFeeRateBps: 900,
      maxDepositAmount: 50_000n,
      maxWithdrawAmount: null,
      minDepositAmount: 100n,
      minWithdrawAmount: null,
      paymentMethod: 'cash_app',
      payoutAccountType: null,
      payoutFeeFixed: 0n,
      payoutFeeRateBps: 0,
      priority: 1,
      providerPaymentCode: '113',
      reviewWithdrawAmount: null,
      withdrawalEnabled: false,
    },
    {
      billingRequired: true,
      code: 'zeffra-google-pay',
      country: 'US',
      depositEnabled: true,
      depositFeeFixed: 30n,
      depositFeeRateBps: 900,
      maxDepositAmount: 50_000n,
      maxWithdrawAmount: null,
      minDepositAmount: 100n,
      minWithdrawAmount: null,
      paymentMethod: 'google_pay',
      payoutAccountType: null,
      payoutFeeFixed: 0n,
      payoutFeeRateBps: 0,
      priority: 2,
      providerPaymentCode: '114',
      reviewWithdrawAmount: null,
      withdrawalEnabled: false,
    },
    {
      billingRequired: false,
      code: 'zeffra-paypal',
      country: 'US',
      depositEnabled: false,
      depositFeeFixed: 0n,
      depositFeeRateBps: 0,
      maxDepositAmount: null,
      maxWithdrawAmount: 200_000n,
      minDepositAmount: null,
      minWithdrawAmount: 300n,
      paymentMethod: 'paypal',
      payoutAccountType: 'paypal',
      payoutFeeFixed: 30n,
      payoutFeeRateBps: 150,
      priority: 0,
      providerPaymentCode: '112',
      reviewWithdrawAmount: null,
      withdrawalEnabled: true,
    },
    {
      billingRequired: false,
      code: 'zeffra-debit-card',
      country: 'US',
      depositEnabled: false,
      depositFeeFixed: 0n,
      depositFeeRateBps: 0,
      maxDepositAmount: null,
      maxWithdrawAmount: 500_000n,
      minDepositAmount: null,
      minWithdrawAmount: 300n,
      paymentMethod: 'debit_card',
      payoutAccountType: 'card',
      payoutFeeFixed: 50n,
      payoutFeeRateBps: 200,
      priority: 1,
      providerPaymentCode: '117',
      reviewWithdrawAmount: null,
      withdrawalEnabled: true,
    },
  ] as const

  for (const route of fiatRoutes) {
    await db
      .insert(schema.fiatRoute)
      .values({
        ...route,
        currencyCode: 'USD',
        enabled: true,
        id: route.code,
        providerId: ZEFFRA_PROVIDER_ID,
      })
      .onConflictDoUpdate({
        set: {
          ...route,
          currencyCode: 'USD',
          enabled: true,
          providerId: ZEFFRA_PROVIDER_ID,
        },
        target: schema.fiatRoute.code,
      })
  }
}

export async function seed(db: Db) {
  await seedCurrencies(db)
  await seedAdmin(db)
  await seedHouse(db)
  await seedGames(db)
  await seedPaymentProvider(db)
}
