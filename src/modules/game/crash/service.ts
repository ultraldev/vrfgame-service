import { randomUUID } from 'node:crypto'

import { httpErrors } from '@fastify/sensible'
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import type { AppConfig } from '@/lib/config'
import { currency as findCurrency } from '@/lib/currency'
import { decodeCursor, encodeCursor } from '@/lib/cursor'
import { formatAmount, parseAmount } from '@/lib/money'
import { decryptSeed } from '@/lib/seed-cipher'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import {
  assertIdempotentRequest,
  findGameBet,
  hashGameBetRequest,
} from '@/modules/game/bets'
import {
  calculateCrashPayout,
  computeMultiplierCenti,
  formatMultiplier,
  generateCrashPointCenti,
} from '@/modules/game/crash/engine'
import type { CrashRuntime } from '@/modules/game/crash/runtime'
import { CrashBetResultSchema } from '@/modules/game/crash/schema'
import type {
  CrashBetRequest,
  CrashCashOutResponse,
  CrashHistoryFilters,
} from '@/modules/game/crash/schema'
import {
  assertBetAmount,
  assertBettingCurrency,
  capPayout,
  getBetLimits,
} from '@/modules/game/limits'
import {
  assertBetAllowedInTransaction,
  recordBetPayoutInTransaction,
  recordBetRejected,
} from '@/modules/risk/service'
import { isRiskRejection } from '@/modules/risk/util'
import {
  lockInTransaction,
  settleLockInTransaction,
  unlockInTransaction,
} from '@/modules/wallet/ledger'
import { ensureWallet } from '@/modules/wallet/service'
import { WALLET_REFERENCES } from '@/modules/wallet/util'

const CRASH_SLUG = 'crash'
const ROUND_LOCK_PREFIX = 'crash-round:'

interface CrashBetInput extends CrashBetRequest {
  idempotencyKey: string
}

async function crashGame(db: Db) {
  const game = await db.query.game.findFirst({
    columns: { id: true, rtp: true },
    where: and(
      eq(schema.game.slug, CRASH_SLUG),
      eq(schema.game.status, 'active'),
    ),
  })
  if (!game) {
    throw httpErrors.notFound('Crash game not found')
  }
  return game
}

async function currencyScale(db: Db, code: string) {
  const currency = await db.query.currency.findFirst({
    where: eq(schema.currency.code, code),
  })
  if (!currency) {
    throw new Error(`Currency missing for crash bet: ${code}`)
  }
  return currency
}

function roundIdOf(result: unknown) {
  const parsed = CrashBetResultSchema.safeParse(result)
  if (!parsed.success) {
    throw httpErrors.conflict('Idempotency key belongs to another game')
  }
  return parsed.data.roundId
}

export function getCrashSnapshot(runtime: CrashRuntime) {
  return runtime.getSnapshot()
}

