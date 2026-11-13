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
  rotateSeed,
} from '@/modules/game/fairness'
import { clampRtpBps, DEFAULT_GAME_RTP_BPS } from '@/modules/game/rtp'
import { multiplierDetails } from '@/modules/game/util'
import { WALLET_REFERENCES } from '@/modules/wallet/util'

import { WheelBetResultSchema } from './schema'
import type {
  WheelBetRequest,
  WheelBetResponse,
  WheelHistoryFilters,
} from './schema'
import {
  calculateWheelPayout,
  generateWheelSegment,
  getWheelMultiplierCenti,
} from './util'

const WHEEL_SLUG = 'wheel'
const BET_SETTLED_STATUS = 'settled'

interface WheelBetInput extends WheelBetRequest {
  idempotencyKey: string
}

async function requireWheelGame(db: Db) {
  const game = await db.query.game.findFirst({
    columns: { id: true, rtp: true },
    where: and(
      eq(schema.game.slug, WHEEL_SLUG),
      eq(schema.game.status, 'active'),
    ),
  })
  if (!game) {
    throw httpErrors.notFound('Wheel game not found')
  }
  return game
}

function betResponse(
  bet: typeof schema.gameBet.$inferSelect,
  decimals: number,
  balanceAfter?: bigint,
): WheelBetResponse {
  if (bet.status !== BET_SETTLED_STATUS) {
    throw new Error(`Unsupported wheel bet status: ${bet.status}`)
  }

  const result = WheelBetResultSchema.parse(bet.result)
  return {
    amount: formatAmount(bet.amount, decimals),
    balanceAfter:
      balanceAfter === undefined ? null : formatAmount(balanceAfter, decimals),
    clientSeed: bet.clientSeed,
    createdAt: bet.createdAt.toISOString(),
    currency: bet.currency,
    id: bet.id,
    nonce: bet.nonce,
    payout: formatAmount(bet.payout, decimals),
    risk: result.risk,
    segmentIndex: result.segmentIndex,
    segments: result.segments,
    status: 'settled',
    won: bet.payout > bet.amount,
    ...multiplierDetails(bet.amount, bet.payout, result.multiplierCenti),
  }
}

export async function getWheelActiveSeed(
  db: Db,
  config: AppConfig,
  userId: string,
) {
  const game = await requireWheelGame(db)
  return getOrCreateActiveSeed(db, config, userId, game.id)
}

export async function rotateWheelSeed(
  db: Db,
  config: AppConfig,
  userId: string,
) {
  const game = await requireWheelGame(db)
  return rotateSeed(db, config, userId, game.id)
}

export async function placeWheelBet(
  db: Db,
  config: AppConfig,
  userId: string,
  input: WheelBetInput,
) {
  const [game, active] = await Promise.all([
    requireWheelGame(db),
    findCurrency(db, input.currency),
  ])
  const amount = parseAmount(input.amount, active.decimals)
  const requestHash = hashGameBetRequest(WHEEL_SLUG, {
    amount,
    clientSeed: input.clientSeed,
    currency: active.code,
    risk: input.risk,
    segments: input.segments,
  })
  const settlement = await placeSingleShotBet({
    active,
    amount,
    clientSeed: input.clientSeed,
    config,
    createResult: (seed) => {
      const segmentIndex = generateWheelSegment(
        seed.serverSeed,
        input.clientSeed,
        seed.nonce,
        input.segments,
      )
      const multiplierCenti = getWheelMultiplierCenti(
        input.segments,
        input.risk,
        segmentIndex,
        clampRtpBps(game.rtp ?? DEFAULT_GAME_RTP_BPS),
      )

      return {
        payout: calculateWheelPayout(amount, multiplierCenti),
        result: {
          multiplierCenti,
          risk: input.risk,
          segmentIndex,
          segments: input.segments,
        },
      }
    },
    db,
    game,
    gameSlug: WHEEL_SLUG,
    idempotencyKey: input.idempotencyKey,
    referenceTypes: {
      bet: WALLET_REFERENCES.wheelBet,
      payout: WALLET_REFERENCES.wheelPayout,
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

export async function listWheelBets(
  db: Db,
  userId: string,
  query: WheelHistoryFilters,
) {
  const game = await requireWheelGame(db)
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
    currencies.map((currency) => [currency.code, currency.decimals]),
  )
  const last = page.at(-1)

  return {
    items: page.map((bet) => {
      const scale = decimals.get(bet.currency)
      if (scale === undefined) {
        throw new Error(`Currency missing for wheel bet ${bet.id}`)
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

export async function verifyWheelBet(
  db: Db,
  config: AppConfig,
  userId: string,
  betId: string,
) {
  const game = await requireWheelGame(db)
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

  const result = WheelBetResultSchema.parse(bet.result)
  const seed = await getSeedById(db, bet.seedId)
  const expectedSegmentIndex = generateWheelSegment(
    decryptSeed(seed.serverSeed, config),
    bet.clientSeed,
    bet.nonce,
    result.segments,
  )
  const base = {
    betId: bet.id,
    clientSeed: bet.clientSeed,
    expectedSegmentIndex,
    nonce: bet.nonce,
    risk: result.risk,
    segmentIndex: result.segmentIndex,
    segments: result.segments,
    serverSeedHash: seed.serverSeedHash,
    valid: expectedSegmentIndex === result.segmentIndex,
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
