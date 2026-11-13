import { and, asc, desc, eq, inArray, lte, lt, sql } from 'drizzle-orm'
import type Redis from 'ioredis'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import { errorMessage } from '@/lib/errors'
import { creditInTransaction } from '@/modules/wallet/ledger'
import { ensureWallet, publishWalletBalance } from '@/modules/wallet/service'
import { WALLET_REFERENCES } from '@/modules/wallet/util'

import {
  computePool,
  computeRewardAmount,
  currentPeriodStart,
  getRankingConfig,
  nextPeriodStart,
  normalizeRankingAmount,
  periodRange,
  previousPeriodStart,
  RANKING_CURRENCIES,
  RANKING_CURRENCY,
  settlementDueAt,
} from './util'
import type { RankingPeriod, RankingPeriodConfig } from './util'

const SETTLED_GAME_STATUSES = ['settled', 'cashed_out', 'lost'] as const
const MAX_CATCH_UP_PERIODS = 31
const MAX_DUE_PERIODS = 10
const MAX_PENDING_REWARDS = 100

interface RankingSummary {
  betCount: number
  userId: string
  wagered: bigint
}

function rankingLockKey(type: RankingPeriod, bucketDate: string) {
  return `ranking:${type}:${bucketDate}`
}

async function groupedWageringRows(
  db: Db,
  type: RankingPeriod,
  bucketDate: string,
) {
  const { from, to } = periodRange(type, bucketDate)
  const [gameRows, caseRows, raffleRows] = await Promise.all([
    db
      .select({
        betCount: sql<string>`count(*)::text`,
        currency: schema.gameBet.currency,
        total: sql<string>`coalesce(sum(${schema.gameBet.amount}), 0)::text`,
        userId: schema.gameBet.userId,
      })
      .from(schema.gameBet)
      .where(
        and(
          inArray(schema.gameBet.currency, [...RANKING_CURRENCIES]),
          inArray(schema.gameBet.status, [...SETTLED_GAME_STATUSES]),
          lt(schema.gameBet.createdAt, to),
          sql`${schema.gameBet.createdAt} >= ${from}`,
        ),
      )
      .groupBy(schema.gameBet.userId, schema.gameBet.currency),
    db
      .select({
        betCount: sql<string>`count(*)::text`,
        currency: schema.caseOpen.currency,
        total: sql<string>`coalesce(sum(${schema.caseOpen.amount}), 0)::text`,
        userId: schema.caseOpen.userId,
      })
      .from(schema.caseOpen)
      .where(
        and(
          inArray(schema.caseOpen.currency, [...RANKING_CURRENCIES]),
          eq(schema.caseOpen.status, 'settled'),
          lt(schema.caseOpen.createdAt, to),
          sql`${schema.caseOpen.createdAt} >= ${from}`,
        ),
      )
      .groupBy(schema.caseOpen.userId, schema.caseOpen.currency),
    db
      .select({
        betCount: sql<string>`count(*)::text`,
        currency: schema.raffleEntry.currency,
        total: sql<string>`coalesce(sum(${schema.raffleEntry.amount}), 0)::text`,
        userId: schema.raffleEntry.userId,
      })
      .from(schema.raffleEntry)
      .where(
        and(
          inArray(schema.raffleEntry.currency, [...RANKING_CURRENCIES]),
          eq(schema.raffleEntry.refunded, false),
          lt(schema.raffleEntry.createdAt, to),
          sql`${schema.raffleEntry.createdAt} >= ${from}`,
        ),
      )
      .groupBy(schema.raffleEntry.userId, schema.raffleEntry.currency),
  ])

  return [...gameRows, ...caseRows, ...raffleRows]
}

