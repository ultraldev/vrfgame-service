import { httpErrors } from '@fastify/sensible'
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import type { AppConfig } from '@/lib/config'
import { currency as findCurrency } from '@/lib/currency'
import { decodeCursor, encodeCursor } from '@/lib/cursor'
import { formatAmount, parseAmount } from '@/lib/money'
import { decryptSeed } from '@/lib/seed-cipher'
import { hashGameBetRequest, placeSingleShotBet } from '@/modules/game/bets'
import {
  getOrCreateActiveSeed,
  getSeedById,
  roll,
  rotateSeed,
} from '@/modules/game/fairness'
import {
  clampRtpBps,
  DEFAULT_GAME_RTP_BPS,
  rtpBpsToHouseEdgeBps,
} from '@/modules/game/rtp'
import { WALLET_REFERENCES } from '@/modules/wallet/util'

import { DiceBetResultSchema } from './schema'
import type {
  DiceBetRequest,
  DiceBetResponse,
  DiceHistoryFilters,
} from './schema'
import {
  calculateDiceOutcome,
  calculateDicePayout,
  formatRoll,
  isWinningPayout,
} from './util'

const DICE_SLUG = 'dice'
const BET_SETTLED_STATUS = 'settled'

interface DiceBetInput extends DiceBetRequest {
  idempotencyKey: string
}

async function requireDiceGame(db: Db) {
  const game = await db.query.game.findFirst({
    columns: { id: true, rtp: true },
    where: and(
      eq(schema.game.slug, DICE_SLUG),
      eq(schema.game.status, 'active'),
    ),
  })
  if (!game) {
    throw httpErrors.notFound('Dice game not found')
  }
  return game
}

function betResponse(
  bet: typeof schema.gameBet.$inferSelect,
  decimals: number,
  balanceAfter?: bigint,
): DiceBetResponse {
  if (bet.status !== BET_SETTLED_STATUS) {
    throw new Error(`Unsupported dice bet status: ${bet.status}`)
  }

  const result = DiceBetResultSchema.parse(bet.result)
  return {
    amount: formatAmount(bet.amount, decimals),
    balanceAfter:
      balanceAfter === undefined ? null : formatAmount(balanceAfter, decimals),
    clientSeed: bet.clientSeed,
    createdAt: bet.createdAt.toISOString(),
    currency: bet.currency,
    direction: result.direction,
    id: bet.id,
    nonce: bet.nonce,
    outcomeMatched: result.outcomeMatched,
    payout: formatAmount(bet.payout, decimals),
    roll: formatRoll(result.roll),
    status: 'settled',
    target: result.target,
    won: isWinningPayout(bet.amount, bet.payout),
  }
}

export async function getDiceActiveSeed(
  db: Db,
  config: AppConfig,
  userId: string,
) {
  const game = await requireDiceGame(db)
  return getOrCreateActiveSeed(db, config, userId, game.id)
}

export async function rotateDiceSeed(
  db: Db,
  config: AppConfig,
  userId: string,
) {
  const game = await requireDiceGame(db)
  return rotateSeed(db, config, userId, game.id)
}

export async function placeDiceBet(
  db: Db,
  config: AppConfig,
  userId: string,
  input: DiceBetInput,
) {
  const [game, active] = await Promise.all([
    requireDiceGame(db),
    findCurrency(db, input.currency),
  ])
  const amount = parseAmount(input.amount, active.decimals)
  const requestHash = hashGameBetRequest(DICE_SLUG, {
    amount,
    clientSeed: input.clientSeed,
    currency: active.code,
    direction: input.direction,
    target: input.target,
  })
  const settlement = await placeSingleShotBet({
    active,
    amount,
    clientSeed: input.clientSeed,
    config,
    createResult: (seed) => {
      const outcomeRoll = roll(seed.serverSeed, input.clientSeed, seed.nonce)
      const outcomeMatched = calculateDiceOutcome(
        input.direction,
        input.target,
        outcomeRoll,
      )
      const rtpBps = clampRtpBps(game.rtp ?? DEFAULT_GAME_RTP_BPS)
      const houseEdgeBps = BigInt(rtpBpsToHouseEdgeBps(rtpBps))
      const payout = outcomeMatched
        ? calculateDicePayout(
            amount,
            input.direction,
            input.target,
            houseEdgeBps,
          )
        : 0n

      return {
        payout,
        result: {
          direction: input.direction,
          outcomeMatched,
          roll: outcomeRoll,
          target: input.target,
        },
      }
    },
    db,
    game,
    gameSlug: DICE_SLUG,
    idempotencyKey: input.idempotencyKey,
    referenceTypes: {
      bet: WALLET_REFERENCES.diceBet,
      payout: WALLET_REFERENCES.dicePayout,
    },
    requestHash,
    userId,
  })

  return betResponse(
    settlement.bet,
    active.decimals,
    settlement.balanceAfter ?? undefined,
  )
}

export async function listDiceBets(
  db: Db,
  userId: string,
  query: DiceHistoryFilters,
) {
  const game = await requireDiceGame(db)
  const filters: SQL[] = [
    eq(schema.gameBet.userId, userId),
    eq(schema.gameBet.gameId, game.id),
    eq(schema.gameBet.status, BET_SETTLED_STATUS),
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
    currencies.map((active) => [active.code, active.decimals]),
  )
  const last = page.at(-1)

  return {
    items: page.map((bet) => {
      const scale = decimals.get(bet.currency)
      if (scale === undefined) {
        throw new Error(`Currency missing for dice bet ${bet.id}`)
      }
      return betResponse(bet, scale)
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

export async function verifyDiceBet(
  db: Db,
  config: AppConfig,
  userId: string,
  betId: string,
) {
  const game = await requireDiceGame(db)
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

  const result = DiceBetResultSchema.parse(bet.result)
  const seed = await getSeedById(db, bet.seedId)
  const expectedRoll = roll(
    decryptSeed(seed.serverSeed, config),
    bet.clientSeed,
    bet.nonce,
  )
  const valid = expectedRoll === result.roll
  const base = {
    betId: bet.id,
    clientSeed: bet.clientSeed,
    expectedRoll: formatRoll(expectedRoll),
    nonce: bet.nonce,
    roll: formatRoll(result.roll),
    serverSeedHash: seed.serverSeedHash,
    valid,
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
