import { and, asc, desc, eq, gt, or, sql } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import { currency } from '@/lib/currency'
import { formatAmount } from '@/lib/money'

import { RewardList } from './schema'
import {
  computePool,
  currentPeriodStart,
  DEFAULT_RANKING_PERIOD,
  previousPeriodStart,
  RANKING_CURRENCY,
  getRankingConfig,
  periodRange,
} from './util'
import type { RankingPeriod, RankingPeriodConfig } from './util'

function config(period: RankingPeriod) {
  const value = getRankingConfig(period)
  if (!value) {
    throw Object.assign(
      new Error(`Ranking period '${period}' is not configured`),
      { statusCode: 400 },
    )
  }
  return value
}

async function pool(db: Db, value: RankingPeriodConfig, bucketDate: string) {
  const [row] = await db
    .select({ total: schema.rankingPeriod.wagered })
    .from(schema.rankingPeriod)
    .where(
      and(
        eq(schema.rankingPeriod.periodType, value.type),
        eq(schema.rankingPeriod.bucketDate, bucketDate),
      ),
    )
  return computePool(row?.total ?? 0n, value)
}

async function cutoff(db: Db, value: RankingPeriodConfig, bucketDate: string) {
  const rows = await db
    .select({ wagered: schema.rankingEntry.wagered })
    .from(schema.rankingEntry)
    .where(
      and(
        eq(schema.rankingEntry.periodType, value.type),
        eq(schema.rankingEntry.bucketDate, bucketDate),
      ),
    )
    .orderBy(desc(schema.rankingEntry.wagered), asc(schema.rankingEntry.userId))
    .limit(value.rankPercentagesBps.length)

  return rows.length < value.rankPercentagesBps.length
    ? null
    : (rows.at(-1)?.wagered ?? null)
}

async function champion(db: Db, value: RankingPeriodConfig, decimals: number) {
  const bucketDate = previousPeriodStart(value.type)
  const [reward] = await db
    .select({
      amount: schema.rankingReward.amount,
      image: schema.user.image,
      name: schema.user.name,
      userId: schema.rankingReward.userId,
      wagered: schema.rankingReward.wagered,
    })
    .from(schema.rankingReward)
    .innerJoin(schema.user, eq(schema.user.id, schema.rankingReward.userId))
    .where(
      and(
        eq(schema.rankingReward.periodType, value.type),
        eq(schema.rankingReward.bucketDate, bucketDate),
        eq(schema.rankingReward.rank, 1),
        eq(schema.rankingReward.status, 'paid'),
      ),
    )

  if (!reward) {
    return null
  }

  return {
    amount: formatAmount(reward.amount, decimals),
    bucketDate,
    image: reward.image,
    name: reward.name,
    userId: reward.userId,
    wagered: formatAmount(reward.wagered, decimals),
  }
}

export async function ranking(
  db: Db,
  period: RankingPeriod = DEFAULT_RANKING_PERIOD,
) {
  const value = config(period)
  const bucketDate = currentPeriodStart(value.type)
  const active = await currency(db, RANKING_CURRENCY)
  const rows = await db
    .select({
      image: schema.user.image,
      name: schema.user.name,
      userId: schema.rankingEntry.userId,
      wagered: schema.rankingEntry.wagered,
    })
    .from(schema.rankingEntry)
    .innerJoin(schema.user, eq(schema.user.id, schema.rankingEntry.userId))
    .where(
      and(
        eq(schema.rankingEntry.periodType, value.type),
        eq(schema.rankingEntry.bucketDate, bucketDate),
      ),
    )
    .orderBy(desc(schema.rankingEntry.wagered), asc(schema.rankingEntry.userId))
    .limit(value.rankPercentagesBps.length)
  const [entries, poolAmount, lastChampion] = await Promise.all([
    Promise.resolve(rows),
    pool(db, value, bucketDate),
    champion(db, value, active.decimals),
  ])

  return {
    bucketDate,
    currency: RANKING_CURRENCY,
    entries: entries.map((row, index) => ({
      image: row.image,
      name: row.name,
      rank: index + 1,
      userId: row.userId,
      wagered: formatAmount(row.wagered, active.decimals),
    })),
    lastChampion,
    periodType: value.type,
    poolAmount: formatAmount(poolAmount, active.decimals),
    refreshesAt: periodRange(value.type, bucketDate).to.toISOString(),
  }
}

