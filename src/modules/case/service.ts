import { randomUUID } from 'node:crypto'

import { httpErrors } from '@fastify/sensible'
import { and, desc, eq, ilike, inArray, lt, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import type { AppConfig } from '@/lib/config'
import { currency as findCurrency } from '@/lib/currency'
import { decodeCursor, encodeCursor } from '@/lib/cursor'
import { findErrorCode } from '@/lib/errors'
import { formatAmount, parseAmount } from '@/lib/money'
import { decryptSeed } from '@/lib/seed-cipher'
import {
  assertIdempotentRequest,
  hashGameBetRequest,
} from '@/modules/game/bets'
import {
  assertBetAmount,
  assertBettingCurrency,
  capPayout,
  getDefaultBetLimits,
} from '@/modules/game/limits'
import {
  assertBetAllowedInTransaction,
  recordBetPayoutInTransaction,
  recordBetRejected,
} from '@/modules/risk/service'
import { isRiskRejection } from '@/modules/risk/util'
import {
  creditInTransaction,
  debitInTransaction,
} from '@/modules/wallet/ledger'
import { ensureWallet } from '@/modules/wallet/service'
import { WALLET_REFERENCES } from '@/modules/wallet/util'

import {
  consumeCaseNonce,
  getOrCreateCaseSeed,
  requireCaseSeed,
  rotateCaseSeed,
} from './fairness'
import type {
  CaseHistoryFilters,
  CaseOpenBatchResponse,
  CaseOpenRequest,
  CaseOpenResponse,
  CrateDetailResponse,
  CrateListFilters,
} from './schema'
import {
  caseUnitInterval,
  convertCratePayout,
  crateMultiplier,
  pickCrateItemIndex,
  totalCrateWeight,
} from './util'

type CrateRow = typeof schema.crate.$inferSelect
type CrateRevisionRow = typeof schema.crateRevision.$inferSelect
type CaseOpenRow = typeof schema.caseOpen.$inferSelect
type CurrencyRow = typeof schema.currency.$inferSelect

interface CrateContext {
  active: CurrencyRow
  baseDecimals: number
  basePrice: bigint
  crate: CrateRow
  price: bigint
  revision: CrateRevisionRow
}

interface OpenCrateInput extends CaseOpenRequest {
  batchCount?: number
  idempotencyKey: string
}

async function publishedCrate(db: Db, slug: string) {
  const row = await db.query.crate.findFirst({
    where: and(
      eq(schema.crate.slug, slug),
      eq(schema.crate.status, 'published'),
    ),
  })
  if (!row?.currentRevisionId || !row.baseCurrency) {
    throw httpErrors.notFound('Crate not found')
  }
  return row
}

async function crateContext(
  db: Db,
  slug: string,
  requestedCurrency?: string,
): Promise<CrateContext> {
  const crate = await publishedCrate(db, slug)
  const [revision, active, base] = await Promise.all([
    db.query.crateRevision.findFirst({
      where: eq(schema.crateRevision.id, crate.currentRevisionId ?? ''),
    }),
    findCurrency(db, requestedCurrency),
    findCurrency(db, crate.baseCurrency ?? undefined),
  ])
  if (!revision) {
    throw httpErrors.notFound('Crate revision not found')
  }
  const [priceRow, basePriceRow] = await Promise.all([
    db.query.cratePrice.findFirst({
      where: and(
        eq(schema.cratePrice.crateId, crate.id),
        eq(schema.cratePrice.currency, active.code),
      ),
    }),
    db.query.cratePrice.findFirst({
      where: and(
        eq(schema.cratePrice.crateId, crate.id),
        eq(schema.cratePrice.currency, base.code),
      ),
    }),
  ])
  if (!priceRow || !basePriceRow) {
    throw httpErrors.notFound('Crate price is not available for this currency')
  }

  return {
    active,
    baseDecimals: base.decimals,
    basePrice: basePriceRow.price,
    crate,
    price: priceRow.price,
    revision,
  }
}

function parseItemPayout(item: { payout: string }, decimals: number) {
  return parseAmount(item.payout, decimals)
}

function maxMultiplier(
  revision: CrateRevisionRow,
  baseDecimals: number,
  basePrice: bigint,
) {
  let maxCenti = 0n
  for (const item of revision.items) {
    const payout = parseItemPayout(item, baseDecimals)
    if (basePrice <= 0n) {
      continue
    }
    const centi = (payout * 100n) / basePrice
    if (centi > maxCenti) {
      maxCenti = centi
    }
  }
  return `${maxCenti / 100n}.${(maxCenti % 100n).toString().padStart(2, '0')}`
}

function crateSummary(context: CrateContext) {
  return {
    coverUrl: context.crate.coverUrl,
    currency: context.active.code,
    decimals: context.active.decimals,
    id: context.crate.id,
    maxMultiplier: maxMultiplier(
      context.revision,
      context.baseDecimals,
      context.basePrice,
    ),
    name: context.crate.name,
    price: formatAmount(context.price, context.active.decimals),
    rtpBps: context.revision.rtpBps,
    slug: context.crate.slug,
    sortOrder: context.crate.sortOrder,
    tag: context.crate.tag,
    version: context.crate.version,
  }
}

function crateDetail(context: CrateContext): CrateDetailResponse {
  const total = totalCrateWeight(context.revision.items)
  return {
    ...crateSummary(context),
    items: context.revision.items.map((item) => {
      const probability = total > 0 ? item.weight / total : 0
      return {
        id: item.id,
        imageUrl: item.imageUrl,
        multiplier: crateMultiplier(
          parseItemPayout(item, context.baseDecimals),
          context.basePrice,
        ),
        name: item.name,
        oddsPercent: (probability * 100).toFixed(4),
        oneIn:
          probability > 0 && probability < 0.0001
            ? Math.round(1 / probability)
            : null,
        rarity: item.rarity,
        slug: item.slug,
        sortOrder: item.sortOrder,
        weight: item.weight,
      }
    }),
  }
}

export async function listCrates(db: Db, query: CrateListFilters) {
  const active = await findCurrency(db, query.currency)
  const filters: SQL[] = [
    eq(schema.crate.status, 'published'),
    eq(schema.cratePrice.currency, active.code),
  ]
  if (query.tag) {
    filters.push(eq(schema.crate.tag, query.tag))
  }
  if (query.search) {
    const pattern = `%${query.search}%`
    const search = or(
      ilike(schema.crate.name, pattern),
      ilike(schema.crate.slug, pattern),
    )
    if (search) {
      filters.push(search)
    }
  }

  const rows = await db
    .select({ crate: schema.crate })
    .from(schema.crate)
    .innerJoin(
      schema.cratePrice,
      eq(schema.cratePrice.crateId, schema.crate.id),
    )
    .where(and(...filters))
    .orderBy(schema.crate.sortOrder, schema.crate.slug)
    .limit(query.limit)

  const items = await Promise.all(
    rows.map(({ crate }) => crateContext(db, crate.slug, active.code)),
  )
  return {
    currency: active.code,
    decimals: active.decimals,
    items: items.map(crateSummary),
  }
}

export async function getCrate(
  db: Db,
  slug: string,
  requestedCurrency?: string,
) {
  return crateDetail(await crateContext(db, slug, requestedCurrency))
}

export function getActiveCaseSeed(db: Db, config: AppConfig, userId: string) {
  return getOrCreateCaseSeed(db, config, userId)
}

export function rotateActiveCaseSeed(
  db: Db,
  config: AppConfig,
  userId: string,
) {
  return rotateCaseSeed(db, config, userId)
}

async function finalBalanceAfter(
  db: Db,
  walletId: string,
  idempotencyKey: string,
) {
  const rows = await db
    .select()
    .from(schema.walletTransaction)
    .where(
      and(
        eq(schema.walletTransaction.walletId, walletId),
        inArray(schema.walletTransaction.idempotencyKey, [
          `${idempotencyKey}:debit`,
          `${idempotencyKey}:payout`,
        ]),
      ),
    )
  return (
    (
      rows.find((row) => row.idempotencyKey === `${idempotencyKey}:payout`) ??
      rows.find((row) => row.idempotencyKey === `${idempotencyKey}:debit`)
    )?.balanceAfter ?? null
  )
}

async function openResponse(
  db: Db,
  open: CaseOpenRow,
  balanceAfter?: bigint,
): Promise<CaseOpenResponse> {
  const [revision, seed, active] = await Promise.all([
    db.query.crateRevision.findFirst({
      where: eq(schema.crateRevision.id, open.revisionId),
    }),
    requireCaseSeed(db, open.seedId),
    findCurrency(db, open.currency),
  ])
  const item = revision?.items[open.result.itemIndex]
  if (!revision || !item) {
    throw new Error('Case open revision item is missing')
  }

  return {
    amount: formatAmount(open.amount, active.decimals),
    balanceAfter:
      balanceAfter === undefined
        ? null
        : formatAmount(balanceAfter, active.decimals),
    clientSeed: open.clientSeed,
    crateSlug: open.result.crateSlug,
    crateVersion: open.result.crateVersion,
    createdAt: open.createdAt.toISOString(),
    currency: open.currency,
    decimals: active.decimals,
    id: open.id,
    item: {
      id: item.id,
      imageUrl: item.imageUrl,
      multiplier: crateMultiplier(open.payout, open.amount),
      name: item.name,
      rarity: item.rarity,
      slug: item.slug,
    },
    itemIndex: open.result.itemIndex,
    multiplier: crateMultiplier(open.payout, open.amount),
    nonce: open.nonce,
    payout: formatAmount(open.payout, active.decimals),
    payoutCapped: open.result.payoutCapped,
    revisionId: open.revisionId,
    serverSeedHash: seed.serverSeedHash,
    won: open.payout > open.amount,
  }
}

export async function openCrate(
  db: Db,
  config: AppConfig,
  userId: string,
  input: OpenCrateInput,
): Promise<CaseOpenResponse> {
  const context = await crateContext(db, input.crateSlug, input.currency)
  const requestHash = hashGameBetRequest('case', {
    clientSeed: input.clientSeed,
    crateSlug: context.crate.slug,
    crateVersion: context.crate.version,
    currency: context.active.code,
    ...(input.batchCount === undefined ? {} : { count: input.batchCount }),
  })
  const existing = await db.query.caseOpen.findFirst({
    where: and(
      eq(schema.caseOpen.userId, userId),
      eq(schema.caseOpen.idempotencyKey, input.idempotencyKey),
    ),
  })
  if (existing) {
    assertIdempotentRequest(existing.requestHash, requestHash)
    const wallet = await ensureWallet(db, userId, context.active.code)
    return openResponse(
      db,
      existing,
      (await finalBalanceAfter(db, wallet.id, input.idempotencyKey)) ??
        undefined,
    )
  }

  assertBettingCurrency(context.active)
  const limits = getDefaultBetLimits(config, context.active)
  assertBetAmount(context.price, limits)
  const wallet = await ensureWallet(db, userId, context.active.code)
  const riskContext = {
    amount: context.price,
    currency: context.active.code,
    game: 'case',
    idempotencyKey: input.idempotencyKey,
    userId,
  }

  try {
    const settlement = await db.transaction(async (tx) => {
      await assertBetAllowedInTransaction(tx, riskContext)
      const seed = await consumeCaseNonce(tx, config, userId)
      const unit = caseUnitInterval(
        seed.serverSeed,
        input.clientSeed,
        seed.nonce,
      )
      const itemIndex = pickCrateItemIndex(context.revision.items, unit)
      const item = context.revision.items[itemIndex]
      if (!item) {
        throw new Error('Case drop table selection failed')
      }
      const itemPayout = parseItemPayout(item, context.baseDecimals)
      const theoretical = convertCratePayout(
        itemPayout,
        context.basePrice,
        context.price,
      )
      const payout = capPayout(theoretical, limits.maxPayout)
      const openId = randomUUID()
      const result = {
        crateId: context.crate.id,
        crateSlug: context.crate.slug,
        crateVersion: context.crate.version,
        itemId: item.id,
        itemIndex,
        itemPayout: item.payout,
        payoutCapped: payout < theoretical,
        revisionId: context.revision.id,
      }

      const debit = await debitInTransaction(tx, {
        amount: context.price,
        idempotencyKey: `${input.idempotencyKey}:debit`,
        reference: {
          referenceId: openId,
          referenceType: WALLET_REFERENCES.caseBet,
        },
        walletId: wallet.id,
      })
      let balanceAfter = debit.balanceAfter
      if (payout > 0n) {
        const credit = await creditInTransaction(tx, {
          amount: payout,
          idempotencyKey: `${input.idempotencyKey}:payout`,
          reference: {
            referenceId: openId,
            referenceType: WALLET_REFERENCES.casePayout,
          },
          walletId: wallet.id,
        })
        balanceAfter = credit.balanceAfter
      }

      const [created] = await tx
        .insert(schema.caseOpen)
        .values({
          amount: context.price,
          clientSeed: input.clientSeed,
          crateId: context.crate.id,
          currency: context.active.code,
          id: openId,
          idempotencyKey: input.idempotencyKey,
          nonce: seed.nonce,
          payout,
          requestHash,
          result,
          revisionId: context.revision.id,
          seedId: seed.seedId,
          status: 'settled',
          userId,
          walletId: wallet.id,
        })
        .returning()
      if (!created) {
        throw new Error('Failed to record case open')
      }
      await recordBetPayoutInTransaction(tx, riskContext, payout)
      return { balanceAfter, open: created }
    })

    return openResponse(db, settlement.open, settlement.balanceAfter)
  } catch (error) {
    if (isRiskRejection(error)) {
      await recordBetRejected(db, riskContext, error.code)
      throw error
    }
    if (findErrorCode(error) !== '23505') {
      throw error
    }
    const replay = await db.query.caseOpen.findFirst({
      where: and(
        eq(schema.caseOpen.userId, userId),
        eq(schema.caseOpen.idempotencyKey, input.idempotencyKey),
      ),
    })
    if (!replay) {
      throw error
    }
    assertIdempotentRequest(replay.requestHash, requestHash)
    return openResponse(
      db,
      replay,
      (await finalBalanceAfter(db, wallet.id, input.idempotencyKey)) ??
        undefined,
    )
  }
}

function errorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Unknown case open failure'
  }
  const statusCode = 'statusCode' in error ? error.statusCode : undefined
  return typeof statusCode === 'number' && statusCode >= 500
    ? 'Internal Server Error'
    : error.message
}

