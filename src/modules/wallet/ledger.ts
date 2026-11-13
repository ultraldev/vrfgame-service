import { randomUUID } from 'node:crypto'

import { httpErrors } from '@fastify/sensible'
import { and, eq } from 'drizzle-orm'

import type { Db } from '@/db'
import * as schema from '@/db/schema'

import type { WalletReferenceType } from './util'

export type WalletTransaction = Parameters<Parameters<Db['transaction']>[0]>[0]

export interface WalletRef {
  referenceId: string
  referenceType: WalletReferenceType
}

export interface WalletMutationResult {
  balanceAfter: bigint
  currency: string
  /**
   * Locked balance produced by this mutation, or `null` on an idempotent
   * replay. Wallet transactions do not retain the historical locked balance,
   * so substituting the current value would describe a state that never
   * existed.
   */
  lockedBalanceAfter: bigint | null
  replayed: boolean
  transactionId: string
  userId: string
  version: number
}

type WalletState = Pick<
  typeof schema.wallet.$inferSelect,
  'balance' | 'lockedBalance' | 'version'
>

export type LedgerMutation =
  | {
      amount: bigint
      type: 'credit' | 'debit' | 'lock' | 'unlock'
    }
  | {
      amount: bigint
      type: 'chargeback'
    }
  | {
      lockedAmount: bigint
      payout: bigint
      type: 'settle'
    }

interface WalletMutationInput {
  idempotencyKey?: string
  reference: WalletRef
  walletId: string
}

export interface DebitInput extends WalletMutationInput {
  amount: bigint
}

export interface CreditInput extends WalletMutationInput {
  amount: bigint
}

export interface LockInput extends WalletMutationInput {
  amount: bigint
}

export interface UnlockInput extends WalletMutationInput {
  amount: bigint
}

export interface SettleInput extends WalletMutationInput {
  lockedAmount: bigint
  payout: bigint
}

interface WalletMutation {
  balance: bigint
  lockedBalance: bigint
  transactionAmount: bigint
  type: 'credit' | 'debit' | 'lock' | 'unlock' | 'settle'
  version: number
}

function assertPositiveAmount(amount: bigint, label = 'Amount') {
  if (amount <= 0n) {
    throw httpErrors.badRequest(`${label} must be positive`)
  }
}

export function assertLedgerMutation(mutation: LedgerMutation) {
  if (mutation.type === 'settle') {
    assertPositiveAmount(mutation.lockedAmount, 'Locked amount')
    if (mutation.payout < 0n) {
      throw httpErrors.badRequest('Payout must not be negative')
    }
    return
  }

  assertPositiveAmount(mutation.amount)
}

export function applyLedgerMutation(
  wallet: WalletState,
  mutation: LedgerMutation,
): WalletMutation {
  assertLedgerMutation(mutation)
  const version = wallet.version + 1

  switch (mutation.type) {
    case 'debit': {
      if (wallet.balance < mutation.amount) {
        throw httpErrors.badRequest('Insufficient balance')
      }
      return {
        balance: wallet.balance - mutation.amount,
        lockedBalance: wallet.lockedBalance,
        transactionAmount: mutation.amount,
        type: mutation.type,
        version,
      }
    }
    case 'chargeback': {
      return {
        balance: wallet.balance - mutation.amount,
        lockedBalance: wallet.lockedBalance,
        transactionAmount: mutation.amount,
        type: 'debit',
        version,
      }
    }
    case 'credit': {
      return {
        balance: wallet.balance + mutation.amount,
        lockedBalance: wallet.lockedBalance,
        transactionAmount: mutation.amount,
        type: mutation.type,
        version,
      }
    }
    case 'lock': {
      if (wallet.balance < mutation.amount) {
        throw httpErrors.badRequest('Insufficient balance')
      }
      return {
        balance: wallet.balance - mutation.amount,
        lockedBalance: wallet.lockedBalance + mutation.amount,
        transactionAmount: mutation.amount,
        type: mutation.type,
        version,
      }
    }
    case 'unlock': {
      if (wallet.lockedBalance < mutation.amount) {
        throw httpErrors.badRequest('Insufficient locked balance')
      }
      return {
        balance: wallet.balance + mutation.amount,
        lockedBalance: wallet.lockedBalance - mutation.amount,
        transactionAmount: mutation.amount,
        type: mutation.type,
        version,
      }
    }
    case 'settle': {
      if (wallet.lockedBalance < mutation.lockedAmount) {
        throw httpErrors.badRequest('Insufficient locked balance')
      }
      return {
        balance: wallet.balance + mutation.payout,
        lockedBalance: wallet.lockedBalance - mutation.lockedAmount,
        transactionAmount: mutation.payout,
        type: mutation.type,
        version,
      }
    }
    default: {
      throw new Error('Unsupported wallet mutation')
    }
  }
}

