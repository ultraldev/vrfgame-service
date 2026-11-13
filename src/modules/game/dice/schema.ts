import * as z from 'zod'

import { DICE_DIRECTIONS, DICE_MAX_TARGET, DICE_MIN_TARGET } from './util'

const Direction = z.enum(DICE_DIRECTIONS)

export const DiceBetInput = z.object({
  amount: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^\d+(?:\.\d+)?$/u),
  clientSeed: z.string().trim().min(1).max(128),
  currency: z.string().trim().min(1).max(16).optional(),
  direction: Direction,
  target: z.number().int().min(DICE_MIN_TARGET).max(DICE_MAX_TARGET),
})

export type DiceBetRequest = z.infer<typeof DiceBetInput>

export const DiceBetResultSchema = z.object({
  direction: Direction,
  outcomeMatched: z.boolean(),
  roll: z.number().int().nonnegative(),
  target: z.number().int().min(DICE_MIN_TARGET).max(DICE_MAX_TARGET),
})

export type DiceBetResult = z.infer<typeof DiceBetResultSchema>

export const DiceBetHeaders = z.object({
  'idempotency-key': z.string().trim().min(1).max(128),
})

export const DiceHistoryQuery = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type DiceHistoryFilters = z.infer<typeof DiceHistoryQuery>

export const DiceBetParams = z.object({
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

export const DiceActiveSeed = ActiveSeed

export const DiceSeedRotation = z.object({
  active: ActiveSeed,
  revealed: RevealedSeed,
})

export const DiceBet = z.object({
  amount: z.string(),
  balanceAfter: z.string().nullable(),
  clientSeed: z.string(),
  createdAt: z.iso.datetime(),
  currency: z.string(),
  direction: Direction,
  id: z.string(),
  nonce: z.number().int().nonnegative(),
  outcomeMatched: z.boolean(),
  payout: z.string(),
  roll: z.string(),
  status: z.literal('settled'),
  target: z.number().int(),
  won: z.boolean(),
})

export type DiceBetResponse = z.infer<typeof DiceBet>

export const DiceBetList = z.object({
  items: z.array(DiceBet),
  nextCursor: z.string().nullable(),
})

export const DiceVerification = z.object({
  betId: z.string(),
  clientSeed: z.string(),
  expectedRoll: z.string(),
  message: z.string(),
  nonce: z.number().int().nonnegative(),
  roll: z.string(),
  serverSeed: z.string().nullable(),
  serverSeedHash: z.string(),
  valid: z.boolean(),
})

z.globalRegistry.add(DiceActiveSeed, { id: 'DiceActiveSeed' })
z.globalRegistry.add(RevealedSeed, { id: 'DiceRevealedSeed' })
z.globalRegistry.add(DiceSeedRotation, { id: 'DiceSeedRotation' })
z.globalRegistry.add(DiceBet, { id: 'DiceBet' })
z.globalRegistry.add(DiceBetList, { id: 'DiceBetList' })
z.globalRegistry.add(DiceVerification, { id: 'DiceVerification' })
