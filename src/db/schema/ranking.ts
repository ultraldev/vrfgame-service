import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { user } from './auth'
import { currency } from './wallet'

export const rankingPeriod = pgTable(
  'ranking_period',
  {
    bucketDate: date('bucket_date', { mode: 'string' }).notNull(),
    computedAt: timestamp('computed_at').defaultNow().notNull(),
    dueAt: timestamp('due_at').defaultNow().notNull(),
    lastError: text('last_error'),
    periodType: text('period_type').default('daily').notNull(),
    settledAt: timestamp('settled_at'),
    settlementAttempts: integer('settlement_attempts').default(0).notNull(),
    status: text('status').default('open').notNull(),
    wagered: bigint('wagered', { mode: 'bigint' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.periodType, table.bucketDate] }),
    index('ranking_period_due_idx').on(table.status, table.dueAt),
    check('ranking_period_wagered_check', sql`${table.wagered} >= 0`),
    check(
      'ranking_period_status_check',
      sql`${table.status} in ('open', 'settled', 'failed')`,
    ),
    check(
      'ranking_period_settlement_attempts_check',
      sql`${table.settlementAttempts} >= 0`,
    ),
  ],
)

export const rankingSettlementClock = pgTable('ranking_settlement_clock', {
  nextBucketDate: date('next_bucket_date', { mode: 'string' }).notNull(),
  periodType: text('period_type').primaryKey(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

export const rankingEntry = pgTable(
  'ranking_entry',
  {
    betCount: integer('bet_count').notNull(),
    bucketDate: date('bucket_date', { mode: 'string' }).notNull(),
    computedAt: timestamp('computed_at').defaultNow().notNull(),
    periodType: text('period_type').default('daily').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    wagered: bigint('wagered', { mode: 'bigint' }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.periodType, table.bucketDate, table.userId],
    }),
    index('ranking_entry_user_id_idx').on(table.userId),
    index('ranking_entry_bucket_wagered_idx').on(
      table.periodType,
      table.bucketDate,
      table.wagered,
    ),
    check('ranking_entry_wagered_check', sql`${table.wagered} >= 0`),
  ],
)

export const rankingReward = pgTable(
  'ranking_reward',
  {
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    attempts: integer('attempts').default(0).notNull(),
    bucketDate: date('bucket_date', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currency.code),
    heldReason: text('held_reason'),
    lastError: text('last_error'),
    percentageBps: integer('percentage_bps').notNull(),
    periodType: text('period_type').default('daily').notNull(),
    poolAmount: bigint('pool_amount', { mode: 'bigint' }).notNull(),
    rank: integer('rank').notNull(),
    resolvedAt: timestamp('resolved_at'),
    status: text('status').default('pending').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    wagered: bigint('wagered', { mode: 'bigint' }).notNull(),
    walletTransactionId: text('wallet_transaction_id'),
  },
  (table) => [
    primaryKey({
      columns: [table.periodType, table.bucketDate, table.rank],
    }),
    uniqueIndex('ranking_reward_bucket_user_idx').on(
      table.periodType,
      table.bucketDate,
      table.userId,
    ),
    index('ranking_reward_status_idx').on(table.status),
    index('ranking_reward_user_id_idx').on(table.userId),
    index('ranking_reward_currency_idx').on(table.currency),
    check(
      'ranking_reward_status_check',
      sql`${table.status} in ('pending', 'held', 'paid', 'skipped')`,
    ),
    check('ranking_reward_amount_check', sql`${table.amount} >= 0`),
    check('ranking_reward_attempts_check', sql`${table.attempts} >= 0`),
  ],
)

export const rankingEntryRelations = relations(rankingEntry, ({ one }) => ({
  user: one(user, {
    fields: [rankingEntry.userId],
    references: [user.id],
  }),
}))

export const rankingRewardRelations = relations(rankingReward, ({ one }) => ({
  currency: one(currency, {
    fields: [rankingReward.currency],
    references: [currency.code],
  }),
  user: one(user, {
    fields: [rankingReward.userId],
    references: [user.id],
  }),
}))
