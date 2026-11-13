import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import { formatAmount } from '@/lib/money'
import type { WalletTransaction } from '@/modules/wallet/ledger'

import { riskRejected } from './util'

const SETTLED_GAME_STATUSES = ['settled', 'cashed_out', 'lost'] as const
const OCCUPYING_CRYPTO_STATUSES = [
  'pending_review',
  'queued',
  'submitting',
  'submit_unconfirmed',
  'processing',
  'pending_approval',
  'succeeded',
] as const
const OCCUPYING_FIAT_STATUSES = [
  'pending_review',
  'queued',
  'submitting',
  'submit_unconfirmed',
  'processing',
  'pending_approval',
  'succeeded',
] as const

type QueryDatabase = Db | WalletTransaction

export interface WageringGateOptions {
  ratio: number
  reportingCurrency?: string
}

interface WageringTotals {
  occupied: bigint
  wagering: bigint
}

function normalizeAmount(
  amount: bigint,
  fromDecimals: number,
  toDecimals: number,
) {
  if (fromDecimals === toDecimals) {
    return amount
  }
  return fromDecimals < toDecimals
    ? amount * 10n ** BigInt(toDecimals - fromDecimals)
    : amount / 10n ** BigInt(fromDecimals - toDecimals)
}

async function reportingCurrency(db: QueryDatabase, configured?: string) {
  if (configured) {
    const row = await db.query.currency.findFirst({
      columns: { code: true, decimals: true },
      where: eq(schema.currency.code, configured.toUpperCase()),
    })
    if (row) {
      return row
    }
    throw Object.assign(
      new Error(`Unknown wagering reporting currency: ${configured}`),
      { statusCode: 503 },
    )
  }
  const preferred = await db.query.currency.findFirst({
    columns: { code: true, decimals: true },
    where: eq(schema.currency.code, 'USDT'),
  })
  if (preferred) {
    return preferred
  }
  const fallback = await db.query.currency.findFirst({
    columns: { code: true, decimals: true },
    orderBy: [asc(schema.currency.code)],
    where: eq(schema.currency.enabled, true),
  })
  if (!fallback) {
    throw Object.assign(new Error('No reporting currency configured'), {
      statusCode: 503,
    })
  }
  return fallback
}

function sumByCurrency(
  rows: {
    currency: string
    total: string
  }[],
  reportingDecimals: number,
  decimals: Map<string, number>,
) {
  let total = 0n
  for (const row of rows) {
    total += normalizeAmount(
      BigInt(row.total),
      decimals.get(row.currency) ?? reportingDecimals,
      reportingDecimals,
    )
  }
  return total
}

async function sumWagering(
  db: QueryDatabase,
  userId: string,
  reportingDecimals: number,
) {
  const gameRows = await db
    .select({
      currency: schema.gameBet.currency,
      total: sql<string>`coalesce(sum(${schema.gameBet.amount}), 0)::text`,
    })
    .from(schema.gameBet)
    .where(
      and(
        eq(schema.gameBet.userId, userId),
        inArray(schema.gameBet.status, [...SETTLED_GAME_STATUSES]),
      ),
    )
    .groupBy(schema.gameBet.currency)
  const caseRows = await db
    .select({
      currency: schema.caseOpen.currency,
      total: sql<string>`coalesce(sum(${schema.caseOpen.amount}), 0)::text`,
    })
    .from(schema.caseOpen)
    .where(eq(schema.caseOpen.userId, userId))
    .groupBy(schema.caseOpen.currency)
  const raffleRows = await db
    .select({
      currency: schema.raffleEntry.currency,
      total: sql<string>`coalesce(sum(${schema.raffleEntry.amount}), 0)::text`,
    })
    .from(schema.raffleEntry)
    .where(
      and(
        eq(schema.raffleEntry.userId, userId),
        eq(schema.raffleEntry.refunded, false),
      ),
    )
    .groupBy(schema.raffleEntry.currency)
  const rows = [...gameRows, ...caseRows, ...raffleRows]
  const codes = [...new Set(rows.map((row) => row.currency))]
  const currencies = await db.query.currency.findMany({
    columns: { code: true, decimals: true },
    where: inArray(schema.currency.code, codes),
  })
  return sumByCurrency(
    rows,
    reportingDecimals,
    new Map(currencies.map((row) => [row.code, row.decimals])),
  )
}

