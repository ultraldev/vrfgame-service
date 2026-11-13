import * as z from 'zod'

import { TRANSACTION_DIRECTIONS, TRANSACTION_TYPES } from './util'

const Meta = z.object({
  code: z.string(),
  decimals: z.number().int(),
  locale: z.string(),
  symbol: z.string(),
  type: z.string(),
})

const Balance = z.object({
  balance: z.string(),
  currency: z.string(),
  lockedBalance: z.string(),
  meta: Meta,
})

const Reference = z.object({
  id: z.string(),
  type: z.string(),
})

const Transaction = z.object({
  amount: z.string(),
  balanceAfter: z.string(),
  createdAt: z.iso.datetime(),
  currency: Meta,
  direction: z.enum(TRANSACTION_DIRECTIONS),
  id: z.string(),
  reference: Reference,
  type: z.enum(TRANSACTION_TYPES),
})

export const Query = z.object({
  currency: z.string().optional(),
})

export const TransactionsQuery = z
  .object({
    currency: z.string().trim().min(1).optional(),
    cursor: z.string().trim().min(1).max(512).optional(),
    direction: z.enum(TRANSACTION_DIRECTIONS).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    to: z.iso.datetime({ offset: true }).optional(),
    type: z.enum(TRANSACTION_TYPES).optional(),
  })
  .refine(
    (query) =>
      !query.from || !query.to || Date.parse(query.from) < Date.parse(query.to),
    {
      message: '`to` must be after `from`',
      path: ['to'],
    },
  )

export type TransactionQuery = z.infer<typeof TransactionsQuery>

export const Item = Balance

export const List = z.object({
  balances: z.array(Balance),
})

export const Transactions = z.object({
  items: z.array(Transaction),
  nextCursor: z.string().nullable(),
})

z.globalRegistry.add(Meta, { id: 'WalletMeta' })
z.globalRegistry.add(Balance, { id: 'WalletBalance' })
z.globalRegistry.add(List, { id: 'WalletBalances' })
z.globalRegistry.add(Reference, { id: 'WalletTransactionReference' })
z.globalRegistry.add(Transaction, { id: 'WalletTransaction' })
z.globalRegistry.add(Transactions, { id: 'WalletTransactions' })

export const WageringQuery = z.object({
  currency: z.string().trim().min(1).max(16),
})

export const Wagering = z.object({
  balance: z.string(),
  capAmount: z.string().nullable(),
  currency: z.string(),
  occupiedAmount: z.string(),
  ratio: z.number().int().nonnegative(),
  wageringAmount: z.string(),
  withdrawableAmount: z.string(),
})

z.globalRegistry.add(Wagering, { id: 'WalletWagering' })