export async function placeCrashBet(
  db: Db,
  config: AppConfig,
  runtime: CrashRuntime,
  userId: string,
  input: CrashBetInput,
) {
  const game = await crashGame(db)
  const existing = await findGameBet(db, userId, input.idempotencyKey)
  if (existing) {
    const existingRoundId = roundIdOf(existing.result)
    const requestHash = hashGameBetRequest(CRASH_SLUG, {
      amount: existing.amount,
      currency: existing.currency,
      roundId: existingRoundId,
    })
    assertIdempotentRequest(existing.requestHash, requestHash)
    const currency = await currencyScale(db, existing.currency)
    const snapshot = await runtime.getSnapshot()
    return {
      amount: formatAmount(existing.amount, currency.decimals),
      betId: existing.id,
      isNextRound: snapshot.nextRound?.id === existingRoundId,
      roundId: existingRoundId,
      status: existing.status,
    }
  }

  const active = await findCurrency(db, input.currency)
  const amount = parseAmount(input.amount, active.decimals)
  const target = await runtime.resolveBetTarget()
  const requestHash = hashGameBetRequest(CRASH_SLUG, {
    amount,
    currency: active.code,
    roundId: target.id,
  })
  assertBettingCurrency(active)
  const limits = await getBetLimits(db, config, game.id, active)
  assertBetAmount(amount, limits)
  const wallet = await ensureWallet(db, userId, active.code)
  const riskContext = {
    amount,
    currency: active.code,
    game: CRASH_SLUG,
    idempotencyKey: input.idempotencyKey,
    userId,
  }

  try {
    const bet = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`crash-bet:${userId}:${target.id}`}, 0))`,
      )
      const existingInTx = await tx.query.gameBet.findFirst({
        where: and(
          eq(schema.gameBet.userId, userId),
          eq(schema.gameBet.idempotencyKey, input.idempotencyKey),
        ),
      })
      if (existingInTx) {
        const existingRoundId = roundIdOf(existingInTx.result)
        const replayHash = hashGameBetRequest(CRASH_SLUG, {
          amount: existingInTx.amount,
          currency: existingInTx.currency,
          roundId: existingRoundId,
        })
        assertIdempotentRequest(existingInTx.requestHash, replayHash)
        return { balanceAfter: null, bet: existingInTx, locked: null }
      }

      const round = await tx.query.crashRound.findFirst({
        where: eq(schema.crashRound.id, target.id),
      })
      if (!round || (round.phase !== 'pending' && round.phase !== 'betting')) {
        throw httpErrors.conflict('Crash round is no longer accepting bets')
      }
      const previousBet = await tx.query.gameBet.findFirst({
        where: and(
          eq(schema.gameBet.userId, userId),
          eq(schema.gameBet.gameId, game.id),
          sql`${schema.gameBet.result} ->> 'roundId' = ${target.id}`,
          sql`${schema.gameBet.status} <> 'cancelled'`,
        ),
      })
      if (previousBet) {
        throw httpErrors.conflict('You already placed a bet in this round')
      }

      await assertBetAllowedInTransaction(tx, riskContext)
      const betId = randomUUID()
      const locked = await lockInTransaction(tx, {
        amount,
        idempotencyKey: input.idempotencyKey,
        reference: {
          referenceId: betId,
          referenceType: WALLET_REFERENCES.crashBet,
        },
        walletId: wallet.id,
      })
      const [created] = await tx
        .insert(schema.gameBet)
        .values({
          amount,
          clientSeed: round.clientSeed,
          currency: active.code,
          gameId: game.id,
          id: betId,
          idempotencyKey: input.idempotencyKey,
          nonce: round.nonce,
          payout: 0n,
          requestHash,
          result: { cashOutMultiplierCenti: null, roundId: target.id },
          seedId: null,
          status: 'active',
          userId,
          walletId: wallet.id,
        })
        .returning()
      if (!created || locked.lockedBalanceAfter === null) {
        throw new Error('Failed to place crash bet')
      }
      await tx
        .insert(schema.userRecentGame)
        .values({ gameId: game.id, userId })
        .onConflictDoUpdate({
          set: { playedAt: new Date() },
          target: [schema.userRecentGame.userId, schema.userRecentGame.gameId],
        })
      return { balanceAfter: locked.balanceAfter, bet: created, locked }
    })

    await runtime.notifyBetsChanged(target.id)
    await runtime.publishEvent(SOCKET_EVENTS.betPlaced, {
      amount: formatAmount(bet.bet.amount, active.decimals),
      isNextRound: target.isNextRound,
      roundId: target.id,
      userId,
    })
    await runtime.publishWallet(userId, active.code)
    return {
      amount: formatAmount(bet.bet.amount, active.decimals),
      betId: bet.bet.id,
      isNextRound: target.isNextRound,
      roundId: target.id,
      status: bet.bet.status,
    }
  } catch (error) {
    if (isRiskRejection(error)) {
      await recordBetRejected(db, riskContext, error.code)
    }
    throw error
  }
}

export async function cancelCrashBet(
  db: Db,
  runtime: CrashRuntime,
  userId: string,
) {
  const game = await crashGame(db)
  const snapshot = await runtime.getSnapshot()
  const roundIds = [snapshot.currentRound.id, snapshot.nextRound?.id].filter(
    (id): id is string => Boolean(id),
  )
  const bets = await db.query.gameBet.findMany({
    where: and(
      eq(schema.gameBet.userId, userId),
      eq(schema.gameBet.gameId, game.id),
      eq(schema.gameBet.status, 'active'),
      or(
        ...roundIds.map(
          (roundId) => sql`${schema.gameBet.result} ->> 'roundId' = ${roundId}`,
        ),
      ),
    ),
  })
  const bet =
    (snapshot.nextRound
      ? bets.find(
          (candidate) => roundIdOf(candidate.result) === snapshot.nextRound?.id,
        )
      : undefined) ?? bets[0]
  if (!bet) {
    throw httpErrors.notFound('No active crash bet found')
  }
  const roundId = roundIdOf(bet.result)

  const cancelled = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${ROUND_LOCK_PREFIX}${roundId}`}, 0))`,
    )
    const round = await tx.query.crashRound.findFirst({
      where: eq(schema.crashRound.id, roundId),
    })
    if (!round || (round.phase !== 'pending' && round.phase !== 'betting')) {
      throw httpErrors.badRequest('Crash betting has already closed')
    }
    const [lockedBet] = await tx
      .select()
      .from(schema.gameBet)
      .where(
        and(
          eq(schema.gameBet.id, bet.id),
          eq(schema.gameBet.userId, userId),
          eq(schema.gameBet.status, 'active'),
        ),
      )
      .for('update')
    if (!lockedBet) {
      throw httpErrors.conflict('Crash bet is no longer active')
    }
    const unlocked = await unlockInTransaction(tx, {
      amount: lockedBet.amount,
      idempotencyKey: `${lockedBet.id}:cancel`,
      reference: {
        referenceId: lockedBet.id,
        referenceType: WALLET_REFERENCES.crashRefund,
      },
      walletId: lockedBet.walletId,
    })
    await tx
      .update(schema.gameBet)
      .set({ status: 'cancelled' })
      .where(eq(schema.gameBet.id, lockedBet.id))
    return { amount: lockedBet.amount, bet: lockedBet, unlocked }
  })

  const currency = await currencyScale(db, cancelled.bet.currency)
  await runtime.notifyBetsChanged(roundId)
  await runtime.publishEvent(SOCKET_EVENTS.betCancelled, {
    amount: formatAmount(cancelled.amount, currency.decimals),
    roundId,
    userId,
  })
  await runtime.publishWallet(userId, cancelled.bet.currency)
  return {
    amount: formatAmount(cancelled.amount, currency.decimals),
    roundId,
  }
}

export async function cashOutCrashBet(
  db: Db,
  config: AppConfig,
  runtime: CrashRuntime,
  userId: string,
  betId: string,
): Promise<CrashCashOutResponse> {
  const game = await crashGame(db)
  const snapshot = await runtime.getSnapshot()
  const roundId = snapshot.currentRound.id
  const active = await db.query.gameBet.findFirst({
    where: and(
      eq(schema.gameBet.id, betId),
      eq(schema.gameBet.userId, userId),
      eq(schema.gameBet.gameId, game.id),
      eq(schema.gameBet.status, 'active'),
      sql`${schema.gameBet.result} ->> 'roundId' = ${roundId}`,
    ),
  })
  if (!active) {
    throw httpErrors.notFound('No active crash bet found for this round')
  }
  const currency = await currencyScale(db, active.currency)
  const limits = await getBetLimits(db, config, game.id, currency)
  const riskContext = {
    amount: active.amount,
    currency: active.currency,
    game: CRASH_SLUG,
    idempotencyKey: active.idempotencyKey,
    userId,
  }

  const settled = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${ROUND_LOCK_PREFIX}${roundId}`}, 0))`,
    )
    const round = await tx.query.crashRound.findFirst({
      where: eq(schema.crashRound.id, roundId),
    })
    if (
      !round ||
      round.phase !== 'running' ||
      !round.runningAt ||
      round.crashPointCenti === null
    ) {
      throw httpErrors.badRequest('Crash round is not running')
    }
    const multiplierCenti = computeMultiplierCenti(
      Date.now() - round.runningAt.getTime(),
    )
    if (multiplierCenti >= round.crashPointCenti) {
      throw httpErrors.badRequest('Round is no longer eligible for cashout')
    }
    const [lockedBet] = await tx
      .select()
      .from(schema.gameBet)
      .where(
        and(
          eq(schema.gameBet.id, betId),
          eq(schema.gameBet.userId, userId),
          eq(schema.gameBet.status, 'active'),
        ),
      )
      .for('update')
    if (!lockedBet) {
      throw httpErrors.conflict('Crash bet is no longer active')
    }
    const result = CrashBetResultSchema.parse(lockedBet.result)
    const payout = capPayout(
      calculateCrashPayout(lockedBet.amount, multiplierCenti),
      limits.maxPayout,
    )
    const balance = await settleLockInTransaction(tx, {
      idempotencyKey: `${lockedBet.id}:cashout`,
      lockedAmount: lockedBet.amount,
      payout,
      reference: {
        referenceId: lockedBet.id,
        referenceType: WALLET_REFERENCES.crashPayout,
      },
      walletId: lockedBet.walletId,
    })
    await tx
      .update(schema.gameBet)
      .set({
        payout,
        result: { ...result, cashOutMultiplierCenti: multiplierCenti },
        status: 'cashed_out',
      })
      .where(eq(schema.gameBet.id, lockedBet.id))
    await recordBetPayoutInTransaction(tx, riskContext, payout)
    if (balance.lockedBalanceAfter === null) {
      throw new Error('Crash cashout did not return a locked balance')
    }
    return {
      balanceAfter: balance.balanceAfter,
      lockedBalanceAfter: balance.lockedBalanceAfter,
      multiplierCenti,
      payout,
    }
  })

  await runtime.notifyBetsChanged(roundId)
  await runtime.publishEvent(SOCKET_EVENTS.cashout, {
    multiplier: formatMultiplier(settled.multiplierCenti),
    payout: formatAmount(settled.payout, currency.decimals),
    roundId,
    userId,
  })
  await runtime.publishWallet(userId, active.currency)
  return {
    balanceAfter: formatAmount(settled.balanceAfter, currency.decimals),
    betId,
    lockedBalanceAfter: formatAmount(
      settled.lockedBalanceAfter,
      currency.decimals,
    ),
    multiplier: formatMultiplier(settled.multiplierCenti),
    payout: formatAmount(settled.payout, currency.decimals),
    roundId,
    status: 'cashed_out',
    userId,
  }
}

export async function listCrashBets(
  db: Db,
  userId: string,
  query: CrashHistoryFilters,
) {
  const game = await crashGame(db)
  const filters: SQL[] = [
    eq(schema.gameBet.userId, userId),
    eq(schema.gameBet.gameId, game.id),
  ]
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor)
    const createdAt = new Date(cursor.createdAt)
    const condition = or(
      lt(schema.gameBet.createdAt, createdAt),
      and(
        eq(schema.gameBet.createdAt, createdAt),
        lt(schema.gameBet.id, cursor.id),
      ),
    )
    if (condition) {
      filters.push(condition)
    }
  }
  const rows = await db.query.gameBet.findMany({
    limit: query.limit + 1,
    orderBy: [desc(schema.gameBet.createdAt), desc(schema.gameBet.id)],
    where: and(...filters),
  })
  const page = rows.slice(0, query.limit)
  const codes = [...new Set(page.map((bet) => bet.currency))]
  const currencies = codes.length
    ? await db
        .select()
        .from(schema.currency)
        .where(inArray(schema.currency.code, codes))
    : []
  const decimals = new Map(
    currencies.map((currency) => [currency.code, currency.decimals]),
  )
  const last = page.at(-1)

  return {
    items: page.map((bet) => {
      const scale = decimals.get(bet.currency)
      if (scale === undefined) {
        throw new Error(`Currency missing for crash bet ${bet.id}`)
      }
      const result = CrashBetResultSchema.parse(bet.result)
      return {
        amount: formatAmount(bet.amount, scale),
        createdAt: bet.createdAt.toISOString(),
        currency: bet.currency,
        id: bet.id,
        multiplier:
          result.cashOutMultiplierCenti === null ||
          result.cashOutMultiplierCenti === undefined
            ? null
            : formatMultiplier(result.cashOutMultiplierCenti),
        payout: formatAmount(bet.payout, scale),
        roundId: result.roundId,
        status: bet.status,
      }
    }),
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({
            createdAt: last.createdAt.toISOString(),
            id: last.id,
          })
        : null,
  }
}

export async function listRecentCrashRounds(db: Db, limit: number) {
  const rounds = await db.query.crashRound.findMany({
    limit,
    orderBy: [desc(schema.crashRound.roundNumber)],
    where: eq(schema.crashRound.phase, 'crashed'),
  })
  return rounds.map((round) => ({
    clientSeed: round.clientSeed,
    crashPoint:
      round.crashPointCenti === null
        ? null
        : formatMultiplier(round.crashPointCenti),
    crashedAt: round.crashedAt?.toISOString() ?? null,
    id: round.id,
    nonce: round.nonce,
    roundNumber: round.roundNumber,
    serverSeedHash: round.serverSeedHash,
  }))
}

export async function verifyCrashRound(
  db: Db,
  config: AppConfig,
  roundId: string,
) {
  const round = await db.query.crashRound.findFirst({
    where: eq(schema.crashRound.id, roundId),
  })
  if (!round) {
    throw httpErrors.notFound('Crash round not found')
  }
  if (round.phase !== 'crashed' || round.crashPointCenti === null) {
    throw httpErrors.badRequest('Crash round is not revealed yet')
  }
  const serverSeed = decryptSeed(round.serverSeed, config)
  const expectedCrashPointCenti = generateCrashPointCenti(
    serverSeed,
    round.clientSeed,
    round.nonce,
    round.houseEdgeBps / 10_000,
  )
  return {
    clientSeed: round.clientSeed,
    crashPoint: formatMultiplier(round.crashPointCenti),
    expectedCrashPoint: formatMultiplier(expectedCrashPointCenti),
    nonce: round.nonce,
    roundId: round.id,
    roundNumber: round.roundNumber,
    serverSeed,
    serverSeedHash: round.serverSeedHash,
    valid: expectedCrashPointCenti === round.crashPointCenti,
  }
}