async function findReplay(
  tx: WalletTransaction,
  walletId: string,
  idempotencyKey: string,
): Promise<WalletMutationResult | null> {
  const existing = await tx.query.walletTransaction.findFirst({
    where: and(
      eq(schema.walletTransaction.walletId, walletId),
      eq(schema.walletTransaction.idempotencyKey, idempotencyKey),
    ),
  })

  if (!existing) {
    return null
  }

  const wallet = await tx.query.wallet.findFirst({
    columns: { currency: true, userId: true },
    where: eq(schema.wallet.id, walletId),
  })

  if (!wallet) {
    throw httpErrors.notFound('Wallet not found')
  }

  return {
    balanceAfter: existing.balanceAfter,
    currency: wallet.currency,
    lockedBalanceAfter: null,
    replayed: true,
    transactionId: existing.id,
    userId: wallet.userId,
    version: existing.version,
  }
}

async function lockWallet(tx: WalletTransaction, walletId: string) {
  const [wallet] = await tx
    .select()
    .from(schema.wallet)
    .where(eq(schema.wallet.id, walletId))
    .for('update')

  if (!wallet) {
    throw httpErrors.notFound('Wallet not found')
  }

  return wallet
}

async function mutate(
  tx: WalletTransaction,
  input: WalletMutationInput,
  mutation: LedgerMutation,
): Promise<WalletMutationResult> {
  assertLedgerMutation(mutation)

  if (input.idempotencyKey) {
    const replay = await findReplay(tx, input.walletId, input.idempotencyKey)
    if (replay) {
      return replay
    }
  }

  const wallet = await lockWallet(tx, input.walletId)
  const next = applyLedgerMutation(wallet, mutation)

  await tx
    .update(schema.wallet)
    .set({
      balance: next.balance,
      lockedBalance: next.lockedBalance,
      version: next.version,
    })
    .where(eq(schema.wallet.id, input.walletId))

  const [transaction] = await tx
    .insert(schema.walletTransaction)
    .values({
      amount: next.transactionAmount,
      balanceAfter: next.balance,
      id: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      referenceId: input.reference.referenceId,
      referenceType: input.reference.referenceType,
      type: next.type,
      version: next.version,
      walletId: input.walletId,
    })
    .returning()

  if (!transaction) {
    throw new Error('Failed to record wallet transaction')
  }

  return {
    balanceAfter: next.balance,
    currency: wallet.currency,
    lockedBalanceAfter: next.lockedBalance,
    replayed: false,
    transactionId: transaction.id,
    userId: wallet.userId,
    version: next.version,
  }
}

export function debitInTransaction(tx: WalletTransaction, input: DebitInput) {
  return mutate(tx, input, { amount: input.amount, type: 'debit' })
}

export function creditInTransaction(tx: WalletTransaction, input: CreditInput) {
  return mutate(tx, input, { amount: input.amount, type: 'credit' })
}

export function chargebackInTransaction(
  tx: WalletTransaction,
  input: DebitInput,
) {
  return mutate(tx, input, { amount: input.amount, type: 'chargeback' })
}

export function lockInTransaction(tx: WalletTransaction, input: LockInput) {
  return mutate(tx, input, { amount: input.amount, type: 'lock' })
}

export function unlockInTransaction(tx: WalletTransaction, input: UnlockInput) {
  return mutate(tx, input, { amount: input.amount, type: 'unlock' })
}

export function settleLockInTransaction(
  tx: WalletTransaction,
  input: SettleInput,
) {
  return mutate(tx, input, {
    lockedAmount: input.lockedAmount,
    payout: input.payout,
    type: 'settle',
  })
}
