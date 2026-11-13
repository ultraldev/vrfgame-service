import * as z from 'zod'

export const CRASH_PHASES = [
  'pending',
  'betting',
  'running',
  'crashed',
] as const
export type CrashPhase = (typeof CRASH_PHASES)[number]

const Phase = z.enum(CRASH_PHASES)

export const CrashBetInput = z.object({
  amount: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^\d+(?:\.\d+)?$/u),
  currency: z.string().trim().min(1).max(16).optional(),
})

export const CrashSocketBetInput = CrashBetInput.extend({
  idempotencyKey: z.string().trim().min(1).max(128),
})

export type CrashBetRequest = z.infer<typeof CrashBetInput>
export type CrashSocketBetRequest = z.infer<typeof CrashSocketBetInput>

export const CrashBetHeaders = z.object({
  'idempotency-key': z.string().trim().min(1).max(128),
})

export const CrashBetParams = z.object({
  betId: z.uuid(),
})

export const CrashHistoryQuery = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type CrashHistoryFilters = z.infer<typeof CrashHistoryQuery>

export const CrashRoundParams = z.object({
  roundId: z.uuid(),
})

export const CrashRecentQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const CrashBetResultSchema = z.object({
  cashOutMultiplierCenti: z.number().int().nonnegative().nullable().optional(),
  roundId: z.string(),
})

export type CrashBetResult = z.infer<typeof CrashBetResultSchema>

export const CrashRoundBet = z.object({
  amount: z.string(),
  status: z.enum(['active', 'cashed_out', 'lost']).optional(),
  userId: z.string(),
})

export const CrashRoundSnapshot = z.object({
  bets: z.array(CrashRoundBet),
  clientSeed: z.string(),
  crashPoint: z.string().nullable(),
  id: z.string(),
  multiplier: z.string(),
  nonce: z.number().int().nonnegative(),
  phase: Phase,
  phaseElapsedMs: z.number().nonnegative(),
  roundNumber: z.number().int().positive(),
  serverSeed: z.string().nullable().optional(),
  serverSeedHash: z.string(),
})

export const CrashPublicSnapshot = z.object({
  currentRound: CrashRoundSnapshot,
  nextRound: CrashRoundSnapshot.nullable(),
})

export type CrashSnapshot = z.infer<typeof CrashPublicSnapshot>

export const CrashBet = z.object({
  amount: z.string(),
  betId: z.string(),
  isNextRound: z.boolean(),
  roundId: z.string(),
  status: z.string(),
})

export const CrashCashOut = z.object({
  balanceAfter: z.string(),
  betId: z.string(),
  lockedBalanceAfter: z.string(),
  multiplier: z.string(),
  payout: z.string(),
  roundId: z.string(),
  status: z.literal('cashed_out'),
  userId: z.string(),
})

export type CrashCashOutResponse = z.infer<typeof CrashCashOut>

export const CrashCancel = z.object({
  amount: z.string(),
  roundId: z.string(),
})

export const CrashHistoryItem = z.object({
  amount: z.string(),
  createdAt: z.iso.datetime(),
  currency: z.string(),
  id: z.string(),
  multiplier: z.string().nullable(),
  payout: z.string(),
  roundId: z.string(),
  status: z.string(),
})

export const CrashHistory = z.object({
  items: z.array(CrashHistoryItem),
  nextCursor: z.string().nullable(),
})

export const CrashRecentRound = z.object({
  clientSeed: z.string(),
  crashPoint: z.string().nullable(),
  crashedAt: z.iso.datetime().nullable(),
  id: z.string(),
  nonce: z.number().int(),
  roundNumber: z.number().int(),
  serverSeedHash: z.string(),
})

export const CrashRecentRounds = z.array(CrashRecentRound)

export const CrashRoundVerification = z.object({
  clientSeed: z.string(),
  crashPoint: z.string(),
  expectedCrashPoint: z.string(),
  nonce: z.number().int(),
  roundId: z.string(),
  roundNumber: z.number().int(),
  serverSeed: z.string(),
  serverSeedHash: z.string(),
  valid: z.boolean(),
})

z.globalRegistry.add(CrashRoundBet, { id: 'CrashRoundBet' })
z.globalRegistry.add(CrashRoundSnapshot, { id: 'CrashRoundSnapshot' })
z.globalRegistry.add(CrashPublicSnapshot, { id: 'CrashPublicSnapshot' })
z.globalRegistry.add(CrashBet, { id: 'CrashBet' })
z.globalRegistry.add(CrashCashOut, { id: 'CrashCashOut' })
z.globalRegistry.add(CrashCancel, { id: 'CrashCancel' })
z.globalRegistry.add(CrashHistoryItem, { id: 'CrashHistoryItem' })
z.globalRegistry.add(CrashHistory, { id: 'CrashHistory' })
z.globalRegistry.add(CrashRecentRound, { id: 'CrashRecentRound' })
z.globalRegistry.add(CrashRoundVerification, { id: 'CrashRoundVerification' })
