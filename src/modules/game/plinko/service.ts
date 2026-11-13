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
import { multiplierDetails } from '@/modules/game/util'
import { WALLET_REFERENCES } from '@/modules/wallet/util'

import { PlinkoBetResultSchema } from './schema'
import type {
  PlinkoBetRequest,
  PlinkoBetResponse,
  PlinkoHistoryFilters,
} from './schema'
import {
  calculatePlinkoPayout,
  generatePlinkoPath,
  getPlinkoMultiplierCenti,
  plinkoSlotIndex,
} from './util'

const PLINKO_SLUG = 'plinko'
const BET_SETTLED_STATUS = 'settled'

interface PlinkoBetInput extends PlinkoBetRequest {
  idempotencyKey: string
}

async function requirePlinkoGame(db: Db) {
  const game = await db.query.game.findFirst({
    columns: { id: true, rtp: true },
    where: and(
      eq(schema.game.slug, PLINKO_SLUG),
      eq(schema.game.status, 'active'),
    ),
  })
  if (!game) {
    throw httpErrors.notFound('Plinko game not found')
  }
  return game
}

function betResponse(
  bet: typeof schema.gameBet.$inferSelect,
  decimals: number,
  balanceAfter?: bigint,
): PlinkoBetResponse {
  if (bet.status !== BET_SETTLED_STATUS) {
    throw new Error(`Unsupported plinko bet status: ${bet.status}`)
  }

  const result = PlinkoBetResultSchema.parse(bet.result)
  return {
    amount: formatAmount(bet.amount, decimals),
    balanceAfter:
      balanceAfter === undefined ? null : formatAmount(balanceAfter, decimals),
    clientSeed: bet.clientSeed,
    createdAt: bet.createdAt.toISOString(),
    currency: bet.currency,
    id: bet.id,
    nonce: bet.nonce,
    path: result.path,
    payout: formatAmount(bet.payout, decimals),
    risk: result.risk,
    rows: result.rows,
    slotIndex: result.slotIndex,
    status: 'settled',
    won: bet.payout > bet.amount,
    ...multiplierDetails(bet.amount, bet.payout, result.multiplierCenti),
  }
}

export async function getPlinkoActiveSeed(
  db: Db,
  config: AppConfig,
  userId: string,
) {
  const game = await requirePlinkoGame(db)
  return getOrCreateActiveSeed(db, config, userId, game.id)
}

export async function rotatePlinkoSeed(
  db: Db,
  config: AppConfig,
  userId: string,
) {
  const game = await requirePlinkoGame(db)
  return rotateSeed(db, config, userId, game.id)
}

export async function placePlinkoBet(
  db: Db,
  config: AppConfig,
  userId: string,
  input: PlinkoBetInput,
) {
  const [game, active] = await Promise.all([
    requirePlinkoGame(db),
    findCurrency(db, input.currency),
  ])
  const amount = parseAmount(input.amount, active.decimals)
  const requestHash = hashGameBetRequest(PLINKO_SLUG, {
    amount,
    clientSeed: input.clientSeed,
    currency: active.code,
    risk: input.risk,
    rows: input.rows,
  })
  const settlement = await placeSingleShotBet({
    active,
    amount,
    clientSeed: input.clientSeed,
    config,
    createResult: (seed) => {
      const path = generatePlinkoPath(
        seed.serverSeed,
        input.clientSeed,
        seed.nonce,
        input.rows,
      )
      const slotIndex = plinkoSlotIndex(path)
      const multiplierCenti = getPlinkoMultiplierCenti(
        input.rows,
        input.risk,
        slotIndex,
      )

      return {
        payout: calculatePlinkoPayout(amount, multiplierCenti),
        result: {
          multiplierCenti,
          path,
          risk: input.risk,
          rows: input.rows,
          slotIndex,
        },
      }
    },
    db,
    game,
    gameSlug: PLINKO_SLUG,
    idempotencyKey: input.idempotencyKey,
    referenceTypes: {
      bet: WALLET_REFERENCES.plinkoBet,
      payout: WALLET_REFERENCES.plinkoPayout,
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

export async function listPlinkoBets(
  db: Db,
  userId: string,
  query: PlinkoHistoryFilters,
) {
  const game = await requirePlinkoGame(db)
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
        throw new Error(`Currency missing for plinko bet ${bet.id}`)
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

export async function verifyPlinkoBet(
  db: Db,
  config: AppConfig,
  userId: string,
  betId: string,
) {
  const game = await requirePlinkoGame(db)
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

  const result = PlinkoBetResultSchema.parse(bet.result)
  const seed = await getSeedById(db, bet.seedId)
  const expectedPath = generatePlinkoPath(
    decryptSeed(seed.serverSeed, config),
    bet.clientSeed,
    bet.nonce,
    result.rows,
  )
  const expectedSlotIndex = plinkoSlotIndex(expectedPath)
  const base = {
    betId: bet.id,
    clientSeed: bet.clientSeed,
    expectedPath,
    expectedSlotIndex,
    nonce: bet.nonce,
    path: result.path,
    serverSeedHash: seed.serverSeedHash,
    slotIndex: result.slotIndex,
    valid:
      expectedPath.join('') === result.path.join('') &&
      expectedSlotIndex === result.slotIndex,
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
