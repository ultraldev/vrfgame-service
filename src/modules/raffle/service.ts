import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { httpErrors } from '@fastify/sensible'
import { and, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import type { AppConfig } from '@/lib/config'
import { currency as findCurrency } from '@/lib/currency'
import { decodeCursor, encodeCursor } from '@/lib/cursor'
import { findErrorCode } from '@/lib/errors'
import { formatAmount, parseAmount } from '@/lib/money'
import { decryptSeed, encryptSeed } from '@/lib/seed-cipher'
import {
  assertIdempotentRequest,
  hashGameBetRequest,
} from '@/modules/game/bets'
import { pfRangedInt } from '@/modules/game/fairness'
import {
  assertBetAmount,
  assertBettingCurrency,
  getDefaultBetLimits,
} from '@/modules/game/limits'
import {
  assertBetAllowedInTransaction,
  recordBetPayoutInTransaction,
  recordBetRejected,
} from '@/modules/risk/service'
import { isRiskRejection } from '@/modules/risk/util'
import {
  creditInTransaction,
  debitInTransaction,
} from '@/modules/wallet/ledger'
import { ensureWallet } from '@/modules/wallet/service'
import { WALLET_REFERENCES } from '@/modules/wallet/util'

import type {
  RaffleEntryResponse,
  RaffleHistoryFilters,
  RaffleHistoryResponse,
  RaffleListFilters,
} from './schema'
import {
  computeRaffleCapacity,
  RAFFLE_SHARE_PRICE,
  raffleOutcome,
  raffleResolution,
  raffleWinProbabilityBps,
} from './util'

type RaffleSkuRow = typeof schema.raffleSku.$inferSelect
type RaffleRoundRow = typeof schema.raffleRound.$inferSelect
type RaffleEntryRow = typeof schema.raffleEntry.$inferSelect
type WalletTransaction = Parameters<Parameters<Db['transaction']>[0]>[0]

interface EnterRaffleInput {
  idempotencyKey: string
  shares: number
}

async function requireRound(db: Db, roundId: string) {
  const round = await db.query.raffleRound.findFirst({
    where: eq(schema.raffleRound.id, roundId),
  })
  if (!round) {
    throw httpErrors.notFound('Raffle round not found')
  }
  return round
}

async function requireSku(db: Db, idOrSlug: string) {
  const sku = await db.query.raffleSku.findFirst({
    where: or(
      eq(schema.raffleSku.id, idOrSlug),
      eq(schema.raffleSku.slug, idOrSlug),
    ),
  })
  if (!sku) {
    throw httpErrors.notFound('Raffle not found')
  }
  return sku
}

async function myShares(db: Db, roundId: string, userId?: string) {
  if (!userId) {
    return { gift: 0, shares: 0 }
  }
  const [row] = await db
    .select({
      shares: sql<number>`coalesce(sum(${schema.raffleEntry.shareCount}), 0)::int`,
    })
    .from(schema.raffleEntry)
    .where(
      and(
        eq(schema.raffleEntry.roundId, roundId),
        eq(schema.raffleEntry.userId, userId),
      ),
    )
  return { gift: 0, shares: Number(row?.shares ?? 0) }
}

function giftCapShares(round: RaffleRoundRow) {
  return Math.floor((round.capacity * round.giftCapBps) / 10_000)
}

async function publicRound(
  db: Db,
  config: AppConfig,
  round: RaffleRoundRow,
  userId?: string,
) {
  const [active, mine] = await Promise.all([
    findCurrency(db, round.payoutCurrency),
    myShares(db, round.id, userId),
  ])
  const revealed = round.status === 'settled' || round.status === 'voided'
  const outcome = raffleOutcome({
    myShares: mine.shares,
    status: round.status,
    userId,
    winnerUserId: revealed ? round.winnerUserId : null,
  })

  return {
    botShares: round.botShares,
    capacity: round.capacity,
    currency: round.payoutCurrency,
    decimals: active.decimals,
    earlyWindowSec: round.earlyWindowSec,
    endsAt: round.endsAt.toISOString(),
    giftRemaining: Math.max(0, giftCapShares(round) - round.soldGift),
    id: round.id,
    myGiftShares: mine.gift,
    myOutcome: outcome,
    myShares: mine.shares,
    payoutAmount: formatAmount(round.payoutAmount, active.decimals),
    roundNumber: round.roundNumber,
    serverSeed:
      revealed && round.serverSeed
        ? decryptSeed(round.serverSeed, config)
        : null,
    serverSeedHash: round.serverSeedHash,
    sharePrice: formatAmount(round.sharePrice, active.decimals),
    sold: round.sold,
    soldGift: round.soldGift,
    startsAt: round.startsAt.toISOString(),
    status: round.status,
    tauBps: round.tauBps,
    tauEarlyBps: round.tauEarlyBps,
    winProbabilityBps: raffleWinProbabilityBps(mine.shares, round.capacity),
    winnerIsPlatform: revealed ? round.winnerIsPlatform : false,
    winningNumber: revealed ? round.winningNumber : null,
  }
}

async function raffleItem(
  db: Db,
  config: AppConfig,
  sku: RaffleSkuRow,
  round: RaffleRoundRow | null,
  lastRound: RaffleRoundRow | null,
  userId?: string,
) {
  const active = await findCurrency(db, sku.payoutCurrency)
  return {
    category: sku.category,
    currency: sku.payoutCurrency,
    decimals: active.decimals,
    description: sku.description,
    imageUrl: sku.imageUrl,
    lastRound: lastRound
      ? await publicRound(db, config, lastRound, userId)
      : null,
    name: sku.name,
    payoutAmount: formatAmount(sku.payoutAmount, active.decimals),
    round: round ? await publicRound(db, config, round, userId) : null,
    sharePrice: formatAmount(
      parseAmount(RAFFLE_SHARE_PRICE, active.decimals),
      active.decimals,
    ),
    skuId: sku.id,
    slug: sku.slug,
    sortOrder: sku.sortOrder,
    tag: sku.tag,
  }
}

export async function listRaffles(
  db: Db,
  config: AppConfig,
  query: RaffleListFilters,
  userId?: string,
) {
  const filters: SQL[] = [eq(schema.raffleSku.status, 'active')]
  if (query.category) {
    filters.push(eq(schema.raffleSku.category, query.category))
  }
  if (query.search) {
    const pattern = `%${query.search}%`
    const search = or(
      ilike(schema.raffleSku.name, pattern),
      ilike(schema.raffleSku.slug, pattern),
    )
    if (search) {
      filters.push(search)
    }
  }
  const skus = await db.query.raffleSku.findMany({
    limit: query.limit,
    orderBy: [schema.raffleSku.sortOrder, schema.raffleSku.slug],
    where: and(...filters),
  })
  if (skus.length === 0) {
    return { items: [] }
  }

  const rounds = await Promise.all(
    skus.map(async (sku) => {
      const [open, last] = await Promise.all([
        db.query.raffleRound.findFirst({
          orderBy: [desc(schema.raffleRound.roundNumber)],
          where: and(
            eq(schema.raffleRound.skuId, sku.id),
            inArray(schema.raffleRound.status, ['open', 'drawing']),
          ),
        }),
        db.query.raffleRound.findFirst({
          orderBy: [desc(schema.raffleRound.roundNumber)],
          where: and(
            eq(schema.raffleRound.skuId, sku.id),
            inArray(schema.raffleRound.status, ['settled', 'voided']),
          ),
        }),
      ])
      return { last: last ?? null, open: open ?? null, sku }
    }),
  )

  return {
    items: await Promise.all(
      rounds.map(({ last, open, sku }) =>
        raffleItem(db, config, sku, open, last, userId),
      ),
    ),
  }
}

export async function getRaffle(
  db: Db,
  config: AppConfig,
  slug: string,
  userId?: string,
) {
  const sku = await requireSku(db, slug)
  if (sku.status !== 'active') {
    throw httpErrors.notFound('Raffle not found')
  }
  const rounds = await db.query.raffleRound.findMany({
    limit: 2,
    orderBy: [desc(schema.raffleRound.roundNumber)],
    where: eq(schema.raffleRound.skuId, sku.id),
  })
  const current =
    rounds.find(
      (round) => round.status === 'open' || round.status === 'drawing',
    ) ?? null
  const last = rounds.find((round) => round.id !== current?.id) ?? null
  return raffleItem(db, config, sku, current, last, userId)
}

export async function openRoundForSku(
  tx: WalletTransaction,
  config: AppConfig,
  sku: RaffleSkuRow,
) {
  const open = await tx.query.raffleRound.findFirst({
    where: and(
      eq(schema.raffleRound.skuId, sku.id),
      inArray(schema.raffleRound.status, ['open', 'drawing']),
    ),
  })
  if (open) {
    return open
  }

  const [latest, active] = await Promise.all([
    tx.query.raffleRound.findFirst({
      orderBy: [desc(schema.raffleRound.roundNumber)],
      where: eq(schema.raffleRound.skuId, sku.id),
    }),
    findCurrency(tx, sku.payoutCurrency),
  ])
  const sharePrice = parseAmount(RAFFLE_SHARE_PRICE, active.decimals)
  const capacity = computeRaffleCapacity(
    sku.payoutAmount,
    sharePrice,
    sku.tauBps,
  )
  const serverSeed = randomBytes(32).toString('hex')
  const startsAt = new Date()
  const [created] = await tx
    .insert(schema.raffleRound)
    .values({
      botShares: 0,
      capacity,
      earlyWindowSec: sku.earlyWindowSec,
      endsAt: new Date(startsAt.getTime() + sku.durationSec * 1000),
      giftCapBps: sku.giftCapBps,
      id: randomUUID(),
      payoutAmount: sku.payoutAmount,
      payoutCurrency: sku.payoutCurrency,
      roundNumber: (latest?.roundNumber ?? 0) + 1,
      serverSeed: encryptSeed(serverSeed, config),
      serverSeedHash: createHash('sha256').update(serverSeed).digest('hex'),
      sharePrice,
      skuId: sku.id,
      sold: 0,
      soldGift: 0,
      startsAt,
      status: 'open',
      tauBps: sku.tauBps,
      tauEarlyBps: sku.tauEarlyBps,
      winnerIsPlatform: false,
    })
    .onConflictDoNothing()
    .returning()
  if (!created) {
    const existing = await tx.query.raffleRound.findFirst({
      where: and(
        eq(schema.raffleRound.skuId, sku.id),
        inArray(schema.raffleRound.status, ['open', 'drawing']),
      ),
    })
    if (!existing) {
      throw new Error('Failed to open raffle round')
    }
    return existing
  }
  return created
}

export async function ensureOpenRaffleRounds(db: Db, config: AppConfig) {
  const skus = await db.query.raffleSku.findMany({
    where: eq(schema.raffleSku.status, 'active'),
  })
  for (const sku of skus) {
    await db.transaction((tx) => openRoundForSku(tx, config, sku))
  }
}

async function refundRound(tx: WalletTransaction, round: RaffleRoundRow) {
  const entries = await tx
    .select()
    .from(schema.raffleEntry)
    .where(
      and(
        eq(schema.raffleEntry.roundId, round.id),
        eq(schema.raffleEntry.refunded, false),
      ),
    )
  for (const entry of entries) {
    await creditInTransaction(tx, {
      amount: entry.amount,
      idempotencyKey: `raffle-refund:${entry.id}`,
      reference: {
        referenceId: entry.id,
        referenceType: WALLET_REFERENCES.raffleRefund,
      },
      walletId: entry.walletId,
    })
    await tx
      .update(schema.raffleEntry)
      .set({ refunded: true })
      .where(eq(schema.raffleEntry.id, entry.id))
  }
}

async function drawRound(
  tx: WalletTransaction,
  config: AppConfig,
  round: RaffleRoundRow,
) {
  if (!round.serverSeed || round.sold <= 0) {
    throw new Error('Raffle round cannot be drawn')
  }
  const winningNumber =
    pfRangedInt(
      decryptSeed(round.serverSeed, config),
      round.id,
      0,
      0,
      round.sold,
    ) + 1
  const winner = await tx.query.raffleEntry.findFirst({
    where: and(
      eq(schema.raffleEntry.roundId, round.id),
      sql`${schema.raffleEntry.firstNumber} <= ${winningNumber}`,
      sql`${schema.raffleEntry.lastNumber} >= ${winningNumber}`,
    ),
  })
  if (!winner) {
    throw new Error('Raffle winning entry is missing')
  }

  await creditInTransaction(tx, {
    amount: round.payoutAmount,
    idempotencyKey: `raffle-prize:${round.id}`,
    reference: {
      referenceId: round.id,
      referenceType: WALLET_REFERENCES.rafflePrize,
    },
    walletId: winner.walletId,
  })
  await recordBetPayoutInTransaction(
    tx,
    {
      amount: winner.amount,
      currency: winner.currency,
      game: 'raffle',
      idempotencyKey: winner.idempotencyKey,
      userId: winner.userId,
    },
    round.payoutAmount,
  )
  await tx
    .update(schema.raffleRound)
    .set({
      settledAt: new Date(),
      status: 'settled',
      winnerIsPlatform: false,
      winnerUserId: winner.userId,
      winningNumber,
    })
    .where(eq(schema.raffleRound.id, round.id))
}

export function settleRaffleRoundIfDue(
  db: Db,
  config: AppConfig,
  roundId: string,
) {
  return db.transaction(async (tx) => {
    const [round] = await tx
      .select()
      .from(schema.raffleRound)
      .where(eq(schema.raffleRound.id, roundId))
      .for('update')
    if (!round || round.status !== 'open') {
      return null
    }
    const resolution = raffleResolution(round)
    if (resolution === 'wait') {
      return null
    }

    await tx
      .update(schema.raffleRound)
      .set({ status: 'drawing' })
      .where(eq(schema.raffleRound.id, round.id))

    if (resolution === 'draw') {
      await drawRound(tx, config, round)
    } else {
      await refundRound(tx, round)
      await tx
        .update(schema.raffleRound)
        .set({ settledAt: new Date(), status: 'voided' })
        .where(eq(schema.raffleRound.id, round.id))
    }

    const sku = await tx.query.raffleSku.findFirst({
      where: eq(schema.raffleSku.id, round.skuId),
    })
    if (sku?.status === 'active') {
      await openRoundForSku(tx, config, sku)
    }
    return await tx.query.raffleRound.findFirst({
      where: eq(schema.raffleRound.id, round.id),
    })
  })
}

export async function settleDueRaffleRounds(db: Db, config: AppConfig) {
  const rounds = await db.query.raffleRound.findMany({
    where: eq(schema.raffleRound.status, 'open'),
  })
  const settled: string[] = []
  for (const round of rounds) {
    if (raffleResolution(round) !== 'wait') {
      const result = await settleRaffleRoundIfDue(db, config, round.id)
      if (result) {
        settled.push(result.id)
      }
    }
  }
  return settled
}

async function finalBalanceAfter(
  db: Db,
  walletId: string,
  idempotencyKey: string,
) {
  const row = await db.query.walletTransaction.findFirst({
    where: and(
      eq(schema.walletTransaction.walletId, walletId),
      eq(schema.walletTransaction.idempotencyKey, idempotencyKey),
    ),
  })
  return row?.balanceAfter ?? null
}

async function entryResponse(
  db: Db,
  config: AppConfig,
  entry: RaffleEntryRow,
  balanceAfter: bigint,
): Promise<RaffleEntryResponse> {
  const round = await requireRound(db, entry.roundId)
  const active = await findCurrency(db, entry.currency)
  return {
    amount: formatAmount(entry.amount, active.decimals),
    balanceAfter: formatAmount(balanceAfter, active.decimals),
    entryId: entry.id,
    round: await publicRound(db, config, round, entry.userId),
    shares: entry.shareCount,
  }
}

export async function enterRaffleRound(
  db: Db,
  config: AppConfig,
  userId: string,
  roundId: string,
  input: EnterRaffleInput,
): Promise<RaffleEntryResponse> {
  const round = await requireRound(db, roundId)
  const requestHash = hashGameBetRequest('raffle', {
    roundId,
    shares: input.shares,
  })
  const existing = await db.query.raffleEntry.findFirst({
    where: and(
      eq(schema.raffleEntry.roundId, roundId),
      eq(schema.raffleEntry.userId, userId),
      eq(schema.raffleEntry.idempotencyKey, input.idempotencyKey),
    ),
  })
  if (existing) {
    assertIdempotentRequest(existing.requestHash, requestHash)
    const wallet = await ensureWallet(db, userId, existing.currency)
    const balance = await finalBalanceAfter(
      db,
      wallet.id,
      `raffle-entry:${roundId}:${input.idempotencyKey}`,
    )
    if (balance === null) {
      throw new Error('Raffle entry balance transaction is missing')
    }
    return entryResponse(db, config, existing, balance)
  }

  const active = await findCurrency(db, round.payoutCurrency)
  assertBettingCurrency(active)
  const amount = round.sharePrice * BigInt(input.shares)
  const limits = getDefaultBetLimits(config, active)
  assertBetAmount(amount, limits)
  const wallet = await ensureWallet(db, userId, active.code)
  const riskContext = {
    amount,
    currency: active.code,
    game: 'raffle',
    idempotencyKey: input.idempotencyKey,
    userId,
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(schema.raffleRound)
        .where(eq(schema.raffleRound.id, roundId))
        .for('update')
      if (!locked) {
        throw httpErrors.notFound('Raffle round not found')
      }
      if (locked.status !== 'open') {
        throw httpErrors.conflict('This raffle is no longer open')
      }
      if (locked.endsAt.getTime() <= Date.now()) {
        throw httpErrors.conflict('This raffle has ended')
      }
      if (locked.sold + input.shares > locked.capacity) {
        throw httpErrors.conflict('Not enough raffle shares remaining')
      }
      await assertBetAllowedInTransaction(tx, riskContext)
      const entryId = randomUUID()
      const debit = await debitInTransaction(tx, {
        amount,
        idempotencyKey: `raffle-entry:${roundId}:${input.idempotencyKey}`,
        reference: {
          referenceId: entryId,
          referenceType: WALLET_REFERENCES.raffleEntry,
        },
        walletId: wallet.id,
      })
      const [created] = await tx
        .insert(schema.raffleEntry)
        .values({
          amount,
          currency: active.code,
          firstNumber: locked.sold + 1,
          id: entryId,
          idempotencyKey: input.idempotencyKey,
          lastNumber: locked.sold + input.shares,
          requestHash,
          roundId,
          shareCount: input.shares,
          userId,
          walletId: wallet.id,
        })
        .returning()
      if (!created) {
        throw new Error('Failed to record raffle entry')
      }
      const [updated] = await tx
        .update(schema.raffleRound)
        .set({ sold: locked.sold + input.shares })
        .where(
          and(
            eq(schema.raffleRound.id, roundId),
            eq(schema.raffleRound.status, 'open'),
            sql`${schema.raffleRound.sold} + ${input.shares} <= ${schema.raffleRound.capacity}`,
          ),
        )
        .returning()
      if (!updated) {
        throw httpErrors.conflict('Raffle round was filled by another player')
      }
      return { balanceAfter: debit.balanceAfter, entry: created }
    })

    return entryResponse(db, config, result.entry, result.balanceAfter)
  } catch (error) {
    if (isRiskRejection(error)) {
      await recordBetRejected(db, riskContext, error.code)
      throw error
    }
    if (findErrorCode(error) !== '23505') {
      throw error
    }
    const replay = await db.query.raffleEntry.findFirst({
      where: and(
        eq(schema.raffleEntry.roundId, roundId),
        eq(schema.raffleEntry.userId, userId),
        eq(schema.raffleEntry.idempotencyKey, input.idempotencyKey),
      ),
    })
    if (!replay) {
      throw error
    }
    assertIdempotentRequest(replay.requestHash, requestHash)
    const balance = await finalBalanceAfter(
      db,
      wallet.id,
      `raffle-entry:${roundId}:${input.idempotencyKey}`,
    )
    if (balance === null) {
      throw new Error('Raffle entry balance transaction is missing', {
        cause: error,
      })
    }
    return entryResponse(db, config, replay, balance)
  }
}

