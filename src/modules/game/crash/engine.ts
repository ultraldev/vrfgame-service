import { createHash, createHmac, randomBytes } from 'node:crypto'

export const CRASH_BETTING_DURATION_MS = 6000
export const CRASH_CRASHED_DURATION_MS = 3000
export const CRASH_GROWTH_RATE_PER_SECOND = 0.06
export const CRASH_HOUSE_EDGE = 0.01
export const CRASH_MAX_POINT_CENTI = 100_000

export type CrashPhase = 'betting' | 'running' | 'crashed'

export interface CrashRoundState {
  crashPointCenti: number | null
  clientSeed: string
  id: string
  nonce: number
  phase: CrashPhase
  roundNumber: number
  serverSeed: string
  serverSeedHash: string
}

export type CrashEngineEvent =
  | {
      type: 'phase'
      roundId: string
      phase: CrashPhase
      phaseElapsedMs: number
    }
  | {
      type: 'multiplier'
      roundId: string
      multiplierCenti: number
    }
  | {
      type: 'running_started'
      roundId: string
      roundNumber: number
      crashPointCenti: number
    }
  | {
      type: 'round_crashed'
      roundId: string
      roundNumber: number
      crashPointCenti: number
      serverSeed: string
    }
  | {
      type: 'round_cycle_complete'
      roundId: string
      roundNumber: number
    }

export function createRoundSeed() {
  const serverSeed = randomBytes(32).toString('hex')
  const serverSeedHash = createHash('sha256').update(serverSeed).digest('hex')
  const clientSeed = randomBytes(16).toString('hex')
  return { clientSeed, serverSeed, serverSeedHash }
}

export function generateCrashPointCenti(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  houseEdge = CRASH_HOUSE_EDGE,
) {
  const digest = createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex')
  const roll = Number.parseInt(digest.slice(0, 8), 16) / 0x1_00_00_00_00
  const raw = (1 - houseEdge) / (1 - roll)
  return Math.min(CRASH_MAX_POINT_CENTI, Math.max(100, Math.floor(raw * 100)))
}

export function computeMultiplierCenti(
  runningElapsedMs: number,
  growthRatePerSecond = CRASH_GROWTH_RATE_PER_SECOND,
) {
  const elapsedSeconds = runningElapsedMs / 1000
  return Math.floor(Math.exp(growthRatePerSecond * elapsedSeconds) * 100)
}

export function formatMultiplier(multiplierCenti: number) {
  const whole = Math.floor(multiplierCenti / 100)
  const fraction = Math.abs(multiplierCenti % 100)
  return `${whole}.${fraction.toString().padStart(2, '0')}`
}

export function calculateCrashPayout(amount: bigint, multiplierCenti: number) {
  return (amount * BigInt(multiplierCenti)) / 100n
}

export class CrashEngine {
  private crashPointCenti: number | null = null
  private multiplierCenti = 100
  private phaseElapsedMs = 0
  private round: CrashRoundState | null = null
  private houseEdge = CRASH_HOUSE_EDGE

  loadRound(round: CrashRoundState, phaseElapsedMs = 0) {
    this.round = { ...round }
    this.phaseElapsedMs = Math.max(0, phaseElapsedMs)
    this.crashPointCenti = round.crashPointCenti

    if (round.phase === 'crashed' && round.crashPointCenti !== null) {
      this.multiplierCenti = round.crashPointCenti
      return
    }
    if (round.phase === 'running') {
      this.multiplierCenti = computeMultiplierCenti(this.phaseElapsedMs)
      return
    }
    this.multiplierCenti = 100
  }

  configure(houseEdge: number) {
    this.houseEdge = houseEdge
  }

  getPhase() {
    return this.round?.phase ?? null
  }

  getRoundId() {
    return this.round?.id ?? null
  }

  getMultiplierCenti() {
    return this.multiplierCenti
  }

  getRound() {
    return this.round
  }

  tick(deltaMs: number) {
    if (!this.round) {
      return []
    }

    const events: CrashEngineEvent[] = []
    const nextElapsed = this.phaseElapsedMs + deltaMs

    if (this.round.phase === 'betting') {
      if (nextElapsed >= CRASH_BETTING_DURATION_MS) {
        this.startRunning(events)
      } else {
        this.phaseElapsedMs = nextElapsed
        events.push(this.phaseEvent())
      }
      return events
    }

    if (this.round.phase === 'running') {
      this.updateRunning(nextElapsed, events)
      return events
    }

    if (nextElapsed >= CRASH_CRASHED_DURATION_MS) {
      events.push({
        roundId: this.round.id,
        roundNumber: this.round.roundNumber,
        type: 'round_cycle_complete',
      })
    } else {
      this.phaseElapsedMs = nextElapsed
      events.push(this.phaseEvent())
    }
    return events
  }

  private startRunning(events: CrashEngineEvent[]) {
    if (!this.round) {
      return
    }

    const crashPointCenti = generateCrashPointCenti(
      this.round.serverSeed,
      this.round.clientSeed,
      this.round.nonce,
      this.houseEdge,
    )
    this.crashPointCenti = crashPointCenti
    this.round.phase = 'running'
    this.phaseElapsedMs = 0
    this.multiplierCenti = 100
    events.push(this.phaseEvent(), {
      crashPointCenti,
      roundId: this.round.id,
      roundNumber: this.round.roundNumber,
      type: 'running_started',
    })
  }

  private updateRunning(nextElapsed: number, events: CrashEngineEvent[]) {
    if (!this.round || this.crashPointCenti === null) {
      return
    }
    const nextMultiplier = computeMultiplierCenti(nextElapsed)
    if (nextMultiplier >= this.crashPointCenti) {
      this.round.phase = 'crashed'
      this.phaseElapsedMs = 0
      this.multiplierCenti = this.crashPointCenti
      events.push(this.phaseEvent(), {
        crashPointCenti: this.crashPointCenti,
        roundId: this.round.id,
        roundNumber: this.round.roundNumber,
        serverSeed: this.round.serverSeed,
        type: 'round_crashed',
      })
      return
    }
    if (nextMultiplier !== this.multiplierCenti) {
      this.multiplierCenti = nextMultiplier
      events.push({
        multiplierCenti: nextMultiplier,
        roundId: this.round.id,
        type: 'multiplier',
      })
    }
    this.phaseElapsedMs = nextElapsed
  }

  private phaseEvent() {
    if (!this.round) {
      throw new Error('Crash round is not loaded')
    }
    return {
      phase: this.round.phase,
      phaseElapsedMs: this.phaseElapsedMs,
      roundId: this.round.id,
      type: 'phase' as const,
    }
  }
}
