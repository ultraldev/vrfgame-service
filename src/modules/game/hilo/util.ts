import { pfRangedInt } from '@/modules/game/fairness'

export const HILO_MIN_CARD = 1
export const HILO_MAX_CARD = 13
export const HILO_ONE_BPS = 10_000
export const HILO_MAX_MULTIPLIER_BPS = 10_000_000_000
export const HILO_MAX_MULTIPLIER_CENTI = HILO_MAX_MULTIPLIER_BPS / 100
export const HILO_MAX_ROUNDS = 200

export const HILO_DIRECTIONS = ['higher', 'lower', 'same'] as const
export type HiloDirection = (typeof HILO_DIRECTIONS)[number]
export type HiloRoundType = 'deal' | 'skip' | 'guess'

export interface HiloRound {
  card: number
  currentCard?: number
  direction?: HiloDirection
  nonce: number
  type: HiloRoundType
  won?: boolean
}

export interface HiloBetResult {
  cumulativeMultiplierBps: number
  cumulativeMultiplierCenti: number
  currentCard: number
  rounds: HiloRound[]
}

export function drawHiloCard(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
) {
  return pfRangedInt(serverSeed, clientSeed, nonce, 0, 13) + 1
}

export function availableDirections(card: number) {
  if (card === HILO_MIN_CARD) {
    return ['higher', 'same'] as const
  }
  if (card === HILO_MAX_CARD) {
    return ['lower', 'same'] as const
  }
  return ['higher', 'lower'] as const
}

export function isValidDirection(card: number, direction: HiloDirection) {
  return availableDirections(card).some((available) => available === direction)
}

export function winCount(card: number, direction: HiloDirection) {
  if (direction === 'same') {
    return 1
  }
  if (direction === 'higher') {
    return card === HILO_MIN_CARD ? HILO_MAX_CARD - 1 : HILO_MAX_CARD - card + 1
  }
  return card === HILO_MAX_CARD ? HILO_MAX_CARD - 1 : card
}

export function getHiloMultiplierBps(
  card: number,
  direction: HiloDirection,
  houseEdgeBps: number,
) {
  const count = winCount(card, direction)
  if (count <= 0) {
    return HILO_ONE_BPS
  }
  const fairBps = (13 * HILO_ONE_BPS) / count
  const adjustedBps = (fairBps * (10_000 - houseEdgeBps)) / 10_000
  return Math.max(HILO_ONE_BPS, Math.floor(adjustedBps))
}

export function compoundHiloMultiplierBps(
  cumulativeBps: number,
  roundBps: number,
) {
  return Math.min(
    HILO_MAX_MULTIPLIER_BPS,
    Math.floor((cumulativeBps * roundBps) / HILO_ONE_BPS),
  )
}

export function bpsToCenti(bps: number) {
  return Math.max(100, Math.floor(bps / 100))
}

export function readCumulativeMultiplierBps(result: {
  cumulativeMultiplierBps?: number
  cumulativeMultiplierCenti: number
}) {
  return (
    result.cumulativeMultiplierBps ?? result.cumulativeMultiplierCenti * 100
  )
}

export function calculateHiloPayoutBps(amount: bigint, multiplierBps: number) {
  return (amount * BigInt(multiplierBps)) / 10_000n
}

export function canCashOutHilo(result: Pick<HiloBetResult, 'rounds'>) {
  return (
    result.rounds.length >= HILO_MAX_ROUNDS ||
    result.rounds.some((round) => round.type === 'guess' && round.won === true)
  )
}

export function didWin(
  currentCard: number,
  nextCard: number,
  direction: HiloDirection,
) {
  if (direction === 'same') {
    return nextCard === currentCard
  }
  if (direction === 'higher') {
    return currentCard === HILO_MIN_CARD
      ? nextCard > currentCard
      : nextCard >= currentCard
  }
  return currentCard === HILO_MAX_CARD
    ? nextCard < currentCard
    : nextCard <= currentCard
}
