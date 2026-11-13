import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { user } from './auth'
import { currency } from './wallet'

export const userExclusion = pgTable(
  'user_exclusion',
  {
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at'),
    id: text('id').primaryKey(),
    startsAt: timestamp('starts_at').defaultNow().notNull(),
    type: text('type').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    check(
      'user_exclusion_type_check',
      sql`${table.type} in ('self_exclusion', 'cooling_off')`,
    ),
    index('user_exclusion_user_active_idx').on(table.userId, table.active),
    uniqueIndex('user_exclusion_one_active_per_type_idx')
      .on(table.userId, table.type)
      .where(sql`${table.active} = true`),
  ],
)

export const userRiskLimit = pgTable(
  'user_risk_limit',
  {
    currency: text('currency')
      .notNull()
      .references(() => currency.code),
    dailyBetCap: bigint('daily_bet_cap', { mode: 'bigint' }),
    dailyLossCap: bigint('daily_loss_cap', { mode: 'bigint' }),
    singleBetCap: bigint('single_bet_cap', { mode: 'bigint' }),
    source: text('source').default('user').notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    weeklyBetCap: bigint('weekly_bet_cap', { mode: 'bigint' }),
    weeklyLossCap: bigint('weekly_loss_cap', { mode: 'bigint' }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.currency, table.source] }),
    check(
      'user_risk_limit_source_check',
      sql`${table.source} in ('user', 'admin')`,
    ),
    check(
      'user_risk_limit_single_bet_check',
      sql`${table.singleBetCap} is null or ${table.singleBetCap} > 0`,
    ),
    check(
      'user_risk_limit_daily_bet_check',
      sql`${table.dailyBetCap} is null or ${table.dailyBetCap} > 0`,
    ),
    check(
      'user_risk_limit_weekly_bet_check',
      sql`${table.weeklyBetCap} is null or ${table.weeklyBetCap} > 0`,
    ),
    check(
      'user_risk_limit_daily_loss_check',
      sql`${table.dailyLossCap} is null or ${table.dailyLossCap} > 0`,
    ),
    check(
      'user_risk_limit_weekly_loss_check',
      sql`${table.weeklyLossCap} is null or ${table.weeklyLossCap} > 0`,
    ),
  ],
)

export const userBetCounter = pgTable(
  'user_bet_counter',
  {
    bucket: text('bucket').notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currency.code),
    payout: bigint('payout', { mode: 'bigint' }).notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    wagered: bigint('wagered', { mode: 'bigint' }).notNull(),
    window: text('window').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.currency, table.window, table.bucket],
    }),
    check(
      'user_bet_counter_window_check',
      sql`${table.window} in ('day', 'week')`,
    ),
    check('user_bet_counter_wagered_check', sql`${table.wagered} >= 0`),
    check('user_bet_counter_payout_check', sql`${table.payout} >= 0`),
  ],
)

export const riskEvent = pgTable(
  'risk_event',
  {
    createdAt: timestamp('created_at').defaultNow().notNull(),
    dedupeKey: text('dedupe_key'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    detector: text('detector').notNull(),
    id: text('id').primaryKey(),
    referenceId: text('reference_id'),
    referenceType: text('reference_type'),
    severity: text('severity').default('warning').notNull(),
    status: text('status').default('open').notNull(),
    type: text('type').notNull(),
    userId: text('user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    check('risk_event_type_check', sql`${table.type} in ('bet_rejected')`),
    check(
      'risk_event_severity_check',
      sql`${table.severity} in ('info', 'warning', 'critical')`,
    ),
    check(
      'risk_event_status_check',
      sql`${table.status} in ('open', 'reviewing', 'dismissed', 'actioned')`,
    ),
    index('risk_event_user_created_idx').on(table.userId, table.createdAt),
    index('risk_event_status_created_idx').on(table.status, table.createdAt),
    uniqueIndex('risk_event_dedupe_key_idx')
      .on(table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null`),
  ],
)

export const userExclusionRelations = relations(userExclusion, ({ one }) => ({
  user: one(user, {
    fields: [userExclusion.userId],
    references: [user.id],
  }),
}))

export const userRiskLimitRelations = relations(userRiskLimit, ({ one }) => ({
  currency: one(currency, {
    fields: [userRiskLimit.currency],
    references: [currency.code],
  }),
  user: one(user, {
    fields: [userRiskLimit.userId],
    references: [user.id],
  }),
}))

export const userBetCounterRelations = relations(userBetCounter, ({ one }) => ({
  currency: one(currency, {
    fields: [userBetCounter.currency],
    references: [currency.code],
  }),
  user: one(user, {
    fields: [userBetCounter.userId],
    references: [user.id],
  }),
}))

export const riskEventRelations = relations(riskEvent, ({ one }) => ({
  user: one(user, {
    fields: [riskEvent.userId],
    references: [user.id],
  }),
}))
