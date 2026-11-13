import * as z from 'zod'

import { MINES_GRID_SIZE, MINES_MAX_COUNT, MINES_MIN_COUNT } from './util'

const Status = z.enum(['active', 'lost', 'cashed_out'])
const Tile = z
  .number()
  .int()
  .min(0)
  .max(MINES_GRID_SIZE - 1)

export const MinesStartInput = z.object({
  amount: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^\d+(?:\.\d+)?$/u),
  clientSeed: z.string().trim().min(1).max(128),
  currency: z.string().trim().min(1).max(16).optional(),
  minesCount: z.number().int().min(MINES_MIN_COUNT).max(MINES_MAX_COUNT),
})

export type MinesStartRequest = z.infer<typeof MinesStartInput>

export const MinesRevealInput = z.object({
  tileIndex: Tile,
})

export const MinesBetParams = z.object({
  betId: z.uuid(),
})

export const MinesBetHeaders = z.object({
  'idempotency-key': z.string().trim().min(1).max(128),
})

export const MinesHistoryQuery = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type MinesHistoryFilters = z.infer<typeof MinesHistoryQuery>

export const MinesBetResultSchema = z
  .object({
    gridSize: z.literal(MINES_GRID_SIZE),
    minePositions: z.array(Tile),
    minesCount: z.number().int().min(MINES_MIN_COUNT).max(MINES_MAX_COUNT),
    multiplierCenti: z.number().int().min(100),
    revealedTiles: z.array(Tile),
  })
  .superRefine((result, context) => {
    if (result.minePositions.length !== result.minesCount) {
      context.addIssue({
        code: 'custom',
        message: 'Mine position count does not match minesCount',
        path: ['minePositions'],
      })
    }
    if (new Set(result.minePositions).size !== result.minePositions.length) {
      context.addIssue({
        code: 'custom',
        message: 'Mine positions must be unique',
        path: ['minePositions'],
      })
    }
    if (new Set(result.revealedTiles).size !== result.revealedTiles.length) {
      context.addIssue({
        code: 'custom',
        message: 'Revealed tiles must be unique',
        path: ['revealedTiles'],
      })
    }
  })

export type MinesBetResult = z.infer<typeof MinesBetResultSchema>

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

export const MinesActiveSeed = ActiveSeed
export const MinesSeedRotation = z.object({
  active: ActiveSeed,
  revealed: RevealedSeed,
})

export const MinesGame = z.object({
  amount: z.string(),
  balanceAfter: z.string().nullable(),
  betId: z.string(),
  currency: z.string(),
  gridSize: z.literal(MINES_GRID_SIZE),
  lockedBalanceAfter: z.string().nullable(),
  minesCount: z.number().int(),
  multiplier: z.string(),
  nextNonce: z.number().int().nonnegative(),
  revealedTiles: z.array(Tile),
  serverSeedHash: z.string(),
  status: Status,
})

export const MinesReveal = z.object({
  balanceAfter: z.string().nullable(),
  betId: z.string(),
  isMine: z.boolean(),
  lockedBalanceAfter: z.string().nullable(),
  minePositions: z.array(Tile).nullable(),
  multiplier: z.string(),
  payout: z.string().nullable(),
  revealedTiles: z.array(Tile),
  status: Status,
  tileIndex: Tile,
})

export const MinesCashOut = z.object({
  balanceAfter: z.string(),
  betId: z.string(),
  lockedBalanceAfter: z.string(),
  minePositions: z.array(Tile),
  multiplier: z.string(),
  payout: z.string(),
  status: z.literal('cashed_out'),
})

export type MinesCashOutResponse = z.infer<typeof MinesCashOut>

export const MinesHistoryItem = z.object({
  amount: z.string(),
  clientSeed: z.string(),
  createdAt: z.iso.datetime(),
  currency: z.string(),
  id: z.string(),
  minePositions: z.array(Tile).nullable(),
  minesCount: z.number().int(),
  multiplier: z.string(),
  nonce: z.number().int().nonnegative(),
  payout: z.string(),
  revealedCount: z.number().int().nonnegative(),
  status: Status,
})

export const MinesHistory = z.object({
  items: z.array(MinesHistoryItem),
  nextCursor: z.string().nullable(),
})

export const MinesVerification = z.object({
  betId: z.string(),
  clientSeed: z.string(),
  expectedMinePositions: z.array(Tile),
  message: z.string(),
  minePositions: z.array(Tile),
  nonce: z.number().int().nonnegative(),
  serverSeed: z.string().nullable(),
  serverSeedHash: z.string(),
  valid: z.boolean(),
})

z.globalRegistry.add(MinesActiveSeed, { id: 'MinesActiveSeed' })
z.globalRegistry.add(RevealedSeed, { id: 'MinesRevealedSeed' })
z.globalRegistry.add(MinesSeedRotation, { id: 'MinesSeedRotation' })
z.globalRegistry.add(MinesGame, { id: 'MinesGame' })
z.globalRegistry.add(MinesReveal, { id: 'MinesReveal' })
z.globalRegistry.add(MinesCashOut, { id: 'MinesCashOut' })
z.globalRegistry.add(MinesHistoryItem, { id: 'MinesHistoryItem' })
z.globalRegistry.add(MinesHistory, { id: 'MinesHistory' })
z.globalRegistry.add(MinesVerification, { id: 'MinesVerification' })
