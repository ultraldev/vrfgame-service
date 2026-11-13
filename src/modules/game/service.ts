import { httpErrors } from '@fastify/sensible'
import { and, asc, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'

import type { GameListFilters, RecentGameFilters } from './schema'
import {
  decodeGameCursor,
  encodeGameCursor,
  gameCoverUrl,
  gamesAfterCursor,
} from './util'
import type { GameSort } from './util'

type GameRow = typeof schema.game.$inferSelect
type GameAssetRow = typeof schema.gameAsset.$inferSelect
type GameProviderRow = typeof schema.gameProvider.$inferSelect
type DetailedGame = GameRow & {
  assets: GameAssetRow[]
  provider: GameProviderRow | null
}

function gameOrder(sort: GameSort) {
  switch (sort) {
    case 'newest': {
      return [desc(schema.game.createdAt), desc(schema.game.slug)]
    }
    case 'name_asc': {
      return [asc(schema.game.slug)]
    }
    case 'name_desc': {
      return [desc(schema.game.slug)]
    }
    default: {
      return [asc(schema.game.sortOrder), asc(schema.game.slug)]
    }
  }
}

function gameSummary(game: DetailedGame, isFavorite: boolean) {
  return {
    category: game.category,
    imageUrl: gameCoverUrl(game.assets),
    isFavorite,
    isFeatured: game.isFeatured ?? false,
    isHot: game.isHot ?? false,
    isNew: game.isNew ?? false,
    launchType: game.launchType,
    name: game.name,
    provider: game.provider
      ? { code: game.provider.code, name: game.provider.name }
      : null,
    slug: game.slug,
  }
}

function gameDetail(game: DetailedGame, isFavorite: boolean) {
  return {
    ...gameSummary(game, isFavorite),
    rtpBps: game.rtp,
    subcategory: game.subcategory,
    tags: game.tags ?? [],
    volatility: game.volatility,
  }
}

async function favoriteGameIds(
  db: Db,
  userId: string | undefined,
  gameIds: string[],
) {
  if (!userId || gameIds.length === 0) {
    return new Set<string>()
  }

  const rows = await db
    .select({ gameId: schema.userFavoriteGame.gameId })
    .from(schema.userFavoriteGame)
    .where(
      and(
        eq(schema.userFavoriteGame.userId, userId),
        inArray(schema.userFavoriteGame.gameId, gameIds),
      ),
    )

  return new Set(rows.map((row) => row.gameId))
}

function activeGames(db: Db, gameIds: string[]) {
  if (gameIds.length === 0) {
    return []
  }

  return db.query.game.findMany({
    where: and(
      inArray(schema.game.id, gameIds),
      eq(schema.game.status, 'active'),
    ),
    with: { assets: true, provider: true },
  })
}

async function requireGame(db: Db, slug: string) {
  const game = await db.query.game.findFirst({
    where: and(eq(schema.game.slug, slug), eq(schema.game.status, 'active')),
    with: { assets: true, provider: true },
  })

  if (!game) {
    throw httpErrors.notFound('Game not found')
  }

  return game
}

export async function listGames(
  db: Db,
  query: GameListFilters,
  userId?: string,
) {
  const filters: SQL[] = [eq(schema.game.status, 'active')]

  if (query.category) {
    filters.push(eq(schema.game.category, query.category))
  }

  if (query.provider === 'internal') {
    filters.push(isNull(schema.game.providerId))
  } else if (query.provider) {
    const provider = await db.query.gameProvider.findFirst({
      where: eq(schema.gameProvider.code, query.provider),
    })
    if (!provider) {
      return { items: [], nextCursor: null }
    }
    filters.push(eq(schema.game.providerId, provider.id))
  }

  if (query.isNew) {
    filters.push(eq(schema.game.isNew, true))
  }
  if (query.isHot) {
    filters.push(eq(schema.game.isHot, true))
  }
  if (query.isFeatured) {
    filters.push(eq(schema.game.isFeatured, true))
  }

  if (query.search) {
    const pattern = `%${query.search}%`
    const search = or(
      ilike(schema.game.name, pattern),
      ilike(schema.game.slug, pattern),
    )
    if (search) {
      filters.push(search)
    }
  }

  if (query.cursor) {
    filters.push(
      gamesAfterCursor(query.sort, decodeGameCursor(query.cursor, query.sort)),
    )
  }

  const rows = await db.query.game.findMany({
    limit: query.limit + 1,
    orderBy: gameOrder(query.sort),
    where: and(...filters),
    with: { assets: true, provider: true },
  })
  const page = rows.slice(0, query.limit)
  const favorites = await favoriteGameIds(
    db,
    userId,
    page.map((game) => game.id),
  )
  const last = page.at(-1)

  return {
    items: page.map((game) => gameSummary(game, favorites.has(game.id))),
    nextCursor:
      rows.length > query.limit && last
        ? encodeGameCursor(last, query.sort)
        : null,
  }
}

export async function getGame(db: Db, slug: string, userId?: string) {
  const game = await requireGame(db, slug)
  const favorite = userId
    ? await db.query.userFavoriteGame.findFirst({
        where: and(
          eq(schema.userFavoriteGame.userId, userId),
          eq(schema.userFavoriteGame.gameId, game.id),
        ),
      })
    : undefined

  return gameDetail(game, Boolean(favorite))
}

export async function listFavoriteGames(db: Db, userId: string) {
  const favorites = await db.query.userFavoriteGame.findMany({
    orderBy: [desc(schema.userFavoriteGame.createdAt)],
    where: eq(schema.userFavoriteGame.userId, userId),
  })
  const games = await activeGames(
    db,
    favorites.map((favorite) => favorite.gameId),
  )
  const gameById = new Map(games.map((game) => [game.id, game]))

  return {
    items: favorites.flatMap((favorite) => {
      const game = gameById.get(favorite.gameId)
      if (!game) {
        return []
      }
      return [
        {
          ...gameSummary(game, true),
          favoritedAt: favorite.createdAt.toISOString(),
        },
      ]
    }),
  }
}

export async function listRecentGames(
  db: Db,
  userId: string,
  query: RecentGameFilters,
) {
  const recents = await db.query.userRecentGame.findMany({
    orderBy: [desc(schema.userRecentGame.playedAt)],
    where: eq(schema.userRecentGame.userId, userId),
  })
  const games = await activeGames(
    db,
    recents.map((recent) => recent.gameId),
  )
  const gameById = new Map(games.map((game) => [game.id, game]))
  const favorites = await favoriteGameIds(
    db,
    userId,
    games.map((game) => game.id),
  )

  return {
    items: recents
      .flatMap((recent) => {
        const game = gameById.get(recent.gameId)
        if (!game) {
          return []
        }
        return [
          {
            ...gameSummary(game, favorites.has(game.id)),
            playedAt: recent.playedAt.toISOString(),
          },
        ]
      })
      .slice(0, query.limit),
  }
}

export async function addFavoriteGame(db: Db, userId: string, slug: string) {
  const game = await requireGame(db, slug)
  await db
    .insert(schema.userFavoriteGame)
    .values({ gameId: game.id, userId })
    .onConflictDoNothing()

  return { isFavorite: true }
}

export async function removeFavoriteGame(db: Db, userId: string, slug: string) {
  const game = await requireGame(db, slug)
  await db
    .delete(schema.userFavoriteGame)
    .where(
      and(
        eq(schema.userFavoriteGame.userId, userId),
        eq(schema.userFavoriteGame.gameId, game.id),
      ),
    )

  return { isFavorite: false }
}

export async function recordGamePlay(db: Db, userId: string, slug: string) {
  const game = await requireGame(db, slug)
  const playedAt = new Date()
  await db
    .insert(schema.userRecentGame)
    .values({ gameId: game.id, playedAt, userId })
    .onConflictDoUpdate({
      set: { playedAt },
      target: [schema.userRecentGame.userId, schema.userRecentGame.gameId],
    })

  return { playedAt: playedAt.toISOString() }
}
