export const DICE_DIRECTIONS = ['over', 'under'] as const
export type DiceDirection = (typeof DICE_DIRECTIONS)[number]

export const DICE_MIN_TARGET = 1
export const DICE_MAX_TARGET = 98

export function calculateDiceOutcome(
  direction: DiceDirection,
  target: number,
  roll: number,
) {
  return direction === 'over' ? roll > target * 100 : roll < target * 100
}

export function calculateDicePayout(
  amount: bigint,
  direction: DiceDirection,
  target: number,
  houseEdgeBps: bigint,
) {
  const winningOutcomes =
    direction === 'over' ? 9999 - target * 100 : target * 100
  if (winningOutcomes <= 0) {
    return 0n
  }

  const multiplierBps =
    ((10_000n - houseEdgeBps) * 10_000n) / BigInt(winningOutcomes)
  return (amount * multiplierBps) / 10_000n
}

export function formatRoll(roll: number) {
  return (roll / 100).toFixed(2)
}

export function isWinningPayout(amount: bigint, payout: bigint) {
  return payout > amount
}
