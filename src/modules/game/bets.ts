import { createHash, randomUUID } from 'node:crypto'

import { and, eq, inArray } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import type { AppConfig } from '@/lib/config'
import { findErrorCode } from '@/lib/errors'
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
import type { WalletReferenceType } from '@/modules/wallet/util'

import { consumeNonce } from './fairness'
import type { ConsumedSeed } from './fairness'
import {
  assertBetAmount,
  assertBettingCurrency,
  capPayout,
  getBetLimits,
} from './limits'

export type GameBetRow = typeof schema.gameBet.$inferSelect

export function hashGameBetRequest(
  game: string,
  values: Record<string, bigint | number | string>,
) {
  const payload = [
    ['game', game],
    ...Object.keys(values)
      .toSorted()
      .map((key) => {
        const value = values[key]
        return [key, typeof value === 'bigint' ? value.toString() : value]
      }),
  ]
  const digest = createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
  return `v1:${digest}`
}

interface SingleShotBetInput<TResult extends Record<string, unknown>> {
  active: typeof schema.currency.$inferSelect
  amount: bigint
  clientSeed: string
  config: AppConfig
  createResult: (seed: ConsumedSeed) => {
    payout: bigint
    result: TResult
  }
  db: Db
  game: { id: string; rtp: number | null }
  gameSlug: string
  idempotencyKey: string
  referenceTypes: {
    bet: WalletReferenceType
    payout: WalletReferenceType
  }
  requestHash: string
  userId: string
}

interface SingleShotBetResult {
  balanceAfter: bigint | null
  bet: GameBetRow
  replayed: boolean
}

export function findGameBet(db: Db, userId: string, idempotencyKey: string) {
  return db.query.gameBet.findFirst({
    where: and(
      eq(schema.gameBet.userId, userId),
      eq(schema.gameBet.idempotencyKey, idempotencyKey),
    ),
  })
}

export function assertIdempotentRequest(
  existingHash: string,
  requestedHash: string,
) {
  if (existingHash !== requestedHash) {
    throw Object.assign(
      new Error('Idempotency key was already used with different parameters'),
      { statusCode: 409 },
    )
  }
}

async function finalBalanceAfter(
  db: Db,
  walletId: string,
  idempotencyKey: string,
) {
  const transactions = await db
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
  const payout = transactions.find(
    (transaction) => transaction.idempotencyKey === `${idempotencyKey}:payout`,
  )
  const debit = transactions.find(
    (transaction) => transaction.idempotencyKey === `${idempotencyKey}:debit`,
  )
  return (payout ?? debit)?.balanceAfter ?? null
}

export async function placeSingleShotBet<
  TResult extends Record<string, unknown>,
>(input: SingleShotBetInput<TResult>): Promise<SingleShotBetResult> {
  const existing = await findGameBet(
    input.db,
    input.userId,
    input.idempotencyKey,
  )
  if (existing) {
    assertIdempotentRequest(existing.requestHash, input.requestHash)
    const wallet = await ensureWallet(input.db, input.userId, input.active.code)
    return {
      balanceAfter: await finalBalanceAfter(
        input.db,
        wallet.id,
        input.idempotencyKey,
      ),
      bet: existing,
      replayed: true,
    }
  }

  assertBettingCurrency(input.active)
  const limits = await getBetLimits(
    input.db,
    input.config,
    input.game.id,
    input.active,
  )
  assertBetAmount(input.amount, limits)
  const wallet = await ensureWallet(input.db, input.userId, input.active.code)
  const riskContext = {
    amount: input.amount,
    currency: input.active.code,
    game: input.gameSlug,
    idempotencyKey: input.idempotencyKey,
    userId: input.userId,
  }

  try {
    const settlement = await input.db.transaction(async (tx) => {
      await assertBetAllowedInTransaction(tx, riskContext)
      const seed = await consumeNonce(
        tx,
        input.config,
        input.userId,
        input.game.id,
      )
      const generated = input.createResult(seed)
      if (generated.payout < 0n) {
        throw new Error('Game payout must not be negative')
      }
      const payout = capPayout(generated.payout, limits.maxPayout)
      const betId = randomUUID()

      const debit = await debitInTransaction(tx, {
        amount: input.amount,
        idempotencyKey: `${input.idempotencyKey}:debit`,
        reference: {
          referenceId: betId,
          referenceType: input.referenceTypes.bet,
        },
        walletId: wallet.id,
      })
      let { balanceAfter } = debit

      if (payout > 0n) {
        const credit = await creditInTransaction(tx, {
          amount: payout,
          idempotencyKey: `${input.idempotencyKey}:payout`,
          reference: {
            referenceId: betId,
            referenceType: input.referenceTypes.payout,
          },
          walletId: wallet.id,
        })
        ;({ balanceAfter } = credit)
      }

      const [bet] = await tx
        .insert(schema.gameBet)
        .values({
          amount: input.amount,
          clientSeed: input.clientSeed,
          currency: input.active.code,
          gameId: input.game.id,
          id: betId,
          idempotencyKey: input.idempotencyKey,
          nonce: seed.nonce,
          payout,
          requestHash: input.requestHash,
          result: generated.result,
          seedId: seed.seedId,
          status: 'settled',
          userId: input.userId,
          walletId: wallet.id,
        })
        .returning()
      if (!bet) {
        throw new Error('Failed to record game bet')
      }

      await tx
        .insert(schema.userRecentGame)
        .values({ gameId: input.game.id, userId: input.userId })
        .onConflictDoUpdate({
          set: { playedAt: new Date() },
          target: [schema.userRecentGame.userId, schema.userRecentGame.gameId],
        })
      await recordBetPayoutInTransaction(tx, riskContext, payout)

      return { balanceAfter, bet }
    })

    return { ...settlement, replayed: false }
  } catch (error) {
    if (isRiskRejection(error)) {
      await recordBetRejected(input.db, riskContext, error.code)
      throw error
    }
    if (findErrorCode(error) !== '23505') {
      throw error
    }

    const replay = await findGameBet(
      input.db,
      input.userId,
      input.idempotencyKey,
    )
    if (!replay) {
      throw error
    }
    assertIdempotentRequest(replay.requestHash, input.requestHash)
    return {
      balanceAfter: await finalBalanceAfter(
        input.db,
        wallet.id,
        input.idempotencyKey,
      ),
      bet: replay,
      replayed: true,
    }
  }
}
