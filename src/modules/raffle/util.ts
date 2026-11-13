export const RAFFLE_SHARE_PRICE = '0.50'

export const RAFFLE_CATEGORIES = [
  'cs2',
  'dota2',
  'digital',
  'motorcycle',
] as const

export const RAFFLE_TAGS = ['new', 'hot'] as const

export type RaffleOutcome = 'none' | 'open' | 'won' | 'lost' | 'voided'

interface RoundThresholds {
  capacity: number
  earlyWindowSec: number
  endsAt: Date
  sold: number
  tauBps: number
  tauEarlyBps: number
}

export function computeRaffleCapacity(
  payoutAmount: bigint,
  sharePrice: bigint,
  tauBps: number,
) {
  if (payoutAmount <= 0n || sharePrice <= 0n || tauBps <= 0) {
    throw new Error('Invalid raffle capacity inputs')
  }
  const numerator = payoutAmount * 10_000n
  const denominator = sharePrice * BigInt(tauBps)
  return Number((numerator + denominator - 1n) / denominator)
}

export function raffleThreshold(round: RoundThresholds, closeBps: number) {
  return round.capacity > 0 && round.sold * 10_000 >= round.capacity * closeBps
}

export function raffleResolution(
  round: RoundThresholds,
  now = new Date(),
): 'draw' | 'void' | 'wait' {
  if (round.sold >= round.capacity) {
    return 'draw'
  }
  const remainingMs = round.endsAt.getTime() - now.getTime()
  if (
    remainingMs <= round.earlyWindowSec * 1000 &&
    raffleThreshold(round, round.tauEarlyBps)
  ) {
    return 'draw'
  }
  if (remainingMs > 0) {
    return 'wait'
  }
  return raffleThreshold(round, round.tauBps) ? 'draw' : 'void'
}

export function raffleOutcome(input: {
  myShares: number
  status: string
  userId?: string
  winnerUserId: string | null
}): RaffleOutcome {
  if (input.myShares <= 0) {
    return 'none'
  }
  if (input.status === 'open' || input.status === 'drawing') {
    return 'open'
  }
  if (input.status === 'voided') {
    return 'voided'
  }
  if (
    input.status === 'settled' &&
    input.userId &&
    input.winnerUserId === input.userId
  ) {
    return 'won'
  }
  return input.status === 'settled' ? 'lost' : 'none'
}

export function raffleWinProbabilityBps(myShares: number, capacity: number) {
  return capacity > 0 ? Math.floor((myShares * 10_000) / capacity) : 0
}