async function summarizeWagering(
  db: Db,
  config: RankingPeriodConfig,
  bucketDate: string,
  now: Date,
) {
  const rows = await groupedWageringRows(db, config.type, bucketDate)
  const userIds = [...new Set(rows.map((row) => row.userId))]
  if (userIds.length === 0) {
    return { entries: [] as RankingSummary[], grossWagered: 0n }
  }

  const [users, exclusions, currencies] = await Promise.all([
    db.query.user.findMany({
      columns: { banned: true, fundMode: true, id: true },
      where: inArray(schema.user.id, userIds),
    }),
    db.query.userExclusion.findMany({
      columns: { userId: true },
      where: and(
        inArray(schema.userExclusion.userId, userIds),
        eq(schema.userExclusion.active, true),
        lte(schema.userExclusion.startsAt, now),
        sql`(${schema.userExclusion.expiresAt} is null or ${schema.userExclusion.expiresAt} > ${now})`,
      ),
    }),
    db.query.currency.findMany({
      columns: { code: true, decimals: true },
      where: inArray(schema.currency.code, [...RANKING_CURRENCIES]),
    }),
  ])

  const userMap = new Map(users.map((user) => [user.id, user]))
  const excluded = new Set(exclusions.map((exclusion) => exclusion.userId))
  const decimals = new Map(
    currencies.map((currency) => [currency.code, currency.decimals]),
  )
  const entries = new Map<string, RankingSummary>()
  let grossWagered = 0n

  for (const row of rows) {
    const user = userMap.get(row.userId)
    if (!user || user.fundMode !== 'real') {
      continue
    }
    const amount = normalizeRankingAmount(
      BigInt(row.total),
      decimals.get(row.currency) ?? 2,
    )
    grossWagered += amount
    if (user.banned || excluded.has(row.userId)) {
      continue
    }
    const existing = entries.get(row.userId)
    if (existing) {
      existing.betCount += Math.trunc(Number(row.betCount))
      existing.wagered += amount
    } else {
      entries.set(row.userId, {
        betCount: Math.trunc(Number(row.betCount)),
        userId: row.userId,
        wagered: amount,
      })
    }
  }

  return {
    entries: [...entries.values()],
    grossWagered,
  }
}