async function sumOccupied(
  db: QueryDatabase,
  userId: string,
  reportingDecimals: number,
) {
  const cryptoRows = await db
    .select({
      currency: schema.cryptoWithdrawal.currencyCode,
      total: sql<string>`coalesce(sum(${schema.cryptoWithdrawal.amount}), 0)::text`,
    })
    .from(schema.cryptoWithdrawal)
    .where(
      and(
        eq(schema.cryptoWithdrawal.userId, userId),
        inArray(schema.cryptoWithdrawal.status, [...OCCUPYING_CRYPTO_STATUSES]),
      ),
    )
    .groupBy(schema.cryptoWithdrawal.currencyCode)
  const fiatRows = await db
    .select({
      currency: schema.fiatOrder.currencyCode,
      total: sql<string>`coalesce(sum(${schema.fiatOrder.amount}), 0)::text`,
    })
    .from(schema.fiatOrder)
    .where(
      and(
        eq(schema.fiatOrder.userId, userId),
        eq(schema.fiatOrder.type, 'payout'),
        inArray(schema.fiatOrder.status, [...OCCUPYING_FIAT_STATUSES]),
      ),
    )
    .groupBy(schema.fiatOrder.currencyCode)
  const rows = [...cryptoRows, ...fiatRows]
  const codes = [...new Set(rows.map((row) => row.currency))]
  const currencies = await db.query.currency.findMany({
    columns: { code: true, decimals: true },
    where: inArray(schema.currency.code, codes),
  })
  return sumByCurrency(
    rows,
    reportingDecimals,
    new Map(currencies.map((row) => [row.code, row.decimals])),
  )
}

async function getTotals(
  db: QueryDatabase,
  userId: string,
  options: WageringGateOptions,
): Promise<WageringTotals & { reportingDecimals: number }> {
  const reporting = await reportingCurrency(db, options.reportingCurrency)
  const wagering = await sumWagering(db, userId, reporting.decimals)
  const occupied = await sumOccupied(db, userId, reporting.decimals)
  return {
    occupied,
    reportingDecimals: reporting.decimals,
    wagering,
  }
}

function cap(
  totals: WageringTotals,
  ratio: number,
  reportingDecimals: number,
  requestDecimals: number,
) {
  if (ratio <= 0) {
    return null
  }
  const capReporting = totals.wagering / BigInt(ratio)
  const remaining =
    totals.occupied >= capReporting ? 0n : capReporting - totals.occupied
  return normalizeAmount(remaining, reportingDecimals, requestDecimals)
}

function assertWithinCap(
  totals: WageringTotals,
  additional: bigint,
  ratio: number,
  reportingDecimals: number,
  requestDecimals: number,
  currency: string,
) {
  if (ratio <= 0) {
    return
  }
  const additionalReporting = normalizeAmount(
    additional,
    requestDecimals,
    reportingDecimals,
  )
  const required = (totals.occupied + additionalReporting) * BigInt(ratio)
  if (required <= totals.wagering) {
    return
  }
  const shortfall = normalizeAmount(
    required - totals.wagering,
    reportingDecimals,
    requestDecimals,
  )
  throw riskRejected(
    'withdraw_wagering',
    `Wager ${formatAmount(shortfall, requestDecimals)} ${currency} more before withdrawing this amount`,
  )
}

export async function getWageringSummary(
  db: Db,
  userId: string,
  currency: string,
  options: WageringGateOptions,
) {
  const active = await db.query.currency.findFirst({
    columns: { code: true, decimals: true },
    where: eq(schema.currency.code, currency.toUpperCase()),
  })
  if (!active) {
    throw Object.assign(new Error('Currency not found'), { statusCode: 404 })
  }
  const summary = await getTotals(db, userId, options)
  const wallet = await db.query.wallet.findFirst({
    where: and(
      eq(schema.wallet.userId, userId),
      eq(schema.wallet.currency, active.code),
    ),
  })
  const balance = wallet?.balance ?? 0n
  const withdrawableCap = cap(
    summary,
    options.ratio,
    summary.reportingDecimals,
    active.decimals,
  )
  const withdrawable =
    withdrawableCap === null || withdrawableCap > balance
      ? balance
      : withdrawableCap
  return {
    balance: formatAmount(balance, active.decimals),
    capAmount:
      withdrawableCap === null
        ? null
        : formatAmount(withdrawableCap, active.decimals),
    currency: active.code,
    occupiedAmount: formatAmount(
      normalizeAmount(
        summary.occupied,
        summary.reportingDecimals,
        active.decimals,
      ),
      active.decimals,
    ),
    ratio: options.ratio,
    wageringAmount: formatAmount(
      normalizeAmount(
        summary.wagering,
        summary.reportingDecimals,
        active.decimals,
      ),
      active.decimals,
    ),
    withdrawableAmount: formatAmount(withdrawable, active.decimals),
  }
}

export async function assertWageringAllowed(
  tx: WalletTransaction,
  userId: string,
  currency: string,
  additional: bigint,
  options: WageringGateOptions,
) {
  if (options.ratio <= 0) {
    return
  }
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`risk:withdraw-wagering:${userId}`}, 0))`,
  )
  const summary = await getTotals(tx, userId, options)
  const requestCurrency = await tx.query.currency.findFirst({
    columns: { decimals: true },
    where: eq(schema.currency.code, currency.toUpperCase()),
  })
  assertWithinCap(
    summary,
    additional,
    options.ratio,
    summary.reportingDecimals,
    requestCurrency?.decimals ?? summary.reportingDecimals,
    currency.toUpperCase(),
  )
}
