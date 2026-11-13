import { httpErrors } from '@fastify/sensible'
import { and, eq } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import type { AppConfig } from '@/lib/config'
import { parseAmount } from '@/lib/money'

const DEFAULT_MIN_BET = '0.01'
const DEFAULT_MAX_BET = '1000000'

export interface BetLimits {
  maxBet: bigint
  maxPayout: bigint | null
  minBet: bigint
}

export function assertBettingCurrency(
  active: typeof schema.currency.$inferSelect,
) {
  if (!active.enabled || !active.bettingEnabled || !active.walletEnabled) {
    throw httpErrors.badRequest(
      `Currency does not support betting: ${active.code}`,
    )
  }
}

function configuredAmount(value: string, decimals: number, name: string) {
  try {
    return parseAmount(value, decimals)
  } catch {
    throw Object.assign(
      new Error(
        `${name} is not valid for a currency with ${decimals} decimals`,
      ),
      { statusCode: 503 },
    )
  }
}

function assertValidBetLimits(limits: BetLimits) {
  const { maxBet, maxPayout, minBet } = limits
  if (minBet <= 0n || maxBet < minBet) {
    throw Object.assign(new Error('Invalid configured bet limits'), {
      statusCode: 503,
    })
  }
  if (maxPayout !== null && maxPayout <= 0n) {
    throw Object.assign(new Error('Invalid configured payout limit'), {
      statusCode: 503,
    })
  }
}

export function getDefaultBetLimits(
  config: AppConfig,
  activeCurrency: typeof schema.currency.$inferSelect,
) {
  const { decimals } = activeCurrency
  const minBet = configuredAmount(
    config.BET_MIN_AMOUNT ?? DEFAULT_MIN_BET,
    decimals,
    'BET_MIN_AMOUNT',
  )
  const maxBet = configuredAmount(
    config.BET_MAX_AMOUNT ?? DEFAULT_MAX_BET,
    decimals,
    'BET_MAX_AMOUNT',
  )
  const maxPayout = config.PAYOUT_MAX_AMOUNT
    ? configuredAmount(config.PAYOUT_MAX_AMOUNT, decimals, 'PAYOUT_MAX_AMOUNT')
    : null

  const limits = { maxBet, maxPayout, minBet }
  assertValidBetLimits(limits)
  return limits
}

export async function getBetLimits(
  db: Pick<Db, 'query'>,
  config: AppConfig,
  gameId: string,
  activeCurrency: typeof schema.currency.$inferSelect,
) {
  const row = await db.query.gameRiskLimit.findFirst({
    where: and(
      eq(schema.gameRiskLimit.gameId, gameId),
      eq(schema.gameRiskLimit.currency, activeCurrency.code),
      eq(schema.gameRiskLimit.enabled, true),
    ),
  })
  if (row) {
    const limits = {
      maxBet: row.maxBet,
      maxPayout: row.maxPayout,
      minBet: row.minBet,
    }
    assertValidBetLimits(limits)
    return limits
  }

  return getDefaultBetLimits(config, activeCurrency)
}

export function assertBetAmount(amount: bigint, limits: BetLimits) {
  if (amount < limits.minBet || amount > limits.maxBet) {
    throw Object.assign(new Error('Bet amount is outside configured limits'), {
      statusCode: 400,
    })
  }
}

export function capPayout(payout: bigint, maxPayout: bigint | null) {
  return maxPayout !== null && payout > maxPayout ? maxPayout : payout
}