export async function rebuildRankingPeriod(
  db: Db,
  config: RankingPeriodConfig,
  bucketDate: string,
  now = new Date(),
) {
  const runStartedAt = now
  const summary = await summarizeWagering(db, config, bucketDate, now)
  const dueAt = settlementDueAt(
    config.type,
    bucketDate,
    config.freezeDelayMinutes,
  )

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${rankingLockKey(config.type, bucketDate)}, 0))`,
    )
    const [existing] = await tx
      .select({ status: schema.rankingPeriod.status })
      .from(schema.rankingPeriod)
      .where(
        and(
          eq(schema.rankingPeriod.periodType, config.type),
          eq(schema.rankingPeriod.bucketDate, bucketDate),
        ),
      )
      .for('update')
    if (existing?.status === 'settled') {
      return {
        bucketDate,
        grossWagered: summary.grossWagered,
        skipped: true,
        usersProcessed: 0,
      }
    }

    await tx
      .insert(schema.rankingPeriod)
      .values({
        bucketDate,
        computedAt: runStartedAt,
        dueAt,
        periodType: config.type,
        status: 'open',
        wagered: summary.grossWagered,
      })
      .onConflictDoUpdate({
        set: {
          computedAt: runStartedAt,
          dueAt,
          lastError: null,
          wagered: summary.grossWagered,
        },
        target: [
          schema.rankingPeriod.periodType,
          schema.rankingPeriod.bucketDate,
        ],
      })

    if (summary.entries.length > 0) {
      await tx
        .insert(schema.rankingEntry)
        .values(
          summary.entries.map((entry) => ({
            betCount: entry.betCount,
            bucketDate,
            computedAt: runStartedAt,
            periodType: config.type,
            userId: entry.userId,
            wagered: entry.wagered,
          })),
        )
        .onConflictDoUpdate({
          set: {
            betCount: sql`excluded.bet_count`,
            computedAt: sql`excluded.computed_at`,
            wagered: sql`excluded.wagered`,
          },
          target: [
            schema.rankingEntry.periodType,
            schema.rankingEntry.bucketDate,
            schema.rankingEntry.userId,
          ],
        })
    }

    await tx
      .delete(schema.rankingEntry)
      .where(
        and(
          eq(schema.rankingEntry.periodType, config.type),
          eq(schema.rankingEntry.bucketDate, bucketDate),
          lt(schema.rankingEntry.computedAt, runStartedAt),
        ),
      )

    return {
      bucketDate,
      grossWagered: summary.grossWagered,
      skipped: false,
      usersProcessed: summary.entries.length,
    }
  })
}

export async function catchUpRankingPeriods(
  db: Db,
  config: RankingPeriodConfig,
  now = new Date(),
) {
  const current = currentPeriodStart(config.type, now)
  await db
    .insert(schema.rankingSettlementClock)
    .values({
      nextBucketDate: previousPeriodStart(config.type, now),
      periodType: config.type,
    })
    .onConflictDoNothing()

  let processed = 0
  for (; processed < MAX_CATCH_UP_PERIODS; processed += 1) {
    const clock = await db.query.rankingSettlementClock.findFirst({
      where: eq(schema.rankingSettlementClock.periodType, config.type),
    })
    if (!clock || clock.nextBucketDate >= current) {
      break
    }
    const bucketDate = clock.nextBucketDate
    await rebuildRankingPeriod(db, config, bucketDate, now)
    const next = nextPeriodStart(config.type, bucketDate)
    const [updated] = await db
      .update(schema.rankingSettlementClock)
      .set({ nextBucketDate: next })
      .where(
        and(
          eq(schema.rankingSettlementClock.periodType, config.type),
          eq(schema.rankingSettlementClock.nextBucketDate, bucketDate),
        ),
      )
      .returning({
        nextBucketDate: schema.rankingSettlementClock.nextBucketDate,
      })
    if (!updated) {
      break
    }
  }
  return processed
}

export function finalizeRankingPeriod(
  db: Db,
  config: RankingPeriodConfig,
  bucketDate: string,
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${rankingLockKey(config.type, bucketDate)}, 0))`,
    )
    const [period] = await tx
      .select()
      .from(schema.rankingPeriod)
      .where(
        and(
          eq(schema.rankingPeriod.periodType, config.type),
          eq(schema.rankingPeriod.bucketDate, bucketDate),
        ),
      )
      .for('update')
    if (!period || period.status === 'settled' || period.dueAt > now) {
      return { bucketDate, rewardsWritten: 0, settled: false }
    }

    const entries = await tx
      .select()
      .from(schema.rankingEntry)
      .where(
        and(
          eq(schema.rankingEntry.periodType, config.type),
          eq(schema.rankingEntry.bucketDate, bucketDate),
        ),
      )
      .orderBy(
        desc(schema.rankingEntry.wagered),
        asc(schema.rankingEntry.userId),
      )
      .limit(config.rankPercentagesBps.length)

    if (entries.length > 0) {
      const poolAmount = computePool(period.wagered, config)
      const rows = entries.map((entry, index) => {
        const percentageBps = config.rankPercentagesBps[index]
        if (percentageBps === undefined) {
          throw new Error('Ranking reward percentage is missing')
        }
        return {
          amount: computeRewardAmount(poolAmount, percentageBps),
          bucketDate,
          currency: RANKING_CURRENCY,
          percentageBps,
          periodType: config.type,
          poolAmount,
          rank: index + 1,
          status: 'pending' as const,
          userId: entry.userId,
          wagered: entry.wagered,
        }
      })
      await tx.insert(schema.rankingReward).values(rows).onConflictDoNothing()
    }

    const [settled] = await tx
      .update(schema.rankingPeriod)
      .set({
        lastError: null,
        settledAt: now,
        settlementAttempts: sql`${schema.rankingPeriod.settlementAttempts} + 1`,
        status: 'settled',
      })
      .where(
        and(
          eq(schema.rankingPeriod.periodType, config.type),
          eq(schema.rankingPeriod.bucketDate, bucketDate),
        ),
      )
      .returning({ bucketDate: schema.rankingPeriod.bucketDate })

    return {
      bucketDate,
      rewardsWritten: entries.length,
      settled: Boolean(settled),
    }
  })
}