export async function openCrateBatch(
  db: Db,
  config: AppConfig,
  userId: string,
  input: OpenCrateInput & { count: number },
): Promise<CaseOpenBatchResponse> {
  const context = await crateContext(db, input.crateSlug, input.currency)
  const requestHash = hashGameBetRequest('case', {
    clientSeed: input.clientSeed,
    count: input.count,
    crateSlug: context.crate.slug,
    crateVersion: context.crate.version,
    currency: context.active.code,
  })
  const first = await db.query.caseOpen.findFirst({
    where: and(
      eq(schema.caseOpen.userId, userId),
      eq(schema.caseOpen.idempotencyKey, `${input.idempotencyKey}:0`),
    ),
  })
  if (first) {
    assertIdempotentRequest(first.requestHash, requestHash)
  }

  const opens: CaseOpenResponse[] = []
  const failed: CaseOpenBatchResponse['failed'] = []

  for (let index = 0; index < input.count; index += 1) {
    try {
      opens.push(
        await openCrate(db, config, userId, {
          ...input,
          batchCount: input.count,
          idempotencyKey: `${input.idempotencyKey}:${index}`,
        }),
      )
    } catch (error) {
      failed.push({ error: errorMessage(error), index })
    }
  }
  return { failed, opens }
}

export async function listCaseOpens(
  db: Db,
  userId: string,
  query: CaseHistoryFilters,
) {
  const filters: SQL[] = [
    eq(schema.caseOpen.userId, userId),
    eq(schema.caseOpen.status, 'settled'),
  ]
  if (query.crateSlug) {
    const crate = await db.query.crate.findFirst({
      columns: { id: true },
      where: eq(schema.crate.slug, query.crateSlug),
    })
    if (!crate) {
      return { items: [], nextCursor: null }
    }
    filters.push(eq(schema.caseOpen.crateId, crate.id))
  }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor)
    const createdAt = new Date(cursor.createdAt)
    const condition = or(
      lt(schema.caseOpen.createdAt, createdAt),
      and(
        eq(schema.caseOpen.createdAt, createdAt),
        lt(schema.caseOpen.id, cursor.id),
      ),
    )
    if (condition) {
      filters.push(condition)
    }
  }

  const rows = await db.query.caseOpen.findMany({
    limit: query.limit + 1,
    orderBy: [desc(schema.caseOpen.createdAt), desc(schema.caseOpen.id)],
    where: and(...filters),
  })
  const page = rows.slice(0, query.limit)
  const last = page.at(-1)
  return {
    items: await Promise.all(
      page.map((row) => openResponse(db, row, undefined)),
    ),
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  }
}

