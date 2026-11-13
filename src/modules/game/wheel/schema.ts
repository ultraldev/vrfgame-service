import * as z from 'zod'

import { WHEEL_RISKS } from './util'

const Segments = z.union([
  z.literal(10),
  z.literal(20),
  z.literal(30),
  z.literal(40),
  z.literal(50),
])
const Risk = z.enum(WHEEL_RISKS)

export const WheelBetInput = z.object({
  amount: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^\d+(?:\.\d+)?$/u),
  clientSeed: z.string().trim().min(1).max(128),
  currency: z.string().trim().min(1).max(16).optional(),
  risk: Risk,
  segments: Segments,
})

export type WheelBetRequest = z.infer<typeof WheelBetInput>

export const WheelBetResultSchema = z
  .object({
    multiplierCenti: z.number().int().nonnegative(),
    risk: Risk,
    segmentIndex: z.number().int().nonnegative(),
    segments: Segments,
  })
  .superRefine((result, context) => {
    if (result.segmentIndex >= result.segments) {
      context.addIssue({
        code: 'custom',
        message: 'Wheel segment index is out of range',
        path: ['segmentIndex'],
      })
    }
  })

export type WheelBetResult = z.infer<typeof WheelBetResultSchema>

export const WheelBetHeaders = z.object({
  'idempotency-key': z.string().trim().min(1).max(128),
})

export const WheelHistoryQuery = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type WheelHistoryFilters = z.infer<typeof WheelHistoryQuery>

export const WheelBetParams = z.object({
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

export const WheelActiveSeed = ActiveSeed
export const WheelSeedRotation = z.object({
  active: ActiveSeed,
  revealed: RevealedSeed,
})

export const WheelBet = z.object({
  amount: z.string(),
  balanceAfter: z.string().nullable(),
  clientSeed: z.string(),
  createdAt: z.iso.datetime(),
  currency: z.string(),
  effectiveMultiplier: z.string(),
  id: z.string(),
  multiplier: z.string(),
  nonce: z.number().int().nonnegative(),
  payout: z.string(),
  payoutCapped: z.boolean(),
  risk: Risk,
  segmentIndex: z.number().int().nonnegative(),
  segments: Segments,
  status: z.literal('settled'),
  theoreticalMultiplier: z.string(),
  won: z.boolean(),
})

export type WheelBetResponse = z.infer<typeof WheelBet>

export const WheelBetList = z.object({
  items: z.array(WheelBet),
  nextCursor: z.string().nullable(),
})

export const WheelVerification = z.object({
  betId: z.string(),
  clientSeed: z.string(),
  expectedSegmentIndex: z.number().int().nonnegative(),
  message: z.string(),
  nonce: z.number().int().nonnegative(),
  risk: Risk,
  segmentIndex: z.number().int().nonnegative(),
  segments: Segments,
  serverSeed: z.string().nullable(),
  serverSeedHash: z.string(),
  valid: z.boolean(),
})

z.globalRegistry.add(WheelActiveSeed, { id: 'WheelActiveSeed' })
z.globalRegistry.add(RevealedSeed, { id: 'WheelRevealedSeed' })
z.globalRegistry.add(WheelSeedRotation, { id: 'WheelSeedRotation' })
z.globalRegistry.add(WheelBet, { id: 'WheelBet' })
z.globalRegistry.add(WheelBetList, { id: 'WheelBetList' })
z.globalRegistry.add(WheelVerification, { id: 'WheelVerification' })
