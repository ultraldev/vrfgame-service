import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { httpErrors } from '@fastify/sensible'
import { and, eq, sql } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import type { AppConfig } from '@/lib/config'
import { decryptSeed, encryptSeed } from '@/lib/seed-cipher'
import type { WalletTransaction } from '@/modules/wallet/ledger'

function hashServerSeed(serverSeed: string) {
  return createHash('sha256').update(serverSeed).digest('hex')
}

function lockUserSeed(tx: WalletTransaction, userId: string) {
  return tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`case-fairness:${userId}`}, 0))`,
  )
}

async function createActiveSeed(
  tx: WalletTransaction,
  config: AppConfig,
  userId: string,
) {
  const serverSeed = randomBytes(32).toString('hex')
  const [created] = await tx
    .insert(schema.caseFairnessSeed)
    .values({
      id: randomUUID(),
      nonce: 0,
      serverSeed: encryptSeed(serverSeed, config),
      serverSeedHash: hashServerSeed(serverSeed),
      status: 'active',
      userId,
    })
    .returning()
  if (!created) {
    throw new Error('Failed to create case fairness seed')
  }
  return created
}

export async function getOrCreateCaseSeed(
  db: Db,
  config: AppConfig,
  userId: string,
) {
  const active = await db.transaction(async (tx) => {
    await lockUserSeed(tx, userId)
    const existing = await tx.query.caseFairnessSeed.findFirst({
      where: and(
        eq(schema.caseFairnessSeed.userId, userId),
        eq(schema.caseFairnessSeed.status, 'active'),
      ),
    })
    return existing ?? createActiveSeed(tx, config, userId)
  })

  return {
    nextNonce: active.nonce,
    seedId: active.id,
    serverSeedHash: active.serverSeedHash,
  }
}

export async function consumeCaseNonce(
  tx: WalletTransaction,
  config: AppConfig,
  userId: string,
) {
  await lockUserSeed(tx, userId)
  const [active] = await tx
    .select()
    .from(schema.caseFairnessSeed)
    .where(
      and(
        eq(schema.caseFairnessSeed.userId, userId),
        eq(schema.caseFairnessSeed.status, 'active'),
      ),
    )
    .for('update')
  const seed = active ?? (await createActiveSeed(tx, config, userId))
  const { nonce } = seed
  const [updated] = await tx
    .update(schema.caseFairnessSeed)
    .set({ nonce: nonce + 1 })
    .where(eq(schema.caseFairnessSeed.id, seed.id))
    .returning()
  if (!updated) {
    throw new Error('Failed to advance case fairness seed')
  }

  return {
    nonce,
    seedId: updated.id,
    serverSeed: decryptSeed(updated.serverSeed, config),
    serverSeedHash: updated.serverSeedHash,
  }
}

export function rotateCaseSeed(db: Db, config: AppConfig, userId: string) {
  return db.transaction(async (tx) => {
    await lockUserSeed(tx, userId)
    const [active] = await tx
      .select()
      .from(schema.caseFairnessSeed)
      .where(
        and(
          eq(schema.caseFairnessSeed.userId, userId),
          eq(schema.caseFairnessSeed.status, 'active'),
        ),
      )
      .for('update')
    if (!active) {
      throw httpErrors.notFound('No active case seed found')
    }

    const [revealed] = await tx
      .update(schema.caseFairnessSeed)
      .set({ revealedAt: new Date(), status: 'revealed' })
      .where(eq(schema.caseFairnessSeed.id, active.id))
      .returning()
    if (!revealed) {
      throw new Error('Failed to reveal case fairness seed')
    }
    const created = await createActiveSeed(tx, config, userId)

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

export async function requireCaseSeed(db: Db, seedId: string) {
  const seed = await db.query.caseFairnessSeed.findFirst({
    where: eq(schema.caseFairnessSeed.id, seedId),
  })
  if (!seed) {
    throw httpErrors.notFound('Case seed not found')
  }
  return seed
}
