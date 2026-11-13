import { pfUint32 } from '@/modules/game/fairness'

export const PLINKO_ROWS = [8, 12, 16] as const
export type PlinkoRows = (typeof PLINKO_ROWS)[number]

export const PLINKO_RISKS = ['low', 'medium', 'high'] as const
export type PlinkoRisk = (typeof PLINKO_RISKS)[number]

export const PLINKO_DIRECTIONS = ['L', 'R'] as const
export type PlinkoDirection = (typeof PLINKO_DIRECTIONS)[number]

const PLINKO_MULTIPLIERS: Record<
  PlinkoRisk,
  Record<PlinkoRows, readonly number[]>
> = {
  high: {
    12: [50_000, 2400, 500, 150, 40, 30, 10, 30, 40, 150, 500, 2400, 50_000],
    16: [
      500_000, 10_000, 2000, 500, 200, 60, 50, 50, 50, 50, 50, 60, 200, 500,
      2000, 10_000, 500_000,
    ],
    8: [2000, 250, 120, 60, 40, 60, 120, 250, 2000],
  },
  low: {
    12: [5000, 1200, 500, 200, 100, 50, 20, 50, 100, 200, 500, 1200, 5000],
    16: [
      100_000, 5000, 1000, 300, 150, 100, 80, 70, 70, 70, 80, 100, 150, 300,
      1000, 5000, 100_000,
    ],
    8: [500, 180, 140, 80, 50, 80, 140, 180, 500],
  },
  medium: {
    12: [15_000, 2000, 500, 200, 90, 30, 20, 30, 90, 200, 500, 2000, 15_000],
    16: [
      250_000, 10_000, 2000, 500, 200, 70, 60, 60, 50, 60, 60, 70, 200, 500,
      2000, 10_000, 250_000,
    ],
    8: [1000, 250, 120, 70, 50, 70, 120, 250, 1000],
  },
}

export function getPlinkoMultipliers(rows: PlinkoRows, risk: PlinkoRisk) {
  return PLINKO_MULTIPLIERS[risk][rows]
}

export function getPlinkoMultiplierCenti(
  rows: PlinkoRows,
  risk: PlinkoRisk,
  slotIndex: number,
) {
  const multiplier = getPlinkoMultipliers(rows, risk)[slotIndex]
  if (multiplier === undefined) {
    throw new Error(`Invalid plinko slot: ${slotIndex}`)
  }
  return multiplier
}

export function generatePlinkoPath(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  rows: PlinkoRows,
) {
  const path: PlinkoDirection[] = []
  for (let row = 0; row < rows; row += 1) {
    path.push(
      pfUint32(serverSeed, clientSeed, nonce, row) % 2 === 0 ? 'L' : 'R',
    )
  }
  return path
}

export function plinkoSlotIndex(path: PlinkoDirection[]) {
  return path.filter((direction) => direction === 'R').length
}

export function calculatePlinkoPayout(amount: bigint, multiplierCenti: number) {
  return (amount * BigInt(multiplierCenti)) / 100n
}
