import * as z from 'zod'

import { RAFFLE_CATEGORIES } from './util'

export const RaffleListQuery = z.object({
  category: z.enum(RAFFLE_CATEGORIES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(64).optional(),
})

export type RaffleListFilters = z.infer<typeof RaffleListQuery>

export const RaffleParams = z.object({
  slug: z.string().trim().min(1).max(64),
})

export const RaffleRoundParams = z.object({
  roundId: z.uuid(),
})

export const RaffleEntryInput = z.object({
  shares: z.number().int().min(1).max(100_000),
})

export const RaffleEntryHeaders = z.object({
  'idempotency-key': z.string().trim().min(1).max(128),
})

export const RaffleHistoryQuery = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type RaffleHistoryFilters = z.infer<typeof RaffleHistoryQuery>

export const RaffleRound = z.object({
  botShares: z.number().int(),
  capacity: z.number().int(),
  currency: z.string(),
  decimals: z.number().int(),
  earlyWindowSec: z.number().int(),
  endsAt: z.iso.datetime(),
  giftRemaining: z.number().int(),
  id: z.string(),
  myGiftShares: z.number().int(),
  myOutcome: z.enum(['none', 'open', 'won', 'lost', 'voided']),
  myShares: z.number().int(),
  payoutAmount: z.string(),
  roundNumber: z.number().int(),
  serverSeed: z.string().nullable(),
  serverSeedHash: z.string(),
  sharePrice: z.string(),
  sold: z.number().int(),
  soldGift: z.number().int(),
  startsAt: z.iso.datetime(),
  status: z.string(),
  tauBps: z.number().int(),
  tauEarlyBps: z.number().int(),
  winProbabilityBps: z.number().int(),
  winnerIsPlatform: z.boolean(),
  winningNumber: z.number().int().nullable(),
})

export const RaffleItem = z.object({
  category: z.string(),
  currency: z.string(),
  decimals: z.number().int(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  lastRound: RaffleRound.nullable(),
  name: z.string(),
  payoutAmount: z.string(),
  round: RaffleRound.nullable(),
  sharePrice: z.string(),
  skuId: z.string(),
  slug: z.string(),
  sortOrder: z.number().int(),
  tag: z.string().nullable(),
})

export const RaffleList = z.object({
  items: z.array(RaffleItem),
})

export const RaffleDetail = RaffleItem

export const RaffleEntry = z.object({
  amount: z.string(),
  balanceAfter: z.string(),
  entryId: z.string(),
  round: RaffleRound,
  shares: z.number().int(),
})

export type RaffleEntryResponse = z.infer<typeof RaffleEntry>

export const RaffleHistoryItem = z.object({
  amount: z.string(),
  createdAt: z.iso.datetime(),
  currency: z.string(),
  entryId: z.string(),
  outcome: z.enum(['open', 'won', 'lost', 'voided']),
  round: RaffleRound,
  shares: z.number().int(),
  skuId: z.string(),
  slug: z.string(),
})

export const RaffleHistory = z.object({
  items: z.array(RaffleHistoryItem),
  nextCursor: z.string().nullable(),
})

export type RaffleHistoryResponse = z.infer<typeof RaffleHistory>

export const RaffleVerification = z.object({
  capacity: z.number().int(),
  expectedWinningNumber: z.number().int().nullable(),
  message: z.string(),
  roundId: z.string(),
  serverSeed: z.string().nullable(),
  serverSeedHash: z.string(),
  sold: z.number().int(),
  status: z.string(),
  valid: z.boolean().nullable(),
  winningNumber: z.number().int().nullable(),
})

z.globalRegistry.add(RaffleRound, { id: 'RaffleRound' })
z.globalRegistry.add(RaffleItem, { id: 'RaffleItem' })
z.globalRegistry.add(RaffleList, { id: 'RaffleList' })
z.globalRegistry.add(RaffleEntry, { id: 'RaffleEntry' })
z.globalRegistry.add(RaffleHistoryItem, { id: 'RaffleHistoryItem' })
z.globalRegistry.add(RaffleHistory, { id: 'RaffleHistory' })
z.globalRegistry.add(RaffleVerification, { id: 'RaffleVerification' })
