import { randomUUID } from 'node:crypto'

import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  notInArray,
  or,
} from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type Redis from 'ioredis'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import { currency } from '@/lib/currency'
import { decodeCursor, encodeCursor } from '@/lib/cursor'
import { formatAmount } from '@/lib/money'
import { REALTIME_CHANNEL, SOCKET_EVENTS } from '@/lib/socket-events'

import type { TransactionQuery } from './schema'
import {
  HIDDEN_REFERENCE_TYPES,
  KNOWN_REFERENCE_TYPES,
  ledgerTypesForDirection,
  referenceTypesFor,
  transactionDirection,
  transactionType,
} from './util'

type Currency = typeof schema.currency.$inferSelect

function meta(active: Currency) {
  return {
    code: active.code,
    decimals: active.decimals,
    locale: active.locale,
    symbol: active.symbol,
    type: active.type,
  }
}

export async function ensureWallet(db: Db, userId: string, code: string) {
  const existing = await db.query.wallet.findFirst({
    where: and(
      eq(schema.wallet.userId, userId),
      eq(schema.wallet.currency, code),
    ),
  })
  if (existing) {
    return existing
  }

  const [created] = await db
    .insert(schema.wallet)
    .values({
      balance: 0n,
      currency: code,
      id: randomUUID(),
      lockedBalance: 0n,
      userId,
    })
    .onConflictDoNothing()
    .returning()
  if (created) {
    return created
  }

  const wallet = await db.query.wallet.findFirst({
    where: and(
      eq(schema.wallet.userId, userId),
      eq(schema.wallet.currency, code),
    ),
  })
  if (!wallet) {
    throw Object.assign(new Error('Failed to create wallet'), {
      statusCode: 409,
    })
  }
  return wallet
}

export async function balance(db: Db, userId: string, requested?: string) {
  const active = await currency(db, requested)
  const wallet = await ensureWallet(db, userId, active.code)
  return {
    balance: formatAmount(wallet.balance, active.decimals),
    currency: wallet.currency,
    lockedBalance: formatAmount(wallet.lockedBalance, active.decimals),
    meta: meta(active),
  }
}

export async function balanceSnapshot(
  db: Db,
  userId: string,
  requested?: string,
) {
  const active = await currency(db, requested)
  const wallet = await ensureWallet(db, userId, active.code)
  return {
    balance: formatAmount(wallet.balance, active.decimals),
    currency: wallet.currency,
    lockedBalance: formatAmount(wallet.lockedBalance, active.decimals),
    meta: meta(active),
    seq: wallet.version,
  }
}

export async function publishWalletBalance(
  redis: Pick<Redis, 'publish'>,
  db: Db,
  userId: string,
  requested?: string,
) {
  const snapshot = await balanceSnapshot(db, userId, requested)
  await redis.publish(
    REALTIME_CHANNEL,
    JSON.stringify({
      data: { ...snapshot, userId },
      event: SOCKET_EVENTS.walletBalanceUpdate,
      userId,
    }),
  )
}

export async function balances(db: Db, userId: string) {
  const currencies = await db
    .select()
    .from(schema.currency)
    .where(
      and(
        eq(schema.currency.enabled, true),
        eq(schema.currency.walletEnabled, true),
      ),
    )
    .orderBy(asc(schema.currency.code))
  const wallets = await Promise.all(
    currencies.map(async (active) => {
      const wallet = await ensureWallet(db, userId, active.code)
      return {
        balance: formatAmount(wallet.balance, active.decimals),
        currency: wallet.currency,
        lockedBalance: formatAmount(wallet.lockedBalance, active.decimals),
        meta: meta(active),
      }
    }),
  )

  return { balances: wallets }
}

export async function transactions(
  db: Db,
  userId: string,
  query: TransactionQuery,
) {
  const requested = query.currency
    ? await currency(db, query.currency)
    : undefined
  const cursor = query.cursor ? decodeCursor(query.cursor) : null
  const wallets = await db
    .select()
    .from(schema.wallet)
    .where(eq(schema.wallet.userId, userId))
  const selected = requested
    ? wallets.filter((wallet) => wallet.currency === requested.code)
    : wallets

  if (selected.length === 0) {
    return { items: [], nextCursor: null }
  }

  const codes = [...new Set(selected.map((wallet) => wallet.currency))]
  const currencies = await db
    .select()
    .from(schema.currency)
    .where(inArray(schema.currency.code, codes))
  const currencyByCode = new Map(
    currencies.map((active) => [active.code, active]),
  )
  const walletById = new Map(selected.map((wallet) => [wallet.id, wallet]))
  const filters: SQL[] = [
    inArray(
      schema.walletTransaction.walletId,
      selected.map((wallet) => wallet.id),
    ),
    gt(schema.walletTransaction.amount, 0n),
    notInArray(schema.walletTransaction.referenceType, [
      ...HIDDEN_REFERENCE_TYPES,
    ]),
  ]

  if (query.direction) {
    filters.push(
      inArray(
        schema.walletTransaction.type,
        ledgerTypesForDirection(query.direction),
      ),
    )
  }

  if (query.type) {
    const referenceTypes = referenceTypesFor(query.type)
    filters.push(
      referenceTypes
        ? inArray(schema.walletTransaction.referenceType, referenceTypes)
        : notInArray(schema.walletTransaction.referenceType, [
            ...KNOWN_REFERENCE_TYPES,
          ]),
    )
  }

  if (query.from) {
    filters.push(gte(schema.walletTransaction.createdAt, new Date(query.from)))
  }

  if (query.to) {
    filters.push(lt(schema.walletTransaction.createdAt, new Date(query.to)))
  }

  if (cursor) {
    const createdAt = new Date(cursor.createdAt)
    const cursorFilter = or(
      lt(schema.walletTransaction.createdAt, createdAt),
      and(
        eq(schema.walletTransaction.createdAt, createdAt),
        lt(schema.walletTransaction.id, cursor.id),
      ),
    )
    if (cursorFilter) {
      filters.push(cursorFilter)
    }
  }

  const rows = await db
    .select()
    .from(schema.walletTransaction)
    .where(and(...filters))
    .orderBy(
      desc(schema.walletTransaction.createdAt),
      desc(schema.walletTransaction.id),
    )
    .limit(query.limit + 1)
  const page = rows.slice(0, query.limit)
  const items = page.map((row) => {
    const wallet = walletById.get(row.walletId)
    const active = wallet ? currencyByCode.get(wallet.currency) : undefined
    if (!wallet || !active) {
      throw new Error(`Wallet or currency missing for transaction ${row.id}`)
    }

    return {
      amount: formatAmount(row.amount, active.decimals),
      balanceAfter: formatAmount(row.balanceAfter, active.decimals),
      createdAt: row.createdAt.toISOString(),
      currency: meta(active),
      direction: transactionDirection(row.type),
      id: row.id,
      reference: {
        id: row.referenceId,
        type: row.referenceType,
      },
      type: transactionType(row.referenceType),
    }
  })
  const last = page.at(-1)

  return {
    items,
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({
            createdAt: last.createdAt.toISOString(),
            id: last.id,
          })
        : null,
  }
}
