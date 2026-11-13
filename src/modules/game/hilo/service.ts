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
import {
  assertIdempotentRequest,
  findGameBet,
  hashGameBetRequest,
} from '@/modules/game/bets'
import {
  consumeNonce,
  getOrCreateActiveSeed,
  getSeedById,
  rotateSeed,
} from '@/modules/game/fairness'
import {
  assertBetAmount,
  assertBettingCurrency,
  capPayout,
  getBetLimits,
} from '@/modules/game/limits'
import {
  clampRtpBps,
  DEFAULT_GAME_RTP_BPS,
  rtpBpsToHouseEdgeBps,
} from '@/modules/game/rtp'
import { formatMultiplierBps } from '@/modules/game/util'
import {
  assertBetAllowedInTransaction,
  recordBetPayoutInTransaction,
  recordBetRejected,
} from '@/modules/risk/service'
import { isRiskRejection } from '@/modules/risk/util'
import {
  lockInTransaction,
  settleLockInTransaction,
} from '@/modules/wallet/ledger'
import type { WalletTransaction } from '@/modules/wallet/ledger'
import { ensureWallet } from '@/modules/wallet/service'
import { WALLET_REFERENCES } from '@/modules/wallet/util'

import { HiloBetResultSchema } from './schema'
import type {
  HiloBetResult,
  HiloCashOutResponse,
  HiloGameResponse,
  HiloGuessResult,
  HiloHistoryFilters,
  HiloHistoryResponse,
  HiloStartRequest,
} from './schema'
import {
  availableDirections,
  bpsToCenti,
  canCashOutHilo,
  calculateHiloPayoutBps,
  compoundHiloMultiplierBps,
  didWin,
  drawHiloCard,
  getHiloMultiplierBps,
  HILO_MAX_ROUNDS,
  HILO_ONE_BPS,
  isValidDirection,
  readCumulativeMultiplierBps,
} from './util'
import type { HiloDirection } from './util'

const HILO_SLUG = 'hilo'
const ACTIVE_STATUS = 'active'

interface HiloStartInput extends HiloStartRequest {
  idempotencyKey: string
}

type HiloStatus = 'active' | 'lost' | 'cashed_out'
type GameBetRow = typeof schema.gameBet.$inferSelect

function hiloStatus(value: string): HiloStatus {
  if (value === 'active' || value === 'lost' || value === 'cashed_out') {
    return value
  }
  throw new Error(`Unsupported hilo bet status: ${value}`)
}

function assertSameSeed(betSeedId: string | null, consumedSeedId: string) {
  if (!betSeedId || betSeedId !== consumedSeedId) {
    throw httpErrors.conflict(
      'Server seed changed mid-game; this game can no longer be continued',
    )
  }
}

async function requireHiloGame(db: Db) {
  const game = await db.query.game.findFirst({
    columns: { id: true, rtp: true },
    where: and(
      eq(schema.game.slug, HILO_SLUG),
      eq(schema.game.status, 'active'),
    ),
  })
  if (!game) {
    throw httpErrors.notFound('Hilo game not found')
  }
  return game
}

async function walletState(tx: WalletTransaction, walletId: string) {
  const wallet = await tx.query.wallet.findFirst({
    where: eq(schema.wallet.id, walletId),
  })
  if (!wallet) {
    throw httpErrors.notFound('Wallet not found')
  }
  return wallet
}

async function betCurrency(tx: WalletTransaction, code: string) {
  const active = await tx.query.currency.findFirst({
    where: eq(schema.currency.code, code),
  })
  if (!active) {
    throw new Error(`Currency missing for hilo bet: ${code}`)
  }
  return active
}

async function gameResponse(
  db: Db,
  bet: GameBetRow,
  balanceAfter: bigint,
  lockedBalanceAfter: bigint,
): Promise<HiloGameResponse> {
  const result = HiloBetResultSchema.parse(bet.result)
  const seed = await getSeedById(db, bet.seedId)
  const active = await db.query.currency.findFirst({
    where: eq(schema.currency.code, bet.currency),
  })
  if (!active) {
    throw new Error(`Currency missing for hilo bet: ${bet.currency}`)
  }

  return {
    amount: formatAmount(bet.amount, active.decimals),
    balanceAfter: formatAmount(balanceAfter, active.decimals),
    betId: bet.id,
    currency: bet.currency,
    currentCard: result.currentCard,
    directions: [...availableDirections(result.currentCard)],
    lockedBalanceAfter: formatAmount(lockedBalanceAfter, active.decimals),
    multiplier: formatMultiplierBps(readCumulativeMultiplierBps(result)),
    nextNonce: seed.nonce,
    rounds: result.rounds,
    serverSeedHash: seed.serverSeedHash,
    status: hiloStatus(bet.status),
  }
}

