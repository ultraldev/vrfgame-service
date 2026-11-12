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

import { currency } from './wallet'

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

export const crateRelations = relations(crate, ({ one }) => ({
  currentRevision: one(crateRevision, {
    fields: [crate.currentRevisionId],
    references: [crateRevision.id],
  }),
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
