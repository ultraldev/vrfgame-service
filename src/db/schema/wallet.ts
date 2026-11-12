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

export const currency = pgTable(
  'currency',
  {
    archivedAt: timestamp('archived_at'),
    bettingEnabled: boolean('betting_enabled').default(false).notNull(),
    code: text('code').primaryKey(),
    decimals: integer('decimals').notNull(),
    depositEnabled: boolean('deposit_enabled').default(false).notNull(),
    enabled: boolean('enabled').default(false).notNull(),
    locale: text('locale').notNull(),
    symbol: text('symbol').notNull(),
    type: text('type').notNull(),
    walletEnabled: boolean('wallet_enabled').default(true).notNull(),
    withdrawalEnabled: boolean('withdrawal_enabled').default(false).notNull(),
  },
  (table) => [index('currency_enabled_idx').on(table.enabled)],
)

export const wallet = pgTable(
  'wallet',
  {
    balance: bigint('balance', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currency.code),
    id: text('id').primaryKey(),
    lockedBalance: bigint('locked_balance', { mode: 'bigint' }).notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    version: integer('version').default(0).notNull(),
  },
  (table) => [
    uniqueIndex('wallet_user_currency_idx').on(table.userId, table.currency),
    index('wallet_currency_idx').on(table.currency),
    check(
      'wallet_locked_balance_nonnegative_check',
      sql`${table.lockedBalance} >= 0`,
    ),
    check('wallet_version_nonnegative_check', sql`${table.version} >= 0`),
  ],
)

export const walletTransaction = pgTable(
  'wallet_transaction',
  {
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    balanceAfter: bigint('balance_after', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    id: text('id').primaryKey(),
    idempotencyKey: text('idempotency_key'),
    referenceId: text('reference_id').notNull(),
    referenceType: text('reference_type').notNull(),
    type: text('type').notNull(),
    version: integer('version').default(0).notNull(),
    walletId: text('wallet_id')
      .notNull()
      .references(() => wallet.id, { onDelete: 'cascade' }),
  },
  (table) => [
    check(
      'wallet_transaction_type_check',
      sql`${table.type} in ('debit', 'credit', 'lock', 'unlock', 'settle')`,
    ),
    check(
      'wallet_transaction_amount_nonnegative_check',
      sql`${table.amount} >= 0`,
    ),
    check(
      'wallet_transaction_version_nonnegative_check',
      sql`${table.version} >= 0`,
    ),
    index('wallet_transaction_wallet_created_id_idx').on(
      table.walletId,
      table.createdAt,
      table.id,
    ),
    uniqueIndex('wallet_transaction_idempotency_idx').on(
      table.walletId,
      table.idempotencyKey,
    ),
    index('wallet_transaction_ref_created_idx').on(
      table.referenceType,
      table.createdAt,
    ),
  ],
)

export const walletRelations = relations(wallet, ({ many, one }) => ({
  currency: one(currency, {
    fields: [wallet.currency],
    references: [currency.code],
  }),
  transactions: many(walletTransaction),
  user: one(user, {
    fields: [wallet.userId],
    references: [user.id],
  }),
}))

export const walletTransactionRelations = relations(
  walletTransaction,
  ({ one }) => ({
    wallet: one(wallet, {
      fields: [walletTransaction.walletId],
      references: [wallet.id],
    }),
  }),
)
