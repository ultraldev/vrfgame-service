import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { user } from './auth'
import { currency, wallet } from './wallet'

export interface CrateRevisionItem {
  id: string
  imageUrl: string | null
  name: string
  payout: string
  rarity: string
  slug: string
  sortOrder: number
  weight: number
}

export interface CaseOpenResult {
  crateId: string
  crateSlug: string
  crateVersion: number
  itemId: string
  itemIndex: number
  itemPayout: string
  payoutCapped: boolean
  revisionId: string
}

export const crate = pgTable(
  'crate',
  {
    baseCurrency: text('base_currency').references(() => currency.code),
    coverUrl: text('cover_url'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    currentRevisionId: text('current_revision_id'),
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    publishedAt: timestamp('published_at'),
    rtpBps: integer('rtp_bps'),
    slug: text('slug').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    status: text('status').notNull().default('draft'),
    tag: text('tag'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('crate_slug_idx').on(table.slug),
    index('crate_status_sort_idx').on(table.status, table.sortOrder),
    check(
      'crate_status_check',
      sql`${table.status} in ('draft', 'published', 'archived')`,
    ),
    check(
      'crate_tag_check',
      sql`${table.tag} is null or ${table.tag} in ('new', 'hot')`,
    ),
  ],
)

export const cratePrice = pgTable(
  'crate_price',
  {
    crateId: text('crate_id')
      .notNull()
      .references(() => crate.id, { onDelete: 'cascade' }),
    currency: text('currency')
      .notNull()
      .references(() => currency.code),
    price: bigint('price', { mode: 'bigint' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.crateId, table.currency] }),
    check('crate_price_check', sql`${table.price} > 0`),
    index('crate_price_currency_idx').on(table.currency),
  ],
)

export const crateRevision = pgTable(
  'crate_revision',
  {
    crateId: text('crate_id')
      .notNull()
      .references(() => crate.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    id: text('id').primaryKey(),
    items: jsonb('items').$type<CrateRevisionItem[]>().notNull(),
    rtpBps: integer('rtp_bps').notNull(),
    version: integer('version').notNull(),
  },
  (table) => [
    uniqueIndex('crate_revision_crate_version_idx').on(
      table.crateId,
      table.version,
    ),
  ],
)

export const caseFairnessSeed = pgTable(
  'case_fairness_seed',
  {
    createdAt: timestamp('created_at').defaultNow().notNull(),
    id: text('id').primaryKey(),
    nonce: integer('nonce').notNull().default(0),
    revealedAt: timestamp('revealed_at'),
    serverSeed: text('server_seed').notNull(),
    serverSeedHash: text('server_seed_hash').notNull(),
    status: text('status').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    check(
      'case_fairness_seed_status_check',
      sql`${table.status} in ('active', 'revealed')`,
    ),
    index('case_fairness_seed_user_status_idx').on(table.userId, table.status),
    uniqueIndex('case_fairness_seed_user_active_idx')
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),
  ],
)

export const caseOpen = pgTable(
  'case_open',
  {
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    clientSeed: text('client_seed').notNull(),
    crateId: text('crate_id')
      .notNull()
      .references(() => crate.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currency.code),
    id: text('id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    nonce: integer('nonce').notNull(),
    payout: bigint('payout', { mode: 'bigint' }).notNull(),
    requestHash: text('request_hash').notNull(),
    result: jsonb('result').$type<CaseOpenResult>().notNull(),
    revisionId: text('revision_id')
      .notNull()
      .references(() => crateRevision.id),
    seedId: text('seed_id')
      .notNull()
      .references(() => caseFairnessSeed.id),
    status: text('status').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    walletId: text('wallet_id')
      .notNull()
      .references(() => wallet.id, { onDelete: 'cascade' }),
  },
  (table) => [
    check('case_open_status_check', sql`${table.status} = 'settled'`),
    check('case_open_amount_check', sql`${table.amount} > 0`),
    check('case_open_payout_check', sql`${table.payout} >= 0`),
    uniqueIndex('case_open_user_idempotency_idx').on(
      table.userId,
      table.idempotencyKey,
    ),
    index('case_open_user_created_id_idx').on(
      table.userId,
      table.createdAt,
      table.id,
    ),
    index('case_open_crate_created_idx').on(table.crateId, table.createdAt),
    index('case_open_wallet_id_idx').on(table.walletId),
    index('case_open_currency_idx').on(table.currency),
    index('case_open_revision_id_idx').on(table.revisionId),
    index('case_open_seed_id_idx').on(table.seedId),
  ],
)

export const crateRelations = relations(crate, ({ many, one }) => ({
  currentRevision: one(crateRevision, {
    fields: [crate.currentRevisionId],
    references: [crateRevision.id],
  }),
  opens: many(caseOpen),
}))

export const cratePriceRelations = relations(cratePrice, ({ one }) => ({
  crate: one(crate, {
    fields: [cratePrice.crateId],
    references: [crate.id],
    relationName: 'crate_prices',
  }),
}))

export const crateRevisionRelations = relations(crateRevision, ({ one }) => ({
  crate: one(crate, {
    fields: [crateRevision.crateId],
    references: [crate.id],
    relationName: 'crate_revisions',
  }),
}))

export const caseFairnessSeedRelations = relations(
  caseFairnessSeed,
  ({ many, one }) => ({
    opens: many(caseOpen),
    user: one(user, {
      fields: [caseFairnessSeed.userId],
      references: [user.id],
    }),
  }),
)

export const caseOpenRelations = relations(caseOpen, ({ one }) => ({
  crate: one(crate, {
    fields: [caseOpen.crateId],
    references: [crate.id],
  }),
  revision: one(crateRevision, {
    fields: [caseOpen.revisionId],
    references: [crateRevision.id],
  }),
  seed: one(caseFairnessSeed, {
    fields: [caseOpen.seedId],
    references: [caseFairnessSeed.id],
  }),
  user: one(user, {
    fields: [caseOpen.userId],
    references: [user.id],
  }),
  wallet: one(wallet, {
    fields: [caseOpen.walletId],
    references: [wallet.id],
  }),
}))