export async function listRaffleHistory(
  db: Db,
  config: AppConfig,
  userId: string,
  query: RaffleHistoryFilters,
): Promise<RaffleHistoryResponse> {
  const filters: SQL[] = [eq(schema.raffleEntry.userId, userId)]
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor)
    const createdAt = new Date(cursor.createdAt)
    const condition = or(
      lt(schema.raffleEntry.createdAt, createdAt),
      and(
        eq(schema.raffleEntry.createdAt, createdAt),
        lt(schema.raffleEntry.id, cursor.id),
      ),
    )
    if (condition) {
      filters.push(condition)
    }
  }
  const rows = await db.query.raffleEntry.findMany({
    limit: query.limit + 1,
    orderBy: [desc(schema.raffleEntry.createdAt), desc(schema.raffleEntry.id)],
    where: and(...filters),
  })
  const page = rows.slice(0, query.limit)
  const items = []
  for (const entry of page) {
    const [round, active] = await Promise.all([
      requireRound(db, entry.roundId),
      findCurrency(db, entry.currency),
    ])
    const sku = await requireSku(db, round.skuId)
    const detail = await publicRound(db, config, round, userId)
    const outcome = detail.myOutcome === 'none' ? 'lost' : detail.myOutcome
    items.push({
      amount: formatAmount(entry.amount, active.decimals),
      createdAt: entry.createdAt.toISOString(),
      currency: entry.currency,
      entryId: entry.id,
      outcome:
        outcome === 'open' ||
        outcome === 'won' ||
        outcome === 'lost' ||
        outcome === 'voided'
          ? outcome
          : 'lost',
      round: detail,
      shares: entry.shareCount,
      skuId: sku.id,
      slug: sku.slug,
    })
  }
  const last = page.at(-1)
  return {
    items,
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  }
}

export async function verifyRaffleRound(
  db: Db,
  config: AppConfig,
  roundId: string,
) {
  const round = await requireRound(db, roundId)
  const revealed = round.status === 'settled'
  const expectedWinningNumber =
    revealed && round.serverSeed && round.sold > 0
      ? pfRangedInt(
          decryptSeed(round.serverSeed, config),
          round.id,
          0,
          0,
          round.sold,
        ) + 1
      : null
  let message = 'Round has not been drawn yet'
  if (round.status === 'voided') {
    message = 'Round was voided and entries were refunded'
  } else if (revealed) {
    message = 'Verification data is complete'
  }
  return {
    capacity: round.capacity,
    expectedWinningNumber,
    message,
    roundId: round.id,
    serverSeed:
      (round.status === 'settled' || round.status === 'voided') &&
      round.serverSeed
        ? decryptSeed(round.serverSeed, config)
        : null,
    serverSeedHash: round.serverSeedHash,
    sold: round.sold,
    status: round.status,
    valid:
      expectedWinningNumber === null
        ? null
        : expectedWinningNumber === round.winningNumber,
    winningNumber: round.winningNumber,
  }
}
