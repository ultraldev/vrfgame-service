import * as z from 'zod'

export const DepositConfigQuery = z.object({
  currency: z.string().trim().min(1).max(16).default('USDT'),
})

export const CreateDepositInput = z.object({
  amount: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^\d+(?:\.\d+)?$/u),
  currency: z.string().trim().min(1).max(16).default('USDT'),
})

export const CreateDepositHeaders = z.object({
  'idempotency-key': z.string().trim().min(1).max(128),
})

export const DepositHistoryQuery = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type DepositHistoryFilters = z.infer<typeof DepositHistoryQuery>

export const DepositParams = z.object({
  depositId: z.uuid(),
})

export const DepositConfig = z.object({
  chain: z.string(),
  configured: z.boolean(),
  currency: z.string(),
  decimals: z.number().int(),
  maxDepositAmount: z.string().nullable(),
  minDepositAmount: z.string().nullable(),
  platformFeeRateBps: z.number().int(),
  providerCode: z.string(),
  providerName: z.string(),
  symbol: z.string(),
})

export const Deposit = z.object({
  actualAmount: z.string().nullable(),
  address: z.string().nullable(),
  appPayUrl: z.string().nullable(),
  chain: z.string(),
  createdAt: z.iso.datetime(),
  currency: z.string(),
  decimals: z.number().int(),
  expectedAmount: z.string(),
  expiresAt: z.iso.datetime().nullable(),
  failureReason: z.string().nullable(),
  id: z.string(),
  platformFee: z.string(),
  platformFeeRateBps: z.number().int().nullable(),
  remainingSeconds: z.number().int().nullable(),
  status: z.enum([
    'creating',
    'pending',
    'processing',
    'succeeded',
    'failed',
    'expired',
  ]),
  symbol: z.string(),
  txHash: z.string().nullable(),
  updatedAt: z.iso.datetime(),
})

export type DepositResponse = z.infer<typeof Deposit>

export const DepositList = z.object({
  items: z.array(Deposit),
  nextCursor: z.string().nullable(),
})

export const DepositWebhook = z.object({
  duplicate: z.boolean(),
  ignored: z.boolean(),
  processed: z.number().int().nonnegative(),
})

z.globalRegistry.add(DepositConfig, { id: 'CryptoDepositConfig' })
z.globalRegistry.add(Deposit, { id: 'CryptoDeposit' })
z.globalRegistry.add(DepositList, { id: 'CryptoDepositList' })

export const WithdrawalConfigQuery = z.object({
  currency: z.string().trim().min(1).max(16).default('USDT'),
})

export const WithdrawalFeeQuery = WithdrawalConfigQuery.extend({
  amount: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^\d+(?:\.\d+)?$/u),
})

export const WithdrawalRequestInput = WithdrawalFeeQuery.extend({
  address: z.string().trim().min(1).max(128),
})

export const WithdrawalHeaders = z.object({
  'idempotency-key': z.string().trim().min(1).max(128),
})

export const WithdrawalHistoryQuery = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type WithdrawalHistoryFilters = z.infer<typeof WithdrawalHistoryQuery>

export const WithdrawalParams = z.object({
  withdrawalId: z.uuid(),
})

export const WithdrawalConfig = z.object({
  chain: z.string(),
  configured: z.boolean(),
  currency: z.string(),
  decimals: z.number().int(),
  maxWithdrawAmount: z.string().nullable(),
  minWithdrawAmount: z.string().nullable(),
  platformFee: z.string(),
  providerCode: z.string(),
  providerName: z.string(),
  symbol: z.string(),
})

export const WithdrawalFee = z.object({
  amount: z.string(),
  chain: z.string(),
  currency: z.string(),
  expiresAt: z.iso.datetime(),
  fee: z.string(),
  platformFee: z.string(),
  quotedAt: z.iso.datetime(),
  receiveAmount: z.string(),
})

export const Withdrawal = z.object({
  address: z.string(),
  amount: z.string(),
  chain: z.string(),
  createdAt: z.iso.datetime(),
  currency: z.string(),
  decimals: z.number().int(),
  failureReason: z.string().nullable(),
  fee: z.string(),
  feeQuotedAt: z.iso.datetime().nullable(),
  id: z.string(),
  platformFee: z.string(),
  providerFee: z.string(),
  quotedFee: z.string(),
  receiveAmount: z.string(),
  status: z.enum([
    'pending_review',
    'queued',
    'submitting',
    'submit_unconfirmed',
    'processing',
    'pending_approval',
    'succeeded',
    'failed',
    'cancelled',
  ]),
  symbol: z.string(),
  txHash: z.string().nullable(),
  updatedAt: z.iso.datetime(),
})

export type WithdrawalResponse = z.infer<typeof Withdrawal>

export const WithdrawalList = z.object({
  items: z.array(Withdrawal),
  nextCursor: z.string().nullable(),
})

z.globalRegistry.add(WithdrawalConfig, { id: 'CryptoWithdrawalConfig' })
z.globalRegistry.add(WithdrawalFee, { id: 'CryptoWithdrawalFee' })
z.globalRegistry.add(Withdrawal, { id: 'CryptoWithdrawal' })
z.globalRegistry.add(WithdrawalList, { id: 'CryptoWithdrawalList' })