export async function settleDueRankingPeriods(
  db: Db,
  periodType: RankingPeriod,
) {
  const config = getRankingConfig(periodType)
  if (!config) {
    return { failed: 0, settled: 0 }
  }
  const now = new Date()
  const periods = await db.query.rankingPeriod.findMany({
    limit: MAX_DUE_PERIODS,
    orderBy: [asc(schema.rankingPeriod.dueAt)],
    where: and(
      eq(schema.rankingPeriod.periodType, config.type),
      inArray(schema.rankingPeriod.status, ['open', 'failed']),
      lte(schema.rankingPeriod.dueAt, now),
    ),
  })

  let settled = 0
  let failed = 0
  for (const period of periods) {
    try {
      const result = await finalizeRankingPeriod(
        db,
        config,
        period.bucketDate,
        now,
      )
      if (result.settled) {
        settled += 1
      }
    } catch (error) {
      failed += 1
      await db
        .update(schema.rankingPeriod)
        .set({
          lastError: errorMessage(error).slice(0, 500),
          settlementAttempts: sql`${schema.rankingPeriod.settlementAttempts} + 1`,
          status: 'failed',
        })
        .where(
          and(
            eq(schema.rankingPeriod.periodType, config.type),
            eq(schema.rankingPeriod.bucketDate, period.bucketDate),
          ),
        )
    }
  }
  return { failed, settled }
}

async function payRankingReward(
  db: Db,
  redis: Pick<Redis, 'publish'>,
  reward: typeof schema.rankingReward.$inferSelect,
) {
  const result = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(schema.rankingReward)
      .where(
        and(
          eq(schema.rankingReward.periodType, reward.periodType),
          eq(schema.rankingReward.bucketDate, reward.bucketDate),
          eq(schema.rankingReward.rank, reward.rank),
        ),
      )
      .for('update')
    if (!locked || locked.status !== 'pending') {
      return null
    }
    if (locked.amount <= 0n) {
      await tx
        .update(schema.rankingReward)
        .set({
          attempts: sql`${schema.rankingReward.attempts} + 1`,
          resolvedAt: new Date(),
          status: 'skipped',
        })
        .where(
          and(
            eq(schema.rankingReward.periodType, locked.periodType),
            eq(schema.rankingReward.bucketDate, locked.bucketDate),
            eq(schema.rankingReward.rank, locked.rank),
          ),
        )
      return null
    }

    const wallet = await ensureWallet(tx, locked.userId, locked.currency)
    const mutation = await creditInTransaction(tx, {
      amount: locked.amount,
      idempotencyKey: `ranking-reward:${locked.periodType}:${locked.bucketDate}:${locked.rank}`,
      reference: {
        referenceId: `${locked.bucketDate}:${locked.rank}`,
        referenceType: WALLET_REFERENCES.rankingReward,
      },
      walletId: wallet.id,
    })
    await tx
      .update(schema.rankingReward)
      .set({
        attempts: sql`${schema.rankingReward.attempts} + 1`,
        lastError: null,
        resolvedAt: new Date(),
        status: 'paid',
        walletTransactionId: mutation.transactionId,
      })
      .where(
        and(
          eq(schema.rankingReward.periodType, locked.periodType),
          eq(schema.rankingReward.bucketDate, locked.bucketDate),
          eq(schema.rankingReward.rank, locked.rank),
        ),
      )
    return {
      currency: locked.currency,
      userId: locked.userId,
    }
  })

  if (result) {
    await publishWalletBalance(redis, db, result.userId, result.currency)
  }
  return Boolean(result)
}

export async function payPendingRankingRewards(
  db: Db,
  redis: Pick<Redis, 'publish'>,
) {
  const rewards = await db.query.rankingReward.findMany({
    limit: MAX_PENDING_REWARDS,
    orderBy: [asc(schema.rankingReward.createdAt)],
    where: eq(schema.rankingReward.status, 'pending'),
  })
  let paid = 0
  let failed = 0
  for (const reward of rewards) {
    try {
      if (await payRankingReward(db, redis, reward)) {
        paid += 1
      }
    } catch (error) {
      failed += 1
      await db
        .update(schema.rankingReward)
        .set({
          attempts: sql`${schema.rankingReward.attempts} + 1`,
          lastError: errorMessage(error).slice(0, 500),
        })
        .where(
          and(
            eq(schema.rankingReward.periodType, reward.periodType),
            eq(schema.rankingReward.bucketDate, reward.bucketDate),
            eq(schema.rankingReward.rank, reward.rank),
          ),
        )
    }
  }
  return { attempted: rewards.length, failed, paid }
}
