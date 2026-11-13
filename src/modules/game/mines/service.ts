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
import { formatMultiplierCenti } from '@/modules/game/util'
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

import { MinesBetResultSchema } from './schema'
import type {
  MinesHistoryFilters,
  MinesCashOutResponse,
  MinesStartRequest,
} from './schema'
import {
  calculateMinesMultiplierCenti,
  calculateMinesPayout,
  generateMinePositions,
  isMineTile,
  isMinesBoardCleared,
  MINES_GRID_SIZE,
} from './util'

const MINES_SLUG = 'mines'
const ACTIVE_STATUS = 'active'

interface MinesStartInput extends MinesStartRequest {
  idempotencyKey: string
}

type MinesStatus = 'active' | 'lost' | 'cashed_out'
type GameBetRow = typeof schema.gameBet.$inferSelect

function minesStatus(value: string): MinesStatus {
  if (value === 'active' || value === 'lost' || value === 'cashed_out') {
    return value
  }
  throw new Error(`Unsupported mines bet status: ${value}`)
}

async function requireMinesGame(db: Db) {
  const game = await db.query.game.findFirst({
    columns: { id: true, rtp: true },
    where: and(
      eq(schema.game.slug, MINES_SLUG),
      eq(schema.game.status, 'active'),
    ),
  })
  if (!game) {
    throw httpErrors.notFound('Mines game not found')
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
    throw new Error(`Currency missing for mines bet: ${code}`)
  }
  return active
}

async function startResponse(
  db: Db,
  bet: GameBetRow,
  balanceAfter: bigint,
  lockedBalanceAfter: bigint,
) {
  const result = MinesBetResultSchema.parse(bet.result)
  const seed = await getSeedById(db, bet.seedId)
  const active = await db.query.currency.findFirst({
    where: eq(schema.currency.code, bet.currency),
  })
  if (!active) {
    throw new Error(`Currency missing for mines bet: ${bet.currency}`)
  }

  return {
    amount: formatAmount(bet.amount, active.decimals),
    balanceAfter: formatAmount(balanceAfter, active.decimals),
    betId: bet.id,
    currency: bet.currency,
    gridSize: result.gridSize,
    lockedBalanceAfter: formatAmount(lockedBalanceAfter, active.decimals),
    minesCount: result.minesCount,
    multiplier: formatMultiplierCenti(result.multiplierCenti),
    nextNonce: seed.nonce,
    revealedTiles: result.revealedTiles,
    serverSeedHash: seed.serverSeedHash,
    status: minesStatus(bet.status),
  }
}

async function activeResponse(db: Db, tx: WalletTransaction, bet: GameBetRow) {
  const result = MinesBetResultSchema.parse(bet.result)
  const active = await betCurrency(tx, bet.currency)
  const wallet = await walletState(tx, bet.walletId)
  const seed = await getSeedById(db, bet.seedId)

  return {
    amount: formatAmount(bet.amount, active.decimals),
    balanceAfter: formatAmount(wallet.balance, active.decimals),
    betId: bet.id,
    currency: bet.currency,
    gridSize: result.gridSize,
    lockedBalanceAfter: formatAmount(wallet.lockedBalance, active.decimals),
    minesCount: result.minesCount,
    multiplier: formatMultiplierCenti(result.multiplierCenti),
    nextNonce: seed.nonce,
    revealedTiles: result.revealedTiles,
    serverSeedHash: seed.serverSeedHash,
    status: minesStatus(bet.status),
  }
}

function revealResponse(
  bet: GameBetRow,
  result: ReturnType<typeof MinesBetResultSchema.parse>,
  tileIndex: number,
  decimals: number,
  balanceAfter: bigint | null,
  lockedBalanceAfter: bigint | null,
) {
  const terminal = bet.status === 'lost' || bet.status === 'cashed_out'
  return {
    balanceAfter:
      balanceAfter === null ? null : formatAmount(balanceAfter, decimals),
    betId: bet.id,
    isMine: isMineTile(result.minePositions, tileIndex),
    lockedBalanceAfter:
      lockedBalanceAfter === null
        ? null
        : formatAmount(lockedBalanceAfter, decimals),
    minePositions: terminal ? result.minePositions : null,
    multiplier: formatMultiplierCenti(result.multiplierCenti),
    payout: terminal ? formatAmount(bet.payout, decimals) : null,
    revealedTiles: result.revealedTiles,
    status: minesStatus(bet.status),
    tileIndex,
  }
}

export async function getMinesActiveSeed(
  db: Db,
  config: AppConfig,
  userId: string,
) {
  const game = await requireMinesGame(db)
  return getOrCreateActiveSeed(db, config, userId, game.id)
}

export async function rotateMinesSeed(
  db: Db,
  config: AppConfig,
  userId: string,
) {
  const game = await requireMinesGame(db)
  return rotateSeed(db, config, userId, game.id)
}

