import { relations, sql } from 'drizzle-orm'
import {
  bigint,
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
import { currency, wallet } from './wallet'

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

export const userRecentGame = pgTable(
  'user_recent_game',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => game.id, { onDelete: 'cascade' }),
    playedAt: timestamp('played_at').defaultNow().notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.gameId] }),
    index('user_recent_game_user_played_idx').on(table.userId, table.playedAt),
    index('user_recent_game_game_id_idx').on(table.gameId),
  ],
)

export const gameRiskLimit = pgTable(
  'game_risk_limit',
  {
    currency: text('currency')
      .notNull()
      .references(() => currency.code),
    enabled: boolean('enabled').default(true).notNull(),
    gameId: text('game_id')
      .notNull()
      .references(() => game.id),
    maxBet: bigint('max_bet', { mode: 'bigint' }).notNull(),
    maxPayout: bigint('max_payout', { mode: 'bigint' }),
    minBet: bigint('min_bet', { mode: 'bigint' }).notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.currency] }),
    index('game_risk_limit_currency_idx').on(table.currency),
    check('game_risk_limit_min_check', sql`${table.minBet} > 0`),
    check(
      'game_risk_limit_range_check',
      sql`${table.maxBet} >= ${table.minBet}`,
    ),
    check(
      'game_risk_limit_payout_check',
      sql`${table.maxPayout} is null or ${table.maxPayout} > 0`,
    ),
  ],
)

export interface DiceBetResult {
  direction: 'over' | 'under'
  outcomeMatched: boolean
  roll: number
  target: number
  won: boolean
}

export type GameBetResult = DiceBetResult | Record<string, unknown>

export const fairnessSeed = pgTable(
  'game_fairness_seed',
  {
    createdAt: timestamp('created_at').defaultNow().notNull(),
    gameId: text('game_id')
      .notNull()
      .references(() => game.id, { onDelete: 'cascade' }),
    id: text('id').primaryKey(),
    nonce: integer('nonce').default(0).notNull(),
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
      'game_fairness_seed_status_check',
      sql`${table.status} in ('active', 'revealed')`,
    ),
    index('game_fairness_seed_user_status_idx').on(table.userId, table.status),
    index('game_fairness_seed_game_id_idx').on(table.gameId),
    index('game_fairness_seed_user_game_status_idx').on(
      table.userId,
      table.gameId,
      table.status,
    ),
    uniqueIndex('game_fairness_seed_user_game_active_idx')
      .on(table.userId, table.gameId)
      .where(sql`${table.status} = 'active'`),
  ],
)

export const gameBet = pgTable(
  'game_bet',
  {
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    clientSeed: text('client_seed').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currency.code),
    gameId: text('game_id')
      .notNull()
      .references(() => game.id),
    id: text('id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    nonce: integer('nonce').notNull(),
    payout: bigint('payout', { mode: 'bigint' }).notNull(),
    requestHash: text('request_hash').notNull(),
    result: jsonb('result').$type<GameBetResult>().notNull(),
    seedId: text('seed_id').references(() => fairnessSeed.id),
    status: text('status').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    walletId: text('wallet_id')
      .notNull()
      .references(() => wallet.id, { onDelete: 'cascade' }),
  },
  (table) => [
    check(
      'game_bet_status_check',
      sql`${table.status} in ('active', 'settled', 'cashed_out', 'lost', 'cancelled')`,
    ),
    check('game_bet_amount_check', sql`${table.amount} > 0`),
    check('game_bet_payout_check', sql`${table.payout} >= 0`),
    uniqueIndex('game_bet_user_idempotency_idx').on(
      table.userId,
      table.idempotencyKey,
    ),
    uniqueIndex('game_bet_user_game_active_idx')
      .on(table.userId, table.gameId)
      .where(sql`${table.status} = 'active'`),
    index('game_bet_user_game_created_id_idx').on(
      table.userId,
      table.gameId,
      table.createdAt,
      table.id,
    ),
    index('game_bet_game_created_id_idx').on(
      table.gameId,
      table.createdAt,
      table.id,
    ),
    index('game_bet_seed_id_idx').on(table.seedId),
    index('game_bet_wallet_id_idx').on(table.walletId),
    index('game_bet_currency_idx').on(table.currency),
  ],
)

export const crashRound = pgTable(
  'crash_round',
  {
    clientSeed: text('client_seed').notNull(),
    crashPointCenti: integer('crash_point_centi'),
    crashedAt: timestamp('crashed_at'),
    houseEdgeBps: integer('house_edge_bps').notNull(),
    id: text('id').primaryKey(),
    nonce: integer('nonce').notNull(),
    phase: text('phase').notNull(),
    roundNumber: integer('round_number').notNull(),
    runningAt: timestamp('running_at'),
    serverSeed: text('server_seed').notNull(),
    serverSeedHash: text('server_seed_hash').notNull(),
    startedAt: timestamp('started_at'),
  },
  (table) => [
    check(
      'crash_round_phase_check',
      sql`${table.phase} in ('pending', 'betting', 'running', 'crashed')`,
    ),
    uniqueIndex('crash_round_number_idx').on(table.roundNumber),
    index('crash_round_phase_started_idx').on(table.phase, table.startedAt),
  ],
)

export const gameRelations = relations(game, ({ many, one }) => ({
  assets: many(gameAsset),
  bets: many(gameBet),
  favorites: many(userFavoriteGame),
  provider: one(gameProvider, {
    fields: [game.providerId],
    references: [gameProvider.id],
  }),
  recents: many(userRecentGame),
  riskLimits: many(gameRiskLimit),
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

export const userRecentGameRelations = relations(userRecentGame, ({ one }) => ({
  game: one(game, {
    fields: [userRecentGame.gameId],
    references: [game.id],
  }),
  user: one(user, {
    fields: [userRecentGame.userId],
    references: [user.id],
  }),
}))

export const gameRiskLimitRelations = relations(gameRiskLimit, ({ one }) => ({
  currency: one(currency, {
    fields: [gameRiskLimit.currency],
    references: [currency.code],
  }),
  game: one(game, {
    fields: [gameRiskLimit.gameId],
    references: [game.id],
  }),
}))

export const fairnessSeedRelations = relations(
  fairnessSeed,
  ({ many, one }) => ({
    bets: many(gameBet),
    game: one(game, {
      fields: [fairnessSeed.gameId],
      references: [game.id],
    }),
    user: one(user, {
      fields: [fairnessSeed.userId],
      references: [user.id],
    }),
  }),
)

export const gameBetRelations = relations(gameBet, ({ one }) => ({
  currency: one(currency, {
    fields: [gameBet.currency],
    references: [currency.code],
  }),
  game: one(game, {
    fields: [gameBet.gameId],
    references: [game.id],
  }),
  seed: one(fairnessSeed, {
    fields: [gameBet.seedId],
    references: [fairnessSeed.id],
  }),
  user: one(user, {
    fields: [gameBet.userId],
    references: [user.id],
  }),
  wallet: one(wallet, {
    fields: [gameBet.walletId],
    references: [wallet.id],
  }),
}))
