import { relations, sql } from 'drizzle-orm'
import {
  boolean,
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

export const gameProvider = pgTable(
  'game_provider',
  {
    code: text('code').notNull(),
    config: jsonb('config'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    status: text('status').default('active').notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('game_provider_code_idx').on(table.code)],
)

export const game = pgTable(
  'game',
  {
    category: text('category').notNull(),
    config: jsonb('config'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    id: text('id').primaryKey(),
    isFeatured: boolean('is_featured').default(false),
    isHot: boolean('is_hot').default(false),
    isNew: boolean('is_new').default(false),
    launchType: text('launch_type').notNull(),
    name: text('name').notNull(),
    providerGameId: text('provider_game_id'),
    providerId: text('provider_id').references(() => gameProvider.id),
    rtp: integer('rtp'),
    slug: text('slug').notNull(),
    sortOrder: integer('sort_order').default(0),
    status: text('status').default('active').notNull(),
    subcategory: text('subcategory'),
    tags: jsonb('tags').$type<string[]>(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    volatility: text('volatility'),
  },
  (table) => [
    uniqueIndex('game_slug_idx').on(table.slug),
    check(
      'game_launch_type_check',
      sql`${table.launchType} in ('internal', 'iframe', 'redirect', 'api')`,
    ),
    check(
      'game_category_check',
      sql`${table.category} in ('slots', 'live_casino', 'table', 'inhouse', 'fishing', 'arcade', 'lottery')`,
    ),
    check(
      'game_status_check',
      sql`${table.status} in ('active', 'inactive', 'maintenance')`,
    ),
    index('game_category_status_idx').on(table.category, table.status),
    index('game_provider_id_idx').on(table.providerId),
  ],
)

export const gameAsset = pgTable(
  'game_asset',
  {
    createdAt: timestamp('created_at').defaultNow().notNull(),
    gameId: text('game_id')
      .notNull()
      .references(() => game.id, { onDelete: 'cascade' }),
    id: text('id').primaryKey(),
    locale: text('locale').notNull().default('en'),
    sortOrder: integer('sort_order').default(0),
    type: text('type').notNull(),
    url: text('url').notNull(),
  },
  (table) => [
    check(
      'game_asset_type_check',
      sql`${table.type} in ('icon', 'thumbnail', 'banner', 'background')`,
    ),
    uniqueIndex('game_asset_game_type_locale_idx').on(
      table.gameId,
      table.type,
      table.locale,
    ),
  ],
)

export const userFavoriteGame = pgTable(
  'user_favorite_game',
  {
    createdAt: timestamp('created_at').defaultNow().notNull(),
    gameId: text('game_id')
      .notNull()
      .references(() => game.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.gameId] }),
    index('user_favorite_game_game_id_idx').on(table.gameId),
  ],
)

export const gameRelations = relations(game, ({ many, one }) => ({
  assets: many(gameAsset),
  favorites: many(userFavoriteGame),
  provider: one(gameProvider, {
    fields: [game.providerId],
    references: [gameProvider.id],
  }),
}))

export const gameAssetRelations = relations(gameAsset, ({ one }) => ({
  game: one(game, {
    fields: [gameAsset.gameId],
    references: [game.id],
  }),
}))

export const userFavoriteGameRelations = relations(
  userFavoriteGame,
  ({ one }) => ({
    game: one(game, {
      fields: [userFavoriteGame.gameId],
      references: [game.id],
    }),
    user: one(user, {
      fields: [userFavoriteGame.userId],
      references: [user.id],
    }),
  }),
)