function guessResponse(
  bet: GameBetRow,
  result: HiloBetResult,
  won: boolean,
  card: number,
  decimals: number,
  balanceAfter: bigint,
  lockedBalanceAfter: bigint,
): HiloGuessResult {
  const terminal = bet.status === 'lost' || bet.status === 'cashed_out'
  return {
    balanceAfter: formatAmount(balanceAfter, decimals),
    betId: bet.id,
    card,
    currentCard: result.currentCard,
    directions: [...availableDirections(result.currentCard)],
    lockedBalanceAfter: formatAmount(lockedBalanceAfter, decimals),
    multiplier: formatMultiplierBps(readCumulativeMultiplierBps(result)),
    payout: terminal ? formatAmount(bet.payout, decimals) : null,
    rounds: result.rounds,
    status: hiloStatus(bet.status),
    won,
  }
}

export async function getHiloActiveSeed(
  db: Db,
  config: AppConfig,
  userId: string,
) {
  const game = await requireHiloGame(db)
  return getOrCreateActiveSeed(db, config, userId, game.id)
}

export async function rotateHiloSeed(
  db: Db,
  config: AppConfig,
  userId: string,
) {
  const game = await requireHiloGame(db)
  return rotateSeed(db, config, userId, game.id)
}

export async function startHiloBet(
  db: Db,
  config: AppConfig,
  userId: string,
  input: HiloStartInput,
) {
  const [game, active] = await Promise.all([
    requireHiloGame(db),
    findCurrency(db, input.currency),
  ])
  const amount = parseAmount(input.amount, active.decimals)
  const requestHash = hashGameBetRequest(HILO_SLUG, {
    amount,
    clientSeed: input.clientSeed,
    currency: active.code,
  })
  const existing = await findGameBet(db, userId, input.idempotencyKey)
  const wallet = await ensureWallet(db, userId, active.code)
  if (existing) {
    assertIdempotentRequest(existing.requestHash, requestHash)
    const currentWallet = await db.query.wallet.findFirst({
      where: eq(schema.wallet.id, wallet.id),
    })
    if (!currentWallet) {
      throw httpErrors.notFound('Wallet not found')
    }
    return gameResponse(
      db,
      existing,
      currentWallet.balance,
      currentWallet.lockedBalance,
    )
  }

  assertBettingCurrency(active)
  const limits = await getBetLimits(db, config, game.id, active)
  assertBetAmount(amount, limits)
  const riskContext = {
    amount,
    currency: active.code,
    game: HILO_SLUG,
    idempotencyKey: input.idempotencyKey,
    userId,
  }

  try {
    const settlement = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`hilo:${userId}`}, 0))`,
      )
      const existingInTx = await tx.query.gameBet.findFirst({
        where: and(
          eq(schema.gameBet.userId, userId),
          eq(schema.gameBet.idempotencyKey, input.idempotencyKey),
        ),
      })
      if (existingInTx) {
        assertIdempotentRequest(existingInTx.requestHash, requestHash)
        const state = await walletState(tx, wallet.id)
        return {
          balanceAfter: state.balance,
          bet: existingInTx,
          lockedBalanceAfter: state.lockedBalance,
        }
      }

      const activeBet = await tx.query.gameBet.findFirst({
        where: and(
          eq(schema.gameBet.userId, userId),
          eq(schema.gameBet.gameId, game.id),
          eq(schema.gameBet.status, ACTIVE_STATUS),
        ),
      })
      if (activeBet) {
        throw httpErrors.conflict('You already have an active hilo game')
      }

      await assertBetAllowedInTransaction(tx, riskContext)
      const seed = await consumeNonce(tx, config, userId, game.id)
      const currentCard = drawHiloCard(
        seed.serverSeed,
        input.clientSeed,
        seed.nonce,
      )
      const betId = randomUUID()
      const locked = await lockInTransaction(tx, {
        amount,
        idempotencyKey: `${input.idempotencyKey}:lock`,
        reference: {
          referenceId: betId,
          referenceType: WALLET_REFERENCES.hiloBet,
        },
        walletId: wallet.id,
      })
      const [bet] = await tx
        .insert(schema.gameBet)
        .values({
          amount,
          clientSeed: input.clientSeed,
          currency: active.code,
          gameId: game.id,
          id: betId,
          idempotencyKey: input.idempotencyKey,
          nonce: seed.nonce,
          payout: 0n,
          requestHash,
          result: {
            cumulativeMultiplierBps: HILO_ONE_BPS,
            cumulativeMultiplierCenti: 100,
            currentCard,
            rounds: [{ card: currentCard, nonce: seed.nonce, type: 'deal' }],
          },
          seedId: seed.seedId,
          status: ACTIVE_STATUS,
          userId,
          walletId: wallet.id,
        })
        .returning()
      if (!bet || locked.lockedBalanceAfter === null) {
        throw new Error('Failed to start hilo bet')
      }

      await tx
        .insert(schema.userRecentGame)
        .values({ gameId: game.id, userId })
        .onConflictDoUpdate({
          set: { playedAt: new Date() },
          target: [schema.userRecentGame.userId, schema.userRecentGame.gameId],
        })

      return {
        balanceAfter: locked.balanceAfter,
        bet,
        lockedBalanceAfter: locked.lockedBalanceAfter,
      }
    })

    return gameResponse(
      db,
      settlement.bet,
      settlement.balanceAfter,
      settlement.lockedBalanceAfter,
    )
  } catch (error) {
    if (isRiskRejection(error)) {
      await recordBetRejected(db, riskContext, error.code)
    }
    throw error
  }
}

export async function getActiveHiloBet(db: Db, userId: string) {
  const game = await requireHiloGame(db)
  return db.transaction(async (tx) => {
    const bet = await tx.query.gameBet.findFirst({
      where: and(
        eq(schema.gameBet.userId, userId),
        eq(schema.gameBet.gameId, game.id),
        eq(schema.gameBet.status, ACTIVE_STATUS),
      ),
    })
    if (!bet) {
      return null
    }
    const state = await walletState(tx, bet.walletId)
    const result = HiloBetResultSchema.parse(bet.result)
    const seed = await getSeedById(db, bet.seedId)
    const active = await betCurrency(tx, bet.currency)
    return {
      amount: formatAmount(bet.amount, active.decimals),
      balanceAfter: formatAmount(state.balance, active.decimals),
      betId: bet.id,
      currency: bet.currency,
      currentCard: result.currentCard,
      directions: [...availableDirections(result.currentCard)],
      lockedBalanceAfter: formatAmount(state.lockedBalance, active.decimals),
      multiplier: formatMultiplierBps(readCumulativeMultiplierBps(result)),
      nextNonce: seed.nonce,
      rounds: result.rounds,
      serverSeedHash: seed.serverSeedHash,
      status: hiloStatus(bet.status),
    } satisfies HiloGameResponse
  })
}

export async function skipHiloCard(
  db: Db,
  config: AppConfig,
  userId: string,
  betId: string,
) {
  const game = await requireHiloGame(db)
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`hilo:${userId}`}, 0))`,
    )
    const [bet] = await tx
      .select()
      .from(schema.gameBet)
      .where(
        and(
          eq(schema.gameBet.id, betId),
          eq(schema.gameBet.userId, userId),
          eq(schema.gameBet.gameId, game.id),
        ),
      )
      .for('update')
    if (!bet) {
      throw httpErrors.notFound('Bet not found')
    }
    if (bet.status !== ACTIVE_STATUS) {
      throw httpErrors.badRequest('Game is not active')
    }

    const result = HiloBetResultSchema.parse(bet.result)
    if (result.rounds.length >= HILO_MAX_ROUNDS) {
      throw httpErrors.badRequest(
        `This game has reached its ${HILO_MAX_ROUNDS}-round limit; cash out to return your stake`,
      )
    }

    const seed = await consumeNonce(tx, config, userId, game.id)
    assertSameSeed(bet.seedId, seed.seedId)
    const card = drawHiloCard(seed.serverSeed, bet.clientSeed, seed.nonce)
    const updatedResult: HiloBetResult = {
      ...result,
      currentCard: card,
      rounds: [...result.rounds, { card, nonce: seed.nonce, type: 'skip' }],
    }
    const [updated] = await tx
      .update(schema.gameBet)
      .set({ result: updatedResult })
      .where(eq(schema.gameBet.id, bet.id))
      .returning()
    if (!updated) {
      throw new Error('Failed to skip hilo card')
    }
    const state = await walletState(tx, bet.walletId)
    const active = await betCurrency(tx, bet.currency)
    return {
      amount: formatAmount(bet.amount, active.decimals),
      balanceAfter: formatAmount(state.balance, active.decimals),
      betId: bet.id,
      currency: bet.currency,
      currentCard: card,
      directions: [...availableDirections(card)],
      lockedBalanceAfter: formatAmount(state.lockedBalance, active.decimals),
      multiplier: formatMultiplierBps(readCumulativeMultiplierBps(result)),
      nextNonce: seed.nonce + 1,
      rounds: updatedResult.rounds,
      serverSeedHash: seed.serverSeedHash,
      status: hiloStatus(bet.status),
    } satisfies HiloGameResponse
  })
}

