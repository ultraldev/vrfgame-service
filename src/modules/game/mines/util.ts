import { pfRangedInt } from '@/modules/game/fairness'

export const MINES_GRID_SIZE = 25
export const MINES_MIN_COUNT = 1
export const MINES_MAX_COUNT = 24
export const MINES_MAX_MULTIPLIER_CENTI = 100_000_000

export function combinations(n: number, k: number) {
  if (k < 0 || k > n) {
    return 0
  }
  if (k === 0 || k === n) {
    return 1
  }

  const normalizedK = Math.min(n - k, k)
  let result = 1
  for (let index = 0; index < normalizedK; index += 1) {
    result = (result * (n - index)) / (index + 1)
  }
  return result
}

export function calculateMinesMultiplierCenti(
  gridSize: number,
  minesCount: number,
  revealedSafeCount: number,
  houseEdgeBps: number,
) {
  if (revealedSafeCount === 0) {
    return 100
  }

  const safeTiles = gridSize - minesCount
  const fairMultiplier =
    combinations(gridSize, revealedSafeCount) /
    combinations(safeTiles, revealedSafeCount)
  const adjusted = fairMultiplier * ((10_000 - houseEdgeBps) / 10_000)
  return Math.min(
    MINES_MAX_MULTIPLIER_CENTI,
    Math.max(100, Math.floor(adjusted * 100)),
  )
}

export function calculateMinesPayout(amount: bigint, multiplierCenti: number) {
  return (amount * BigInt(multiplierCenti)) / 100n
}

export function minesSafeTileCount(gridSize: number, minesCount: number) {
  return gridSize - minesCount
}

export function isMinesBoardCleared(
  gridSize: number,
  minesCount: number,
  revealedSafeCount: number,
) {
  return revealedSafeCount >= minesSafeTileCount(gridSize, minesCount)
}

export function isMineTile(minePositions: number[], tileIndex: number) {
  return minePositions.includes(tileIndex)
}

export function generateMinePositions(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  gridSize: number,
  minesCount: number,
) {
  const indices = Array.from({ length: gridSize }, (_, index) => index)

  for (let cursor = gridSize - 1; cursor > 0; cursor -= 1) {
    const swapIndex = pfRangedInt(
      serverSeed,
      clientSeed,
      nonce,
      cursor,
      cursor + 1,
    )
    const current = indices[cursor]
    if (current === undefined || indices[swapIndex] === undefined) {
      throw new Error('Failed to shuffle mines board')
    }
    indices[cursor] = indices[swapIndex]
    indices[swapIndex] = current
  }

  return indices.slice(0, minesCount).toSorted((left, right) => left - right)
}