export async function mine(
  db: Db,
  userId: string,
  period: RankingPeriod = DEFAULT_RANKING_PERIOD,
) {
  const value = config(period)
  const bucketDate = currentPeriodStart(value.type)
  const active = await currency(db, RANKING_CURRENCY)
  const [entry] = await db
    .select({ wagered: schema.rankingEntry.wagered })
    .from(schema.rankingEntry)
    .where(
      and(
        eq(schema.rankingEntry.periodType, value.type),
        eq(schema.rankingEntry.bucketDate, bucketDate),
        eq(schema.rankingEntry.userId, userId),
      ),
    )

  if (!entry) {
    const topNCutoff = await cutoff(db, value, bucketDate)
    return {
      bucketDate,
      inTopN: false,
      periodType: value.type,
      rank: null,
      wagered: formatAmount(0n, active.decimals),
      wageredToReachTopN:
        topNCutoff === null ? null : formatAmount(topNCutoff, active.decimals),
    }
  }

  const [{ aheadCount }] = await db
    .select({ aheadCount: sql<string>`count(*)` })
    .from(schema.rankingEntry)
    .where(
      and(
        eq(schema.rankingEntry.periodType, value.type),
        eq(schema.rankingEntry.bucketDate, bucketDate),
        or(
          gt(schema.rankingEntry.wagered, entry.wagered),
          and(
            eq(schema.rankingEntry.wagered, entry.wagered),
            sql`${schema.rankingEntry.userId} < ${userId}`,
          ),
        ),
      ),
    )
  const rank = Number(aheadCount) + 1
  const inTopN = rank <= value.rankPercentagesBps.length
  const topNCutoff = inTopN ? null : await cutoff(db, value, bucketDate)

  return {
    bucketDate,
    inTopN,
    periodType: value.type,
    rank,
    wagered: formatAmount(entry.wagered, active.decimals),
    wageredToReachTopN:
      topNCutoff === null
        ? null
        : formatAmount(
            topNCutoff > entry.wagered ? topNCutoff - entry.wagered : 0n,
            active.decimals,
          ),
  }
}

export async function rewards(
  db: Db,
  userId: string,
  query: { limit: number; period?: RankingPeriod },
) {
  const rows = await db
    .select({
      amount: schema.rankingReward.amount,
      bucketDate: schema.rankingReward.bucketDate,
      createdAt: schema.rankingReward.createdAt,
      currency: schema.rankingReward.currency,
      decimals: schema.currency.decimals,
      heldReason: schema.rankingReward.heldReason,
      percentageBps: schema.rankingReward.percentageBps,
      periodType: schema.rankingReward.periodType,
      poolAmount: schema.rankingReward.poolAmount,
      rank: schema.rankingReward.rank,
      resolvedAt: schema.rankingReward.resolvedAt,
      status: schema.rankingReward.status,
      userId: schema.rankingReward.userId,
      wagered: schema.rankingReward.wagered,
    })
    .from(schema.rankingReward)
    .innerJoin(
      schema.currency,
      eq(schema.currency.code, schema.rankingReward.currency),
    )
    .where(
      and(
        eq(schema.rankingReward.userId, userId),
        query.period
          ? eq(schema.rankingReward.periodType, query.period)
          : undefined,
      ),
    )
    .orderBy(
      desc(schema.rankingReward.createdAt),
      desc(schema.rankingReward.bucketDate),
      asc(schema.rankingReward.rank),
    )
    .limit(query.limit)

  return RewardList.parse({
    items: rows.map((row) => ({
      amount: formatAmount(row.amount, row.decimals),
      bucketDate: row.bucketDate,
      createdAt: row.createdAt.toISOString(),
      currency: row.currency,
      heldReason: row.heldReason,
      percentageBps: row.percentageBps,
      periodType: row.periodType,
      poolAmount: formatAmount(row.poolAmount, row.decimals),
      rank: row.rank,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      status: row.status,
      userId: row.userId,
      wagered: formatAmount(row.wagered, row.decimals),
    })),
  })
}