export async function guessHiloCard(
  db: Db,
  config: AppConfig,
  userId: string,
  betId: string,
  direction: HiloDirection,
) {
  const game = await requireHiloGame(db)
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`hilo:${userId}`}, 0))`,
    )
    const [bet] = await tx
      .select()
      .from(schema.gameBet)
      .where(
        and(
          eq(schema.gameBet.id, betId),
          eq(schema.gameBet.userId, userId),
          eq(schema.gameBet.gameId, game.id),
        ),
      )
      .for('update')
    if (!bet) {
      throw httpErrors.notFound('Bet not found')
    }
    if (bet.status !== ACTIVE_STATUS) {
      throw httpErrors.badRequest('Game is not active')
    }

    const result = HiloBetResultSchema.parse(bet.result)
    if (result.rounds.length >= HILO_MAX_ROUNDS) {
      throw httpErrors.badRequest(
        `This game has reached its ${HILO_MAX_ROUNDS}-round limit; cash out to return your stake`,
      )
    }
    if (!isValidDirection(result.currentCard, direction)) {
      throw httpErrors.badRequest(
        `Direction ${direction} is not available for this card`,
      )
    }

    const seed = await consumeNonce(tx, config, userId, game.id)
    assertSameSeed(bet.seedId, seed.seedId)
    const nextCard = drawHiloCard(seed.serverSeed, bet.clientSeed, seed.nonce)
    const won = didWin(result.currentCard, nextCard, direction)
    const active = await betCurrency(tx, bet.currency)
    if (!won) {
      const updatedResult: HiloBetResult = {
        ...result,
        rounds: [
          ...result.rounds,
          {
            card: nextCard,
            currentCard: result.currentCard,
            direction,
            nonce: seed.nonce,
            type: 'guess' as const,
            won: false,
          },
        ],
      }
      const settled = await settleLockInTransaction(tx, {
        idempotencyKey: `${bet.idempotencyKey}:settle`,
        lockedAmount: bet.amount,
        payout: 0n,
        reference: {
          referenceId: bet.id,
          referenceType: WALLET_REFERENCES.hiloPayout,
        },
        walletId: bet.walletId,
      })
      const [updated] = await tx
        .update(schema.gameBet)
        .set({ payout: 0n, result: updatedResult, status: 'lost' })
        .where(eq(schema.gameBet.id, bet.id))
        .returning()
      if (!updated || settled.lockedBalanceAfter === null) {
        throw new Error('Failed to settle losing hilo bet')
      }
      return guessResponse(
        updated,
        updatedResult,
        false,
        nextCard,
        active.decimals,
        settled.balanceAfter,
        settled.lockedBalanceAfter,
      )
    }

    const stepBps = getHiloMultiplierBps(
      result.currentCard,
      direction,
      rtpBpsToHouseEdgeBps(clampRtpBps(game.rtp ?? DEFAULT_GAME_RTP_BPS)),
    )
    const cumulativeMultiplierBps = compoundHiloMultiplierBps(
      readCumulativeMultiplierBps(result),
      stepBps,
    )
    const updatedResult: HiloBetResult = {
      cumulativeMultiplierBps,
      cumulativeMultiplierCenti: bpsToCenti(cumulativeMultiplierBps),
      currentCard: nextCard,
      rounds: [
        ...result.rounds,
        {
          card: nextCard,
          currentCard: result.currentCard,
          direction,
          nonce: seed.nonce,
          type: 'guess' as const,
          won: true,
        },
      ],
    }
    const [updated] = await tx
      .update(schema.gameBet)
      .set({ result: updatedResult })
      .where(eq(schema.gameBet.id, bet.id))
      .returning()
    if (!updated) {
      throw new Error('Failed to update winning hilo bet')
    }
    const state = await walletState(tx, bet.walletId)
    return guessResponse(
      updated,
      updatedResult,
      true,
      nextCard,
      active.decimals,
      state.balance,
      state.lockedBalance,
    )
  })
}

export async function cashOutHiloBet(
  db: Db,
  config: AppConfig,
  userId: string,
  betId: string,
): Promise<HiloCashOutResponse> {
  const game = await requireHiloGame(db)
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`hilo:${userId}`}, 0))`,
    )
    const [bet] = await tx
      .select()
      .from(schema.gameBet)
      .where(
        and(
          eq(schema.gameBet.id, betId),
          eq(schema.gameBet.userId, userId),
          eq(schema.gameBet.gameId, game.id),
        ),
      )
      .for('update')
    if (!bet) {
      throw httpErrors.notFound('Bet not found')
    }
    if (bet.status !== ACTIVE_STATUS) {
      throw httpErrors.badRequest('Game is not active')
    }

    const result = HiloBetResultSchema.parse(bet.result)
    if (!canCashOutHilo(result)) {
      throw httpErrors.badRequest('Win at least one guess before cashing out')
    }

    const active = await betCurrency(tx, bet.currency)
    const limits = await getBetLimits(tx, config, game.id, active)
    const payout = capPayout(
      calculateHiloPayoutBps(bet.amount, readCumulativeMultiplierBps(result)),
      limits.maxPayout,
    )
    const settled = await settleLockInTransaction(tx, {
      idempotencyKey: `${bet.idempotencyKey}:settle`,
      lockedAmount: bet.amount,
      payout,
      reference: {
        referenceId: bet.id,
        referenceType: WALLET_REFERENCES.hiloPayout,
      },
      walletId: bet.walletId,
    })
    const [updated] = await tx
      .update(schema.gameBet)
      .set({ payout, status: 'cashed_out' })
      .where(eq(schema.gameBet.id, bet.id))
      .returning()
    if (!updated || settled.lockedBalanceAfter === null) {
      throw new Error('Failed to cash out hilo bet')
    }
    await recordBetPayoutInTransaction(
      tx,
      {
        amount: bet.amount,
        currency: bet.currency,
        game: HILO_SLUG,
        idempotencyKey: bet.idempotencyKey,
        userId,
      },
      payout,
    )

    return {
      balanceAfter: formatAmount(settled.balanceAfter, active.decimals),
      betId: bet.id,
      lockedBalanceAfter: formatAmount(
        settled.lockedBalanceAfter,
        active.decimals,
      ),
      multiplier: formatMultiplierBps(readCumulativeMultiplierBps(result)),
      payout: formatAmount(payout, active.decimals),
      rounds: result.rounds,
      status: 'cashed_out',
    }
  })
}

