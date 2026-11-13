import { randomUUID } from 'node:crypto'

import { httpErrors } from '@fastify/sensible'
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import { currency as findCurrency } from '@/lib/currency'
import { formatAmount, parseAmount } from '@/lib/money'
import type { WalletTransaction } from '@/modules/wallet/ledger'

import type { CreateExclusionInput, UpdateLimitsInput } from './schema'
import { dayBucket, riskRejected, weekBucket } from './util'
import type { BetLimitKey, RiskRuleCode } from './util'

const USER_LIMIT_SOURCE = 'user'

type UserRiskLimitRow = typeof schema.userRiskLimit.$inferSelect
type ExclusionType = CreateExclusionInput['type']

function exclusionType(value: string): ExclusionType {
  if (value === 'self_exclusion' || value === 'cooling_off') {
    return value
  }
  throw new Error(`Unsupported exclusion type: ${value}`)
}

function limitResponse(row: UserRiskLimitRow, decimals: number) {
  function format(value: bigint | null) {
    return value === null ? null : formatAmount(value, decimals)
  }

  return {
    currency: row.currency,
    limits: {
      dailyBetCap: format(row.dailyBetCap),
      dailyLossCap: format(row.dailyLossCap),
      singleBetCap: format(row.singleBetCap),
      weeklyBetCap: format(row.weeklyBetCap),
      weeklyLossCap: format(row.weeklyLossCap),
    },
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function incrementCounter(
  tx: WalletTransaction,
  userId: string,
  currency: string,
  window: 'day' | 'week',
  bucket: string,
  wagered: bigint,
  payout: bigint,
) {
  const [counter] = await tx
    .insert(schema.userBetCounter)
    .values({
      bucket,
      currency,
      payout,
      userId,
      wagered,
      window,
    })
    .onConflictDoUpdate({
      set: {
        payout: sql`${schema.userBetCounter.payout} + ${payout}`,
        updatedAt: new Date(),
        wagered: sql`${schema.userBetCounter.wagered} + ${wagered}`,
      },
      target: [
        schema.userBetCounter.userId,
        schema.userBetCounter.currency,
        schema.userBetCounter.window,
        schema.userBetCounter.bucket,
      ],
    })
    .returning()
  if (!counter) {
    throw new Error('Failed to update risk counter')
  }
  return counter
}

export function createExclusion(
  db: Db,
  userId: string,
  input: CreateExclusionInput,
) {
  const now = new Date()
  let expiresAt: Date | null = null
  if (input.type === 'self_exclusion') {
    if (input.durationDays) {
      expiresAt = new Date(now.getTime() + input.durationDays * 86_400_000)
    }
  } else {
    expiresAt = new Date(now.getTime() + input.durationHours * 3_600_000)
  }

  return db.transaction(async (tx) => {
    await tx
      .update(schema.userExclusion)
      .set({ active: false })
      .where(
        and(
          eq(schema.userExclusion.userId, userId),
          eq(schema.userExclusion.type, input.type),
          eq(schema.userExclusion.active, true),
          isNotNull(schema.userExclusion.expiresAt),
          lte(schema.userExclusion.expiresAt, now),
        ),
      )

    const existing = await tx.query.userExclusion.findFirst({
      where: and(
        eq(schema.userExclusion.userId, userId),
        eq(schema.userExclusion.type, input.type),
        eq(schema.userExclusion.active, true),
        or(
          isNull(schema.userExclusion.expiresAt),
          gt(schema.userExclusion.expiresAt, now),
        ),
      ),
    })
    if (existing) {
      throw httpErrors.conflict(`An active ${input.type} already exists`)
    }

    const [created] = await tx
      .insert(schema.userExclusion)
      .values({
        active: true,
        expiresAt,
        id: randomUUID(),
        startsAt: now,
        type: input.type,
        userId,
      })
      .returning()
    if (!created) {
      throw new Error('Failed to create exclusion')
    }

    return {
      expiresAt: created.expiresAt?.toISOString() ?? null,
      id: created.id,
      startsAt: created.startsAt.toISOString(),
      type: exclusionType(created.type),
    }
  })
}

export async function listExclusions(db: Db, userId: string) {
  const now = new Date()
  const rows = await db.query.userExclusion.findMany({
    orderBy: [asc(schema.userExclusion.createdAt)],
    where: and(
      eq(schema.userExclusion.userId, userId),
      eq(schema.userExclusion.active, true),
      lte(schema.userExclusion.startsAt, now),
      or(
        isNull(schema.userExclusion.expiresAt),
        gt(schema.userExclusion.expiresAt, now),
      ),
    ),
  })

  return {
    items: rows.map((row) => ({
      expiresAt: row.expiresAt?.toISOString() ?? null,
      id: row.id,
      startsAt: row.startsAt.toISOString(),
      type: exclusionType(row.type),
    })),
  }
}

export async function listLimits(db: Db, userId: string) {
  const rows = await db.query.userRiskLimit.findMany({
    orderBy: [asc(schema.userRiskLimit.currency)],
    where: and(
      eq(schema.userRiskLimit.userId, userId),
      eq(schema.userRiskLimit.source, USER_LIMIT_SOURCE),
    ),
  })
  if (rows.length === 0) {
    return { items: [] }
  }

  const currencies = await db
    .select()
    .from(schema.currency)
    .where(
      inArray(
        schema.currency.code,
        rows.map((row) => row.currency),
      ),
    )
  const decimals = new Map(
    currencies.map((currency) => [currency.code, currency.decimals]),
  )

  return {
    items: rows.map((row) => {
      const scale = decimals.get(row.currency)
      if (scale === undefined) {
        throw new Error(`Currency missing for risk limits: ${row.currency}`)
      }
      return limitResponse(row, scale)
    }),
  }
}

export async function updateLimits(
  db: Db,
  userId: string,
  input: UpdateLimitsInput,
) {
  const currency = await findCurrency(db, input.currency)
  if (!currency.enabled) {
    throw httpErrors.badRequest(`Currency is disabled: ${currency.code}`)
  }

  const existing = await db.query.userRiskLimit.findFirst({
    where: and(
      eq(schema.userRiskLimit.userId, userId),
      eq(schema.userRiskLimit.currency, currency.code),
      eq(schema.userRiskLimit.source, USER_LIMIT_SOURCE),
    ),
  })
  function parseLimit(key: BetLimitKey) {
    const value = input[key]
    if (value === undefined) {
      return existing?.[key] ?? null
    }
    if (value === null) {
      return null
    }
    const parsed = parseAmount(value, currency.decimals)
    if (parsed <= 0n) {
      throw httpErrors.badRequest(`${key} must be positive`)
    }
    return parsed
  }
  const next = {
    dailyBetCap: parseLimit('dailyBetCap'),
    dailyLossCap: parseLimit('dailyLossCap'),
    singleBetCap: parseLimit('singleBetCap'),
    weeklyBetCap: parseLimit('weeklyBetCap'),
    weeklyLossCap: parseLimit('weeklyLossCap'),
  }

  const [row] = await db
    .insert(schema.userRiskLimit)
    .values({
      ...next,
      currency: currency.code,
      source: USER_LIMIT_SOURCE,
      userId,
    })
    .onConflictDoUpdate({
      set: { ...next, updatedAt: new Date() },
      target: [
        schema.userRiskLimit.userId,
        schema.userRiskLimit.currency,
        schema.userRiskLimit.source,
      ],
    })
    .returning()
  if (!row) {
    throw new Error('Failed to update risk limits')
  }

  return limitResponse(row, currency.decimals)
}

type ExclusionRow = typeof schema.userExclusion.$inferSelect

function assertNoActiveExclusion(exclusions: ExclusionRow[]) {
  if (exclusions.some((exclusion) => exclusion.type === 'self_exclusion')) {
    throw riskRejected(
      'self_excluded',
      'Betting is blocked by a self-exclusion',
    )
  }
  if (exclusions.some((exclusion) => exclusion.type === 'cooling_off')) {
    throw riskRejected(
      'cooling_off',
      'Betting is blocked by a cooling-off period',
    )
  }
}

export async function assertWithdrawalAllowed(
  db: Pick<Db, 'query'>,
  userId: string,
) {
  const now = new Date()
  const exclusions = await db.query.userExclusion.findMany({
    where: and(
      eq(schema.userExclusion.userId, userId),
      eq(schema.userExclusion.active, true),
      lte(schema.userExclusion.startsAt, now),
      or(
        isNull(schema.userExclusion.expiresAt),
        gt(schema.userExclusion.expiresAt, now),
      ),
    ),
  })
  if (exclusions.some((exclusion) => exclusion.type === 'self_exclusion')) {
    throw riskRejected(
      'self_excluded',
      'Withdrawals are blocked by a self-exclusion',
    )
  }
  if (exclusions.some((exclusion) => exclusion.type === 'cooling_off')) {
    throw riskRejected(
      'cooling_off',
      'Withdrawals are blocked by a cooling-off period',
    )
  }
}

export interface BetRiskContext {
  amount: bigint
  currency: string
  game: string
  idempotencyKey: string
  userId: string
}

export async function assertBetAllowedInTransaction(
  tx: WalletTransaction,
  context: BetRiskContext,
) {
  const now = new Date()
  const exclusions = await tx.query.userExclusion.findMany({
    where: and(
      eq(schema.userExclusion.userId, context.userId),
      eq(schema.userExclusion.active, true),
      lte(schema.userExclusion.startsAt, now),
      or(
        isNull(schema.userExclusion.expiresAt),
        gt(schema.userExclusion.expiresAt, now),
      ),
    ),
  })
  assertNoActiveExclusion(exclusions)

  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`risk:${context.userId}:${context.currency}`}, 0))`,
  )

  const day = dayBucket(now)
  const week = weekBucket(now)
  const dayCounter = await incrementCounter(
    tx,
    context.userId,
    context.currency,
    'day',
    day,
    context.amount,
    0n,
  )
  const weekCounter = await incrementCounter(
    tx,
    context.userId,
    context.currency,
    'week',
    week,
    context.amount,
    0n,
  )
  const limits = await tx.query.userRiskLimit.findFirst({
    where: and(
      eq(schema.userRiskLimit.userId, context.userId),
      eq(schema.userRiskLimit.currency, context.currency),
      eq(schema.userRiskLimit.source, USER_LIMIT_SOURCE),
    ),
  })
  if (!limits) {
    return
  }

  if (limits.singleBetCap !== null && context.amount > limits.singleBetCap) {
    throw riskRejected('single_bet_cap', 'Bet exceeds your single-bet limit')
  }
  if (limits.dailyBetCap !== null && dayCounter.wagered > limits.dailyBetCap) {
    throw riskRejected(
      'daily_bet_cap',
      'You have reached your daily wagering limit',
    )
  }
  if (
    limits.weeklyBetCap !== null &&
    weekCounter.wagered > limits.weeklyBetCap
  ) {
    throw riskRejected(
      'weekly_bet_cap',
      'You have reached your weekly wagering limit',
    )
  }
  if (
    limits.dailyLossCap !== null &&
    dayCounter.wagered - dayCounter.payout > limits.dailyLossCap
  ) {
    throw riskRejected(
      'daily_loss_cap',
      'You have reached your daily loss limit',
    )
  }
  if (
    limits.weeklyLossCap !== null &&
    weekCounter.wagered - weekCounter.payout > limits.weeklyLossCap
  ) {
    throw riskRejected(
      'weekly_loss_cap',
      'You have reached your weekly loss limit',
    )
  }
}

export async function recordBetPayoutInTransaction(
  tx: WalletTransaction,
  context: BetRiskContext,
  payout: bigint,
) {
  if (payout <= 0n) {
    return
  }

  const now = new Date()
  await incrementCounter(
    tx,
    context.userId,
    context.currency,
    'day',
    dayBucket(now),
    0n,
    payout,
  )
  await incrementCounter(
    tx,
    context.userId,
    context.currency,
    'week',
    weekBucket(now),
    0n,
    payout,
  )
}

export async function recordBetRejected(
  db: Db,
  context: BetRiskContext,
  code: RiskRuleCode,
) {
  try {
    await db
      .insert(schema.riskEvent)
      .values({
        dedupeKey: `bet_rejected:${context.userId}:${context.idempotencyKey}:${code}`,
        details: {
          amount: context.amount.toString(),
          currency: context.currency,
          game: context.game,
        },
        detector: code,
        id: randomUUID(),
        referenceId: context.idempotencyKey,
        referenceType: 'bet_idempotency_key',
        severity: 'warning',
        type: 'bet_rejected',
        userId: context.userId,
      })
      .onConflictDoNothing()
  } catch {
    // Risk event persistence must never mask the original rejection.
  }
}