export async function verifyCaseOpen(
  db: Db,
  config: AppConfig,
  userId: string,
  openId: string,
) {
  const open = await db.query.caseOpen.findFirst({
    where: and(
      eq(schema.caseOpen.id, openId),
      eq(schema.caseOpen.userId, userId),
    ),
  })
  if (!open) {
    throw httpErrors.notFound('Case open not found')
  }
  const [revision, seed] = await Promise.all([
    db.query.crateRevision.findFirst({
      where: eq(schema.crateRevision.id, open.revisionId),
    }),
    requireCaseSeed(db, open.seedId),
  ])
  if (!revision) {
    throw httpErrors.notFound('Crate revision not found')
  }
  const expectedItemIndex = pickCrateItemIndex(
    revision.items,
    caseUnitInterval(
      decryptSeed(seed.serverSeed, config),
      open.clientSeed,
      open.nonce,
    ),
  )
  const revealed = seed.status === 'revealed'
  return {
    clientSeed: open.clientSeed,
    expectedItemIndex,
    itemIndex: open.result.itemIndex,
    message: revealed
      ? 'Verification data is complete'
      : 'Server seed is not revealed yet',
    nonce: open.nonce,
    openId: open.id,
    revisionId: open.revisionId,
    serverSeed: revealed ? decryptSeed(seed.serverSeed, config) : null,
    serverSeedHash: seed.serverSeedHash,
    valid: expectedItemIndex === open.result.itemIndex,
    weights: revision.items.map((item) => item.weight),
  }
}
