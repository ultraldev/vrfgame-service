import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'

import { httpErrors } from '@fastify/sensible'
import { and, eq, sql } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import type { AppConfig } from '@/lib/config'
import { decryptSeed, encryptSeed } from '@/lib/seed-cipher'
import type { WalletTransaction } from '@/modules/wallet/ledger'

export interface ActiveSeed {
  nextNonce: number
  seedId: string
  serverSeedHash: string
}

export interface ConsumedSeed {
  nonce: number
  seedId: string
  serverSeed: string
  serverSeedHash: string
}

const UINT32_RANGE = 0x1_00_00_00_00

export function hashServerSeed(serverSeed: string) {
  return createHash('sha256').update(serverSeed).digest('hex')
}

export function roll(serverSeed: string, clientSeed: string, nonce: number) {
  const digest = createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex')
  const uint32 = Number.parseInt(digest.slice(0, 8), 16)
  return Math.floor((uint32 / UINT32_RANGE) * 10_000)
}

export function pfUint32(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  cursor: number,
) {
  const digest = createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}:${cursor}`)
    .digest('hex')
  return Number.parseInt(digest.slice(0, 8), 16)
}

export function pfRangedInt(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  cursor: number,
  bound: number,
) {
  return Math.floor(
    (pfUint32(serverSeed, clientSeed, nonce, cursor) / UINT32_RANGE) * bound,
  )
}

async function lockUserGameSeed(
  tx: WalletTransaction,
  userId: string,
  gameId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`fairness:${userId}:${gameId}`}, 0))`,
  )
}

async function createActiveSeed(
  tx: WalletTransaction,
  config: AppConfig,
  userId: string,
  gameId: string,
) {
  const serverSeed = randomBytes(32).toString('hex')

  const [created] = await tx
    .insert(schema.fairnessSeed)
    .values({
      gameId,
      id: randomUUID(),
      nonce: 0,
      serverSeed: encryptSeed(serverSeed, config),
      serverSeedHash: hashServerSeed(serverSeed),
      status: 'active',
      userId,
    })
    .returning()

  if (!created) {
    throw new Error('Failed to create fairness seed')
  }

  return created
}

export async function getOrCreateActiveSeed(
  db: Db,
  config: AppConfig,
  userId: string,
  gameId: string,
) {
  const active = await db.transaction(async (tx) => {
    await lockUserGameSeed(tx, userId, gameId)
    const existing = await tx.query.fairnessSeed.findFirst({
      where: and(
        eq(schema.fairnessSeed.userId, userId),
        eq(schema.fairnessSeed.gameId, gameId),
        eq(schema.fairnessSeed.status, 'active'),
      ),
    })

    return existing ?? createActiveSeed(tx, config, userId, gameId)
  })

  return {
    nextNonce: active.nonce,
    seedId: active.id,
    serverSeedHash: active.serverSeedHash,
  } satisfies ActiveSeed
}

export async function consumeNonce(
  tx: WalletTransaction,
  config: AppConfig,
  userId: string,
  gameId: string,
) {
  await lockUserGameSeed(tx, userId, gameId)
  const [active] = await tx
    .select()
    .from(schema.fairnessSeed)
    .where(
      and(
        eq(schema.fairnessSeed.userId, userId),
        eq(schema.fairnessSeed.gameId, gameId),
        eq(schema.fairnessSeed.status, 'active'),
      ),
    )
    .for('update')
  const seed = active ?? (await createActiveSeed(tx, config, userId, gameId))
  const { nonce } = seed
  const [updated] = await tx
    .update(schema.fairnessSeed)
    .set({ nonce: nonce + 1 })
    .where(eq(schema.fairnessSeed.id, seed.id))
    .returning()

  if (!updated) {
    throw new Error('Failed to advance fairness seed')
  }

  return {
    nonce,
    seedId: updated.id,
    serverSeed: decryptSeed(updated.serverSeed, config),
    serverSeedHash: updated.serverSeedHash,
  } satisfies ConsumedSeed
}

export function rotateSeed(
  db: Db,
  config: AppConfig,
  userId: string,
  gameId: string,
) {
  return db.transaction(async (tx) => {
    await lockUserGameSeed(tx, userId, gameId)

    const activeBet = await tx.query.gameBet.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.gameBet.userId, userId),
        eq(schema.gameBet.gameId, gameId),
        eq(schema.gameBet.status, 'active'),
      ),
    })
    if (activeBet) {
      throw httpErrors.conflict(
        'Finish or cash out the current game before rotating the seed',
      )
    }

    const [active] = await tx
      .select()
      .from(schema.fairnessSeed)
      .where(
        and(
          eq(schema.fairnessSeed.userId, userId),
          eq(schema.fairnessSeed.gameId, gameId),
          eq(schema.fairnessSeed.status, 'active'),
        ),
      )
      .for('update')

    if (!active) {
      throw httpErrors.notFound('No active seed found')
    }

    const [revealed] = await tx
      .update(schema.fairnessSeed)
      .set({ revealedAt: new Date(), status: 'revealed' })
      .where(eq(schema.fairnessSeed.id, active.id))
      .returning()
    const created = await createActiveSeed(tx, config, userId, gameId)

    if (!revealed) {
      throw new Error('Failed to reveal fairness seed')
    }

    return {
      active: {
        nextNonce: created.nonce,
        seedId: created.id,
        serverSeedHash: created.serverSeedHash,
      },
      revealed: {
        nonce: revealed.nonce,
        seedId: revealed.id,
        serverSeed: decryptSeed(revealed.serverSeed, config),
        serverSeedHash: revealed.serverSeedHash,
      },
    }
  })
}

export async function getSeedById(db: Db, seedId: string | null) {
  if (!seedId) {
    throw httpErrors.notFound('Seed not found')
  }
  const seed = await db.query.fairnessSeed.findFirst({
    where: eq(schema.fairnessSeed.id, seedId),
  })
  if (!seed) {
    throw httpErrors.notFound('Seed not found')
  }
  return seed
}
