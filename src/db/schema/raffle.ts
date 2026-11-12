import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { user } from './auth'
import { currency } from './wallet'

export const raffleSku = pgTable(
  'raffle_sku',
  {
    category: text('category').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    description: text('description'),
    durationSec: integer('duration_sec').notNull(),
    earlyWindowSec: integer('early_window_sec').notNull(),
    giftCapBps: integer('gift_cap_bps').notNull(),
    id: text('id').primaryKey(),
    imageUrl: text('image_url'),
    name: text('name').notNull(),
    payoutAmount: bigint('payout_amount', { mode: 'bigint' }).notNull(),
    payoutCurrency: text('payout_currency')
      .notNull()
      .references(() => currency.code),
    slug: text('slug').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    status: text('status').notNull().default('active'),
    tag: text('tag'),
    tauBps: integer('tau_bps').notNull(),
    tauEarlyBps: integer('tau_early_bps').notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('raffle_sku_slug_idx').on(table.slug),
    index('raffle_sku_status_sort_idx').on(table.status, table.sortOrder),
    index('raffle_sku_payout_currency_idx').on(table.payoutCurrency),
    check(
      'raffle_sku_category_check',
      sql`${table.category} in ('cs2', 'dota2', 'digital', 'motorcycle')`,
    ),
    check(
      'raffle_sku_tag_check',
      sql`${table.tag} is null or ${table.tag} in ('new', 'hot')`,
    ),
    check(
      'raffle_sku_status_check',
      sql`${table.status} in ('active', 'inactive')`,
    ),
  ],
)

export const raffleRound = pgTable(
  'raffle_round',
  {
    botShares: integer('bot_shares').notNull().default(0),
    capacity: integer('capacity').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    earlyWindowSec: integer('early_window_sec').notNull(),
    endsAt: timestamp('ends_at').notNull(),
    giftCapBps: integer('gift_cap_bps').notNull(),
    id: text('id').primaryKey(),
    payoutAmount: bigint('payout_amount', { mode: 'bigint' }).notNull(),
    payoutCurrency: text('payout_currency')
      .notNull()
      .references(() => currency.code),
    roundNumber: integer('round_number').notNull(),
    serverSeed: text('server_seed'),
    serverSeedHash: text('server_seed_hash').notNull(),
    settledAt: timestamp('settled_at'),
    sharePrice: bigint('share_price', { mode: 'bigint' }).notNull(),
    skuId: text('sku_id')
      .notNull()
      .references(() => raffleSku.id),
    sold: integer('sold').notNull().default(0),
    soldGift: integer('sold_gift').notNull().default(0),
    startsAt: timestamp('starts_at').notNull(),
    status: text('status').notNull(),
    tauBps: integer('tau_bps').notNull(),
    tauEarlyBps: integer('tau_early_bps').notNull(),
    winnerIsPlatform: boolean('winner_is_platform').notNull().default(false),
    winnerUserId: text('winner_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    winningNumber: integer('winning_number'),
  },
  (table) => [
    uniqueIndex('raffle_round_sku_number_idx').on(
      table.skuId,
      table.roundNumber,
    ),
    uniqueIndex('raffle_round_sku_open_idx')
      .on(table.skuId)
      .where(sql`${table.status} = 'open'`),
    index('raffle_round_status_ends_idx').on(table.status, table.endsAt),
    index('raffle_round_payout_currency_idx').on(table.payoutCurrency),
    index('raffle_round_winner_user_id_idx').on(table.winnerUserId),
    check(
      'raffle_round_status_check',
      sql`${table.status} in ('open', 'drawing', 'settled', 'voided')`,
    ),
  ],
)

export const raffleSkuRelations = relations(raffleSku, ({ many }) => ({
  rounds: many(raffleRound),
}))

export const raffleRoundRelations = relations(raffleRound, ({ one }) => ({
  sku: one(raffleSku, {
    fields: [raffleRound.skuId],
    references: [raffleSku.id],
  }),
  winner: one(user, {
    fields: [raffleRound.winnerUserId],
    references: [user.id],
  }),
}))