export async function startMinesBet(
  db: Db,
  config: AppConfig,
  userId: string,
  input: MinesStartInput,
) {
  const [game, active] = await Promise.all([
    requireMinesGame(db),
    findCurrency(db, input.currency),
  ])
  const amount = parseAmount(input.amount, active.decimals)
  const requestHash = hashGameBetRequest(MINES_SLUG, {
    amount,
    clientSeed: input.clientSeed,
    currency: active.code,
    minesCount: input.minesCount,
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
    return startResponse(
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
    game: MINES_SLUG,
    idempotencyKey: input.idempotencyKey,
    userId,
  }

  try {
    const settlement = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`mines:${userId}`}, 0))`,
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
          replayed: true,
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
        throw httpErrors.conflict('You already have an active mines game')
      }

      await assertBetAllowedInTransaction(tx, riskContext)
      const seed = await consumeNonce(tx, config, userId, game.id)
      const minePositions = generateMinePositions(
        seed.serverSeed,
        input.clientSeed,
        seed.nonce,
        MINES_GRID_SIZE,
        input.minesCount,
      )
      const betId = randomUUID()
      const locked = await lockInTransaction(tx, {
        amount,
        idempotencyKey: `${input.idempotencyKey}:lock`,
        reference: {
          referenceId: betId,
          referenceType: WALLET_REFERENCES.minesBet,
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
            gridSize: MINES_GRID_SIZE,
            minePositions,
            minesCount: input.minesCount,
            multiplierCenti: 100,
            revealedTiles: [],
          },
          seedId: seed.seedId,
          status: ACTIVE_STATUS,
          userId,
          walletId: wallet.id,
        })
        .returning()
      if (!bet) {
        throw new Error('Failed to record mines bet')
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
        replayed: false,
      }
    })

    if (settlement.lockedBalanceAfter === null) {
      throw new Error('Mines lock did not return a locked balance')
    }
    return startResponse(
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

export async function getActiveMinesBet(db: Db, userId: string) {
  const game = await requireMinesGame(db)
  return db.transaction(async (tx) => {
    const bet = await tx.query.gameBet.findFirst({
      where: and(
        eq(schema.gameBet.userId, userId),
        eq(schema.gameBet.gameId, game.id),
        eq(schema.gameBet.status, ACTIVE_STATUS),
      ),
    })
    return bet ? activeResponse(db, tx, bet) : null
  })
}

export async function revealMinesTile(
  db: Db,
  config: AppConfig,
  userId: string,
  betId: string,
  tileIndex: number,
) {
  const game = await requireMinesGame(db)
  return db.transaction(async (tx) => {
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

    const result = MinesBetResultSchema.parse(bet.result)
    const active = await betCurrency(tx, bet.currency)
    if (result.revealedTiles.includes(tileIndex)) {
      const wallet = await walletState(tx, bet.walletId)
      return revealResponse(
        bet,
        result,
        tileIndex,
        active.decimals,
        wallet.balance,
        wallet.lockedBalance,
      )
    }

    const mine = isMineTile(result.minePositions, tileIndex)
    if (mine) {
      const updatedResult = {
        ...result,
        multiplierCenti: 100,
        revealedTiles: [...result.revealedTiles, tileIndex],
      }
      const settled = await settleLockInTransaction(tx, {
        idempotencyKey: `${bet.idempotencyKey}:settle`,
        lockedAmount: bet.amount,
        payout: 0n,
        reference: {
          referenceId: bet.id,
          referenceType: WALLET_REFERENCES.minesPayout,
        },
        walletId: bet.walletId,
      })
      const [updated] = await tx
        .update(schema.gameBet)
        .set({ payout: 0n, result: updatedResult, status: 'lost' })
        .where(eq(schema.gameBet.id, bet.id))
        .returning()
      if (!updated || settled.lockedBalanceAfter === null) {
        throw new Error('Failed to settle losing mines bet')
      }
      return revealResponse(
        updated,
        updatedResult,
        tileIndex,
        active.decimals,
        settled.balanceAfter,
        settled.lockedBalanceAfter,
      )
    }

    const revealedTiles = [...result.revealedTiles, tileIndex]
    const multiplierCenti = calculateMinesMultiplierCenti(
      result.gridSize,
      result.minesCount,
      revealedTiles.length,
      rtpBpsToHouseEdgeBps(clampRtpBps(game.rtp ?? DEFAULT_GAME_RTP_BPS)),
    )
    const updatedResult = { ...result, multiplierCenti, revealedTiles }

    if (
      isMinesBoardCleared(
        result.gridSize,
        result.minesCount,
        revealedTiles.length,
      )
    ) {
      const limits = await getBetLimits(tx, config, game.id, active)
      const payout = capPayout(
        calculateMinesPayout(bet.amount, multiplierCenti),
        limits.maxPayout,
      )
      const settled = await settleLockInTransaction(tx, {
        idempotencyKey: `${bet.idempotencyKey}:settle`,
        lockedAmount: bet.amount,
        payout,
        reference: {
          referenceId: bet.id,
          referenceType: WALLET_REFERENCES.minesPayout,
        },
        walletId: bet.walletId,
      })
      const [updated] = await tx
        .update(schema.gameBet)
        .set({ payout, result: updatedResult, status: 'cashed_out' })
        .where(eq(schema.gameBet.id, bet.id))
        .returning()
      if (!updated || settled.lockedBalanceAfter === null) {
        throw new Error('Failed to settle cleared mines bet')
      }
      await recordBetPayoutInTransaction(
        tx,
        {
          amount: bet.amount,
          currency: bet.currency,
          game: MINES_SLUG,
          idempotencyKey: bet.idempotencyKey,
          userId,
        },
        payout,
      )
      return revealResponse(
        updated,
        updatedResult,
        tileIndex,
        active.decimals,
        settled.balanceAfter,
        settled.lockedBalanceAfter,
      )
    }

    const [updated] = await tx
      .update(schema.gameBet)
      .set({ result: updatedResult })
      .where(eq(schema.gameBet.id, bet.id))
      .returning()
    if (!updated) {
      throw new Error('Failed to update mines bet')
    }
    const wallet = await walletState(tx, bet.walletId)
    return revealResponse(
      updated,
      updatedResult,
      tileIndex,
      active.decimals,
      wallet.balance,
      wallet.lockedBalance,
    )
  })
}

export async function cashOutMinesBet(
  db: Db,
  config: AppConfig,
  userId: string,
  betId: string,
): Promise<MinesCashOutResponse> {
  const game = await requireMinesGame(db)
  return db.transaction(async (tx) => {
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

    const result = MinesBetResultSchema.parse(bet.result)
    if (result.revealedTiles.length === 0) {
      throw httpErrors.badRequest(
        'Reveal at least one safe tile before cashout',
      )
    }

    const active = await betCurrency(tx, bet.currency)
    const limits = await getBetLimits(tx, config, game.id, active)
    const payout = capPayout(
      calculateMinesPayout(bet.amount, result.multiplierCenti),
      limits.maxPayout,
    )
    const settled = await settleLockInTransaction(tx, {
      idempotencyKey: `${bet.idempotencyKey}:settle`,
      lockedAmount: bet.amount,
      payout,
      reference: {
        referenceId: bet.id,
        referenceType: WALLET_REFERENCES.minesPayout,
      },
      walletId: bet.walletId,
    })
    const [updated] = await tx
      .update(schema.gameBet)
      .set({ payout, status: 'cashed_out' })
      .where(eq(schema.gameBet.id, bet.id))
      .returning()
    if (!updated || settled.lockedBalanceAfter === null) {
      throw new Error('Failed to cash out mines bet')
    }
    await recordBetPayoutInTransaction(
      tx,
      {
        amount: bet.amount,
        currency: bet.currency,
        game: MINES_SLUG,
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
      minePositions: result.minePositions,
      multiplier: formatMultiplierCenti(result.multiplierCenti),
      payout: formatAmount(payout, active.decimals),
      status: 'cashed_out',
    }
  })
}

export async function listMinesBets(
  db: Db,
  userId: string,
  query: MinesHistoryFilters,
) {
  const game = await requireMinesGame(db)
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
        throw new Error(`Currency missing for mines bet ${bet.id}`)
      }
      const result = MinesBetResultSchema.parse(bet.result)
      return {
        amount: formatAmount(bet.amount, scale),
        clientSeed: bet.clientSeed,
        createdAt: bet.createdAt.toISOString(),
        currency: bet.currency,
        id: bet.id,
        minePositions: bet.status === 'active' ? null : result.minePositions,
        minesCount: result.minesCount,
        multiplier: formatMultiplierCenti(result.multiplierCenti),
        nonce: bet.nonce,
        payout: formatAmount(bet.payout, scale),
        revealedCount: result.revealedTiles.length,
        status: minesStatus(bet.status),
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

export async function verifyMinesBet(
  db: Db,
  config: AppConfig,
  userId: string,
  betId: string,
) {
  const game = await requireMinesGame(db)
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

  const result = MinesBetResultSchema.parse(bet.result)
  const seed = await getSeedById(db, bet.seedId)
  const expectedMinePositions = generateMinePositions(
    decryptSeed(seed.serverSeed, config),
    bet.clientSeed,
    bet.nonce,
    result.gridSize,
    result.minesCount,
  )
  const base = {
    betId: bet.id,
    clientSeed: bet.clientSeed,
    expectedMinePositions,
    minePositions: result.minePositions,
    nonce: bet.nonce,
    serverSeedHash: seed.serverSeedHash,
    valid: expectedMinePositions.join(',') === result.minePositions.join(','),
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
    serverSeed: decryptSeed(seed.serverSeed, config),
  }
}
