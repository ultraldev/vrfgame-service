import * as z from 'zod'

import { CASE_OPEN_MAX_BATCH } from './util'

const CrateTag = z.enum(['new', 'hot'])
const CurrencyQuery = z.object({
  currency: z.string().trim().min(1).max(16).optional(),
})

export const CrateListQuery = CurrencyQuery.extend({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(64).optional(),
  tag: CrateTag.optional(),
})

export type CrateListFilters = z.infer<typeof CrateListQuery>

export const CrateParams = z.object({
  slug: z.string().trim().min(1).max(64),
})

export const CrateDetailQuery = CurrencyQuery

const CrateItem = z.object({
  id: z.string(),
  imageUrl: z.string().nullable(),
  multiplier: z.string(),
  name: z.string(),
  oddsPercent: z.string(),
  oneIn: z.number().int().nullable(),
  rarity: z.string(),
  slug: z.string(),
  sortOrder: z.number().int(),
  weight: z.number().int(),
})

const CrateSummary = z.object({
  coverUrl: z.string().nullable(),
  currency: z.string(),
  decimals: z.number().int(),
  id: z.string(),
  maxMultiplier: z.string(),
  name: z.string(),
  price: z.string(),
  rtpBps: z.number().int(),
  slug: z.string(),
  sortOrder: z.number().int(),
  tag: z.string().nullable(),
  version: z.number().int(),
})

export const CrateList = z.object({
  currency: z.string(),
  decimals: z.number().int(),
  items: z.array(CrateSummary),
})

export const CrateDetail = CrateSummary.extend({
  items: z.array(CrateItem),
})

export type CrateDetailResponse = z.infer<typeof CrateDetail>

export const CaseOpenInput = z.object({
  clientSeed: z.string().trim().min(1).max(128),
  crateSlug: z.string().trim().min(1).max(64),
  currency: z.string().trim().min(1).max(16).optional(),
})

export type CaseOpenRequest = z.infer<typeof CaseOpenInput>

export const CaseOpenBatchInput = CaseOpenInput.extend({
  count: z.number().int().min(1).max(CASE_OPEN_MAX_BATCH),
})

export const CaseOpenHeaders = z.object({
  'idempotency-key': z.string().trim().min(1).max(128),
})

export const CaseOpenParams = z.object({
  openId: z.uuid(),
})

export const CaseHistoryQuery = z.object({
  crateSlug: z.string().trim().min(1).max(64).optional(),
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type CaseHistoryFilters = z.infer<typeof CaseHistoryQuery>

const ActiveSeed = z.object({
  nextNonce: z.number().int().nonnegative(),
  seedId: z.string(),
  serverSeedHash: z.string(),
})

const RevealedSeed = z.object({
  nonce: z.number().int().nonnegative(),
  seedId: z.string(),
  serverSeed: z.string(),
  serverSeedHash: z.string(),
})

export const CaseActiveSeed = ActiveSeed

export const CaseSeedRotation = z.object({
  active: ActiveSeed,
  revealed: RevealedSeed,
})

export const CaseOpenItem = z.object({
  id: z.string(),
  imageUrl: z.string().nullable(),
  multiplier: z.string(),
  name: z.string(),
  rarity: z.string(),
  slug: z.string(),
})

export const CaseOpen = z.object({
  amount: z.string(),
  balanceAfter: z.string().nullable(),
  clientSeed: z.string(),
  crateSlug: z.string(),
  crateVersion: z.number().int(),
  createdAt: z.iso.datetime(),
  currency: z.string(),
  decimals: z.number().int(),
  id: z.string(),
  item: CaseOpenItem,
  itemIndex: z.number().int().nonnegative(),
  multiplier: z.string(),
  nonce: z.number().int().nonnegative(),
  payout: z.string(),
  payoutCapped: z.boolean(),
  revisionId: z.string(),
  serverSeedHash: z.string(),
  won: z.boolean(),
})

export type CaseOpenResponse = z.infer<typeof CaseOpen>

export const CaseOpenList = z.object({
  items: z.array(CaseOpen),
  nextCursor: z.string().nullable(),
})

export const CaseOpenBatch = z.object({
  failed: z.array(
    z.object({
      error: z.string(),
      index: z.number().int().nonnegative(),
    }),
  ),
  opens: z.array(CaseOpen),
})

export type CaseOpenBatchResponse = z.infer<typeof CaseOpenBatch>

export const CaseVerification = z.object({
  clientSeed: z.string(),
  expectedItemIndex: z.number().int().nonnegative(),
  itemIndex: z.number().int().nonnegative(),
  message: z.string(),
  nonce: z.number().int().nonnegative(),
  openId: z.string(),
  revisionId: z.string(),
  serverSeed: z.string().nullable(),
  serverSeedHash: z.string(),
  valid: z.boolean(),
  weights: z.array(z.number().int()),
})

z.globalRegistry.add(ActiveSeed, { id: 'CaseActiveSeed' })
z.globalRegistry.add(RevealedSeed, { id: 'CaseRevealedSeed' })
z.globalRegistry.add(CaseSeedRotation, { id: 'CaseSeedRotation' })
z.globalRegistry.add(CrateItem, { id: 'CrateItem' })
z.globalRegistry.add(CrateSummary, { id: 'CrateSummary' })
z.globalRegistry.add(CrateList, { id: 'CrateList' })
z.globalRegistry.add(CrateDetail, { id: 'CrateDetail' })
z.globalRegistry.add(CaseOpenItem, { id: 'CaseOpenItem' })
z.globalRegistry.add(CaseOpen, { id: 'CaseOpen' })
z.globalRegistry.add(CaseOpenList, { id: 'CaseOpenList' })
z.globalRegistry.add(CaseOpenBatch, { id: 'CaseOpenBatch' })
z.globalRegistry.add(CaseVerification, { id: 'CaseVerification' })
