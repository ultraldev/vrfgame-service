import * as z from 'zod'

import { GAME_CATEGORIES, GAME_SORTS } from './util'

const BooleanQuery = z.preprocess((value) => {
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  return value
}, z.boolean().optional())
const GameSort = z.enum(GAME_SORTS)

export const GameListQuery = z.object({
  category: z.enum(GAME_CATEGORIES).optional(),
  cursor: z.string().trim().min(1).max(512).optional(),
  isFeatured: BooleanQuery,
  isHot: BooleanQuery,
  isNew: BooleanQuery,
  limit: z.coerce.number().int().min(1).max(100).default(24),
  provider: z.string().trim().min(1).max(64).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  sort: GameSort.default('default'),
})

export const RecentGameQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export type GameListFilters = z.infer<typeof GameListQuery>
export type RecentGameFilters = z.infer<typeof RecentGameQuery>

export const GameParams = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
})

const Provider = z.object({
  code: z.string(),
  name: z.string(),
})

const GameBase = z.object({
  category: z.string(),
  imageUrl: z.string().nullable(),
  isFavorite: z.boolean(),
  isFeatured: z.boolean(),
  isHot: z.boolean(),
  isNew: z.boolean(),
  launchType: z.string(),
  name: z.string(),
  provider: Provider.nullable(),
  slug: z.string(),
})

export const GameSummary = GameBase

export const GameDetail = GameBase.extend({
  rtpBps: z.number().int().nullable(),
  subcategory: z.string().nullable(),
  tags: z.array(z.string()),
  volatility: z.string().nullable(),
})

export const GameList = z.object({
  items: z.array(GameSummary),
  nextCursor: z.string().nullable(),
})

export const FavoriteGame = GameSummary.extend({
  favoritedAt: z.iso.datetime(),
})

export const FavoriteGameList = z.object({
  items: z.array(FavoriteGame),
})

export const RecentGame = GameSummary.extend({
  playedAt: z.iso.datetime(),
})

export const RecentGameList = z.object({
  items: z.array(RecentGame),
})

export const FavoriteStatus = z.object({
  isFavorite: z.boolean(),
})

export const GamePlayReceipt = z.object({
  playedAt: z.iso.datetime(),
})

z.globalRegistry.add(Provider, { id: 'GameProvider' })
z.globalRegistry.add(GameSummary, { id: 'GameSummary' })
z.globalRegistry.add(GameDetail, { id: 'GameDetail' })
z.globalRegistry.add(GameList, { id: 'GameList' })
z.globalRegistry.add(FavoriteGame, { id: 'FavoriteGame' })
z.globalRegistry.add(FavoriteGameList, { id: 'FavoriteGameList' })
z.globalRegistry.add(RecentGame, { id: 'RecentGame' })
z.globalRegistry.add(RecentGameList, { id: 'RecentGameList' })
z.globalRegistry.add(FavoriteStatus, { id: 'FavoriteGameStatus' })
z.globalRegistry.add(GamePlayReceipt, { id: 'GamePlayReceipt' })
