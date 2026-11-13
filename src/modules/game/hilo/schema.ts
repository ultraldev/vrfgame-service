import * as z from 'zod'

import {
  HILO_DIRECTIONS,
  HILO_MAX_CARD,
  HILO_MAX_MULTIPLIER_BPS,
  HILO_MAX_ROUNDS,
  HILO_MIN_CARD,
  HILO_ONE_BPS,
} from './util'

const Card = z.number().int().min(HILO_MIN_CARD).max(HILO_MAX_CARD)
const Direction = z.enum(HILO_DIRECTIONS)
const Status = z.enum(['active', 'lost', 'cashed_out'])

export const HiloStartInput = z.object({
  amount: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^\d+(?:\.\d+)?$/u),
  clientSeed: z.string().trim().min(1).max(128),
  currency: z.string().trim().min(1).max(16).optional(),
})

export type HiloStartRequest = z.infer<typeof HiloStartInput>

export const HiloGuessInput = z.object({
  direction: Direction,
})

export const HiloBetParams = z.object({
  betId: z.uuid(),
})

export const HiloBetHeaders = z.object({
  'idempotency-key': z.string().trim().min(1).max(128),
})

export const HiloHistoryQuery = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type HiloHistoryFilters = z.infer<typeof HiloHistoryQuery>

export const HiloRoundSchema = z.object({
  card: Card,
  currentCard: Card.optional(),
  direction: Direction.optional(),
  nonce: z.number().int().nonnegative(),
  type: z.enum(['deal', 'skip', 'guess']),
  won: z.boolean().optional(),
})

export const HiloBetResultSchema = z
  .object({
    cumulativeMultiplierBps: z
      .number()
      .int()
      .min(HILO_ONE_BPS)
      .max(HILO_MAX_MULTIPLIER_BPS),
    cumulativeMultiplierCenti: z.number().int().min(100),
    currentCard: Card,
    rounds: z.array(HiloRoundSchema).min(1).max(HILO_MAX_ROUNDS),
  })
  .superRefine((result, context) => {
    const last = result.rounds.at(-1)
    const expectedCurrentCard =
      last?.type === 'guess' && last.won === false
        ? last.currentCard
        : last?.card
    if (expectedCurrentCard !== result.currentCard) {
      context.addIssue({
        code: 'custom',
        message: 'Current card does not match the final round state',
        path: ['currentCard'],
      })
    }
  })

export type HiloBetResult = z.infer<typeof HiloBetResultSchema>

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

export const HiloActiveSeed = ActiveSeed
export const HiloSeedRotation = z.object({
  active: ActiveSeed,
  revealed: RevealedSeed,
})

export const HiloGame = z.object({
  amount: z.string(),
  balanceAfter: z.string().nullable(),
  betId: z.string(),
  currency: z.string(),
  currentCard: Card,
  directions: z.array(Direction),
  lockedBalanceAfter: z.string().nullable(),
  multiplier: z.string(),
  nextNonce: z.number().int().nonnegative(),
  rounds: z.array(HiloRoundSchema),
  serverSeedHash: z.string(),
  status: Status,
})

export type HiloGameResponse = z.infer<typeof HiloGame>

export const HiloGuessResponse = z.object({
  balanceAfter: z.string().nullable(),
  betId: z.string(),
  card: Card,
  currentCard: Card,
  directions: z.array(Direction),
  lockedBalanceAfter: z.string().nullable(),
  multiplier: z.string(),
  payout: z.string().nullable(),
  rounds: z.array(HiloRoundSchema),
  status: Status,
  won: z.boolean(),
})

export type HiloGuessResult = z.infer<typeof HiloGuessResponse>

export const HiloCashOut = z.object({
  balanceAfter: z.string(),
  betId: z.string(),
  lockedBalanceAfter: z.string(),
  multiplier: z.string(),
  payout: z.string(),
  rounds: z.array(HiloRoundSchema),
  status: z.literal('cashed_out'),
})

export type HiloCashOutResponse = z.infer<typeof HiloCashOut>

export const HiloHistoryItem = z.object({
  amount: z.string(),
  clientSeed: z.string(),
  createdAt: z.iso.datetime(),
  currency: z.string(),
  guesses: z.number().int().nonnegative(),
  id: z.string(),
  multiplier: z.string(),
  nonce: z.number().int().nonnegative(),
  payout: z.string(),
  rounds: z.array(HiloRoundSchema),
  status: Status,
})

export const HiloHistory = z.object({
  items: z.array(HiloHistoryItem),
  nextCursor: z.string().nullable(),
})

export type HiloHistoryResponse = z.infer<typeof HiloHistory>

export const HiloVerification = z.object({
  betId: z.string(),
  cards: z.array(Card),
  clientSeed: z.string(),
  expectedCards: z.array(Card),
  message: z.string(),
  nonce: z.number().int().nonnegative(),
  serverSeed: z.string().nullable(),
  serverSeedHash: z.string(),
  valid: z.boolean(),
})

z.globalRegistry.add(HiloActiveSeed, { id: 'HiloActiveSeed' })
z.globalRegistry.add(RevealedSeed, { id: 'HiloRevealedSeed' })
z.globalRegistry.add(HiloSeedRotation, { id: 'HiloSeedRotation' })
z.globalRegistry.add(HiloGame, { id: 'HiloGame' })
z.globalRegistry.add(HiloGuessResponse, { id: 'HiloGuess' })
z.globalRegistry.add(HiloCashOut, { id: 'HiloCashOut' })
z.globalRegistry.add(HiloHistoryItem, { id: 'HiloHistoryItem' })
z.globalRegistry.add(HiloHistory, { id: 'HiloHistory' })
z.globalRegistry.add(HiloVerification, { id: 'HiloVerification' })
