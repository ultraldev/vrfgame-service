import { and, eq, inArray, sql } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import { currency } from '@/lib/currency'
import { formatAmount } from '@/lib/money'

import {
  cover,
  games as rankGames,
  gift,
  multiplier,
  ordered,
  outcome,
  rtp,
} from './util'

type Round = typeof schema.raffleRound.$inferSelect

export async function listGames(db: Db) {
  const rows = await db.query.game.findMany({
    where: and(
      eq(schema.game.status, 'active'),
      eq(schema.game.category, 'inhouse'),
    ),
    with: { assets: true },
  })
  if (rows.length === 0) {
    return []
  }

  const favorites = await db
    .select({
      count: sql<number>`count(*)::int`,
      gameId: schema.userFavoriteGame.gameId,
    })
    .from(schema.userFavoriteGame)
    .where(
      inArray(
        schema.userFavoriteGame.gameId,
        rows.map((row) => row.id),
      ),
    )
    .groupBy(schema.userFavoriteGame.gameId)
  const favoriteCounts = new Map(
    favorites.map((row) => [row.gameId, Number(row.count)]),
  )

  return rankGames(
    rows.map((row) => ({
      id: row.id,
      popularity: favoriteCounts.get(row.id) ?? 0,
      row,
      rtpBps: row.rtp,
      sortOrder: row.sortOrder ?? 0,
      tags: {
        featured: row.isFeatured ?? false,
        hot: row.isHot ?? false,
        new: row.isNew ?? false,
      },
    })),
  ).map(({ row }) => ({
    imageUrl: cover(row.assets),
    isHot: row.isHot ?? false,
    isNew: row.isNew ?? false,
    name: row.name,
    rtp: row.rtp ? row.rtp / 100 : null,
    slug: row.slug,
  }))
}

function publicRound(row: Round, decimals: number) {
  return {
    botShares: row.botShares,
    capacity: row.capacity,
    currency: row.payoutCurrency,
    earlyWindowSec: row.earlyWindowSec,
    endsAt: row.endsAt.toISOString(),
    giftRemaining: Math.max(
      0,
      gift(row.capacity, row.giftCapBps) - row.soldGift,
    ),
    id: row.id,
    myGiftShares: 0,
    myOutcome: outcome({
      myShares: 0,
      status: row.status,
      winnerIsPlatform: row.winnerIsPlatform,
      winnerUserId: row.winnerUserId,
    }),
    myShares: 0,
    payoutAmount: formatAmount(row.payoutAmount, decimals),
    roundNumber: row.roundNumber,
    serverSeed: null,
    serverSeedHash: row.serverSeedHash,
    sharePrice: formatAmount(row.sharePrice, decimals),
    sold: row.sold,
    soldGift: row.soldGift,
    startsAt: row.startsAt.toISOString(),
    status: row.status,
    tauBps: row.tauBps,
    tauEarlyBps: row.tauEarlyBps,
    winProbabilityBps: 0,
    winnerIsPlatform: false,
    winningNumber: null,
  }
}

export async function listRaffle(db: Db) {
  const rows = await db.query.raffleSku.findMany({
    where: eq(schema.raffleSku.status, 'active'),
  })
  if (rows.length === 0) {
    return []
  }

  const ranked = ordered(
    rows.map((sku) => ({
      id: sku.id,
      sku,
      sortOrder: sku.sortOrder,
      tags: {
        hot: sku.tag === 'hot',
        new: sku.tag === 'new',
      },
    })),
  )
  const codes = [...new Set(ranked.map(({ sku }) => sku.payoutCurrency))]
  const currencies = await Promise.all(codes.map((code) => currency(db, code)))
  const decimals = new Map(currencies.map((row) => [row.code, row.decimals]))
  const rounds = await db.query.raffleRound.findMany({
    where: and(
      inArray(
        schema.raffleRound.skuId,
        ranked.map(({ sku }) => sku.id),
      ),
      eq(schema.raffleRound.status, 'open'),
    ),
  })
  const openRounds = new Map(rounds.map((row) => [row.skuId, row]))
  const items = []

  for (const { sku } of ranked) {
    const scale = decimals.get(sku.payoutCurrency) ?? 0
    const open = openRounds.get(sku.id)
    items.push({
      category: sku.category,
      currency: sku.payoutCurrency,
      description: sku.description,
      imageUrl: sku.imageUrl,
      lastRound: null,
      name: sku.name,
      payoutAmount: formatAmount(sku.payoutAmount, scale),
      round: open ? publicRound(open, scale) : null,
      skuId: sku.id,
      slug: sku.slug,
      sortOrder: sku.sortOrder,
      tag: sku.tag,
    })
  }

  return items
}

export async function listCrates(
  db: Db,
  requested?: string,
  knownDecimals?: number,
) {
  const active = await currency(db, requested)
  const scale = knownDecimals ?? active.decimals
  const rows = await db
    .select()
    .from(schema.crate)
    .where(eq(schema.crate.status, 'published'))
  const ids = rows.map((row) => row.id)
  const prices =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(schema.cratePrice)
          .where(inArray(schema.cratePrice.crateId, ids))
  const revisions =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(schema.crateRevision)
          .where(inArray(schema.crateRevision.crateId, ids))
  const revisionById = new Map(revisions.map((row) => [row.id, row]))
  const candidates = []

  for (const row of rows) {
    const rowPrices = prices.filter((item) => item.crateId === row.id)
    const price = rowPrices.find((item) => item.currency === active.code)
    if (!price) {
      continue
    }
    const revision = row.currentRevisionId
      ? revisionById.get(row.currentRevisionId)
      : undefined
    const items = revision?.items ?? []
    const basePrice =
      (
        rowPrices.find((item) => item.currency === row.baseCurrency) ??
        rowPrices[0]
      )?.price ?? null
    candidates.push({
      basePrice,
      id: row.id,
      items,
      price: price.price,
      row,
      rtpBps: revision?.rtpBps ?? (basePrice ? rtp(items, basePrice) : 0),
      sortOrder: row.sortOrder,
      tags: {
        hot: row.tag === 'hot',
        new: row.tag === 'new',
      },
    })
  }

  return ordered(candidates).map((item) => {
    let maxCenti = 0
    for (const drop of item.items) {
      const centi =
        item.basePrice && item.basePrice > 0n
          ? Number((BigInt(drop.payout) * 100n) / item.basePrice)
          : 0
      maxCenti = Math.max(maxCenti, centi)
    }

    return {
      coverUrl: item.row.coverUrl,
      currency: active.code,
      decimals: scale,
      id: item.row.id,
      maxMultiplier: multiplier(maxCenti),
      name: item.row.name,
      price: formatAmount(item.price, scale),
      rtpBps: item.rtpBps,
      slug: item.row.slug,
      sortOrder: item.row.sortOrder,
      tag: item.row.tag,
      version: item.row.version,
    }
  })
}

export async function lobby(db: Db, requested?: string) {
  const active = await currency(db, requested)
  const [gameRows, raffleRows, crateRows] = await Promise.all([
    listGames(db),
    listRaffle(db),
    listCrates(db, active.code, active.decimals),
  ])

  return {
    crates: crateRows,
    games: gameRows,
    raffle: raffleRows,
  }
}