export async function listHiloBets(
  db: Db,
  userId: string,
  query: HiloHistoryFilters,
): Promise<HiloHistoryResponse> {
  const game = await requireHiloGame(db)
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
        throw new Error(`Currency missing for hilo bet ${bet.id}`)
      }
      const result = HiloBetResultSchema.parse(bet.result)
      return {
        amount: formatAmount(bet.amount, scale),
        clientSeed: bet.clientSeed,
        createdAt: bet.createdAt.toISOString(),
        currency: bet.currency,
        guesses: result.rounds.filter((round) => round.type === 'guess').length,
        id: bet.id,
        multiplier: formatMultiplierBps(readCumulativeMultiplierBps(result)),
        nonce: bet.nonce,
        payout: formatAmount(bet.payout, scale),
        rounds: result.rounds,
        status: hiloStatus(bet.status),
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

export async function verifyHiloBet(
  db: Db,
  config: AppConfig,
  userId: string,
  betId: string,
) {
  const game = await requireHiloGame(db)
  const bet = await db.query.gameBet.findFirst({
    where: and(
      eq(schema.gameBet.id, betId),
      eq(schema.gameBet.userId, userId),
      eq(schema.gameBet.gameId, game.id),
    ),
  })
  if (!bet) {
    throw httpErrors.notFound('Bet not found')
  }
  if (bet.status === ACTIVE_STATUS) {
    throw httpErrors.badRequest('Verification is available after the game ends')
  }

  const result = HiloBetResultSchema.parse(bet.result)
  const seed = await getSeedById(db, bet.seedId)
  const decryptedSeed = decryptSeed(seed.serverSeed, config)
  const expectedCards = result.rounds.map((round) =>
    drawHiloCard(decryptedSeed, bet.clientSeed, round.nonce),
  )
  const cards = result.rounds.map((round) => round.card)
  const base = {
    betId: bet.id,
    cards,
    clientSeed: bet.clientSeed,
    expectedCards,
    nonce: bet.nonce,
    serverSeedHash: seed.serverSeedHash,
    valid: cards.join(',') === expectedCards.join(','),
  }

  if (seed.status !== 'revealed') {
    return {
      ...base,
      message: 'Server seed is not revealed yet',
      serverSeed: null,
    }
  }

  return {
    ...base,
    message: 'Verification data is complete',
    serverSeed: decryptedSeed,
  }
}
