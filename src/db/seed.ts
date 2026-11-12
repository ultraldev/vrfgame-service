import { generateRandomString, hashPassword } from 'better-auth/crypto'
import { eq, sql } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'dev@example.com'
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Password@123'
const HOUSE_EMAIL = 'house@system.local'

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
      code: 'USDT',
      decimals: 6,
      locale: 'en-US',
      symbol: 'USDT',
      type: 'crypto',
    },
    {
      code: 'USD',
      decimals: 2,
      locale: 'en-US',
      symbol: 'USD',
      type: 'fiat',
    },
  ]

  await Promise.all(
    currencies.map((currency) =>
      db
        .insert(schema.currency)
        .values(currency)
        .onConflictDoUpdate({
          set: {
            decimals: sql`excluded.decimals`,
            locale: sql`excluded.locale`,
            symbol: sql`excluded.symbol`,
            type: sql`excluded.type`,
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

export async function seed(db: Db) {
  await seedCurrencies(db)
  await seedAdmin(db)
  await seedHouse(db)
  await seedGames(db)
}
