import * as z from 'zod'

import { PLINKO_DIRECTIONS, PLINKO_RISKS } from './util'

const Rows = z.union([z.literal(8), z.literal(12), z.literal(16)])
const Risk = z.enum(PLINKO_RISKS)
const Direction = z.enum(PLINKO_DIRECTIONS)

export const PlinkoBetInput = z.object({
  amount: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^\d+(?:\.\d+)?$/u),
  clientSeed: z.string().trim().min(1).max(128),
  currency: z.string().trim().min(1).max(16).optional(),
  risk: Risk,
  rows: Rows,
})

export type PlinkoBetRequest = z.infer<typeof PlinkoBetInput>

export const PlinkoBetResultSchema = z
  .object({
    multiplierCenti: z.number().int().nonnegative(),
    path: z.array(Direction),
    risk: Risk,
    rows: z.union([z.literal(8), z.literal(12), z.literal(16)]),
    slotIndex: z.number().int().nonnegative(),
  })
  .superRefine((result, context) => {
    if (result.path.length !== result.rows) {
      context.addIssue({
        code: 'custom',
        message: 'Plinko path length must match rows',
        path: ['path'],
      })
    }
    if (result.slotIndex > result.rows) {
      context.addIssue({
        code: 'custom',
        message: 'Plinko slot index is out of range',
        path: ['slotIndex'],
      })
    }
  })

export type PlinkoBetResult = z.infer<typeof PlinkoBetResultSchema>

export const PlinkoBetHeaders = z.object({
  'idempotency-key': z.string().trim().min(1).max(128),
})

export const PlinkoHistoryQuery = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type PlinkoHistoryFilters = z.infer<typeof PlinkoHistoryQuery>

export const PlinkoBetParams = z.object({
  betId: z.uuid(),
})

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

export const PlinkoActiveSeed = ActiveSeed
export const PlinkoSeedRotation = z.object({
  active: ActiveSeed,
  revealed: RevealedSeed,
})

export const PlinkoBet = z.object({
  amount: z.string(),
  balanceAfter: z.string().nullable(),
  clientSeed: z.string(),
  createdAt: z.iso.datetime(),
  currency: z.string(),
  effectiveMultiplier: z.string(),
  id: z.string(),
  multiplier: z.string(),
  nonce: z.number().int().nonnegative(),
  path: z.array(Direction),
  payout: z.string(),
  payoutCapped: z.boolean(),
  risk: Risk,
  rows: Rows,
  slotIndex: z.number().int().nonnegative(),
  status: z.literal('settled'),
  theoreticalMultiplier: z.string(),
  won: z.boolean(),
})

export type PlinkoBetResponse = z.infer<typeof PlinkoBet>

export const PlinkoBetList = z.object({
  items: z.array(PlinkoBet),
  nextCursor: z.string().nullable(),
})

export const PlinkoVerification = z.object({
  betId: z.string(),
  clientSeed: z.string(),
  expectedPath: z.array(Direction),
  expectedSlotIndex: z.number().int().nonnegative(),
  message: z.string(),
  nonce: z.number().int().nonnegative(),
  path: z.array(Direction),
  serverSeed: z.string().nullable(),
  serverSeedHash: z.string(),
  slotIndex: z.number().int().nonnegative(),
  valid: z.boolean(),
})

z.globalRegistry.add(PlinkoActiveSeed, { id: 'PlinkoActiveSeed' })
z.globalRegistry.add(RevealedSeed, { id: 'PlinkoRevealedSeed' })
z.globalRegistry.add(PlinkoSeedRotation, { id: 'PlinkoSeedRotation' })
z.globalRegistry.add(PlinkoBet, { id: 'PlinkoBet' })
z.globalRegistry.add(PlinkoBetList, { id: 'PlinkoBetList' })
z.globalRegistry.add(PlinkoVerification, { id: 'PlinkoVerification' })
