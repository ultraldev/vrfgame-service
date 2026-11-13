import { randomUUID } from 'node:crypto'

import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import type Redis from 'ioredis'

import type { Db } from '@/db'
import * as schema from '@/db/schema'
import type { AppConfig } from '@/lib/config'
import { BackgroundJobs } from '@/lib/jobs'
import { redisLeaderLock } from '@/lib/leader'
import { formatAmount } from '@/lib/money'
import { decryptSeed, encryptSeed } from '@/lib/seed-cipher'
import { REALTIME_CHANNEL, SOCKET_EVENTS } from '@/lib/socket-events'
import { settleLockInTransaction } from '@/modules/wallet/ledger'
import { balanceSnapshot } from '@/modules/wallet/service'
import { WALLET_REFERENCES } from '@/modules/wallet/util'

import {
  CrashEngine,
  computeMultiplierCenti,
  createRoundSeed,
  formatMultiplier,
  generateCrashPointCenti,
} from './engine'
import type { CrashPhase, CrashSnapshot } from './schema'

const CRASH_SLUG = 'crash'
const CRASH_GAME_ID_KEY = 'crash:game_id'
const INTERNAL_REFRESH_CHANNEL = 'vrfgame:crash:refresh_bets'
const LEADER_KEY = 'crash:leader'
const SNAPSHOT_KEY = 'crash:snapshot'
const TICK_MS = 50

type CrashRoundRow = typeof schema.crashRound.$inferSelect
interface PublicRoundBet {
  amount: string
  status?: 'active' | 'cashed_out' | 'lost'
  userId: string
}

interface SnapshotEnvelope {
  snapshot: CrashSnapshot
  updatedAt: number
}

function phaseOf(value: string): CrashPhase {
  if (
    value === 'pending' ||
    value === 'betting' ||
    value === 'running' ||
    value === 'crashed'
  ) {
    return value
  }
  throw new Error(`Unsupported crash phase: ${value}`)
}

function enginePhaseOf(value: string): 'betting' | 'running' | 'crashed' {
  if (value === 'betting' || value === 'running' || value === 'crashed') {
    return value
  }
  throw new Error(`Crash round is not ready for the engine: ${value}`)
}

function extrapolateSnapshot(
  envelope: SnapshotEnvelope,
  now = Date.now(),
): CrashSnapshot {
  const elapsed = Math.max(0, now - envelope.updatedAt)
  const snapshot = structuredClone(envelope.snapshot)
  const current = snapshot.currentRound

  current.phaseElapsedMs += elapsed
  if (current.phase === 'running') {
    current.multiplier = formatMultiplier(
      computeMultiplierCenti(current.phaseElapsedMs),
    )
  }

  if (snapshot.nextRound?.phase === 'betting') {
    snapshot.nextRound.phaseElapsedMs += elapsed
  }

  return snapshot
}

function phaseElapsed(row: CrashRoundRow) {
  const now = Date.now()
  if (row.phase === 'running' && row.runningAt) {
    return Math.max(0, now - row.runningAt.getTime())
  }
  if (row.phase === 'crashed' && row.crashedAt) {
    return Math.max(0, now - row.crashedAt.getTime())
  }
  if (row.phase === 'betting' && row.startedAt) {
    return Math.max(0, now - row.startedAt.getTime())
  }
  return 0
}

export class CrashRuntime {
  private readonly engine = new CrashEngine()
  private currentRound: CrashRoundRow | null = null
  private nextRound: CrashRoundRow | null = null
  private readonly roundBets = new Map<string, PublicRoundBet[]>()
  private leader = false
  private readonly jobs: BackgroundJobs
  private lastTickAt: number | null = null
  private lastPublishedPhase: CrashPhase | null = null
  private subscriber: Redis | null = null
  private started = false
  private readonly config: AppConfig
  private readonly db: Db
  private readonly logger: FastifyBaseLogger
  private readonly redis: Redis

  constructor(
    db: Db,
    redis: Redis,
    config: AppConfig,
    logger: FastifyBaseLogger,
  ) {
    this.config = config
    this.db = db
    this.logger = logger
    this.redis = redis
    this.jobs = new BackgroundJobs(redisLeaderLock(redis), logger, [
      {
        intervalMs: TICK_MS,
        leaderKey: LEADER_KEY,
        name: 'crash:tick',
        onAcquire: async () => {
          this.leader = true
          this.lastTickAt = Date.now()
          await this.initializeState()
        },
        onLose: () => {
          this.leader = false
          this.lastTickAt = null
        },
        run: () => this.tick(),
      },
    ])
  }

  async start() {
    if (this.started) {
      return
    }
    this.started = true
    this.subscriber = this.redis.duplicate()
    await this.subscriber.subscribe(INTERNAL_REFRESH_CHANNEL)
    this.subscriber.on('message', (channel, message) => {
      if (channel !== INTERNAL_REFRESH_CHANNEL || !this.leader) {
        return
      }
      void this.refreshRoundBets(message).then(() => this.persistSnapshot())
    })

    await this.jobs.start()
    const status = this.jobs.getStatuses()[0]
    this.logger.info(
      {
        instanceId: this.jobs.instanceId,
        leader: status?.leader ?? false,
        phase: this.currentRound?.phase ?? null,
        roundId: this.currentRound?.id ?? null,
        roundNumber: this.currentRound?.roundNumber ?? null,
      },
      'Crash runtime ready',
    )
  }

  async stop() {
    this.started = false
    await this.jobs.stop()
    if (this.subscriber) {
      await this.subscriber.quit()
      this.subscriber = null
    }
  }

  async getSnapshot(): Promise<CrashSnapshot> {
    if (this.leader && this.currentRound) {
      return this.buildLeaderSnapshot()
    }

    const raw = await this.redis.get(SNAPSHOT_KEY)
    if (raw) {
      const envelope = JSON.parse(raw) as SnapshotEnvelope
      return extrapolateSnapshot(envelope)
    }

    return this.buildSnapshotFromDatabase()
  }

  async resolveBetTarget() {
    const snapshot = await this.getSnapshot()
    if (
      snapshot.currentRound.phase === 'betting' ||
      snapshot.currentRound.phase === 'pending'
    ) {
      return { id: snapshot.currentRound.id, isNextRound: false }
    }
    if (
      snapshot.nextRound &&
      (snapshot.nextRound.phase === 'betting' ||
        snapshot.nextRound.phase === 'pending')
    ) {
      return { id: snapshot.nextRound.id, isNextRound: true }
    }
    throw Object.assign(new Error('Crash betting is temporarily unavailable'), {
      statusCode: 409,
    })
  }

  async notifyBetsChanged(roundId: string) {
    if (this.leader) {
      await this.refreshRoundBets(roundId)
      await this.persistSnapshot()
      return
    }
    await this.redis.publish(INTERNAL_REFRESH_CHANNEL, roundId)
  }

  async publishEvent(event: string, data: unknown) {
    await this.redis.publish(REALTIME_CHANNEL, JSON.stringify({ data, event }))
  }

  async publishUserEvent(event: string, userId: string, data: unknown) {
    await this.redis.publish(
      REALTIME_CHANNEL,
      JSON.stringify({ data, event, userId }),
    )
  }

  async publishWallet(userId: string, currency?: string) {
    const balance = await balanceSnapshot(this.db, userId, currency)
    await this.publishUserEvent(SOCKET_EVENTS.walletBalanceUpdate, userId, {
      ...balance,
      userId,
    })
  }

  private async tick() {
    if (!this.leader || !this.currentRound) {
      return
    }
    try {
      const now = Date.now()
      const delta = this.lastTickAt === null ? TICK_MS : now - this.lastTickAt
      this.lastTickAt = now
      const events = this.engine.tick(Math.max(0, delta))
      for (const event of events) {
        // Events are ordered; later events depend on the prior transition.
        await this.handleEvent(event)
      }
      if (events.length > 0) {
        await this.persistSnapshot()
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Crash tick failed')
    }
  }

  private async handleEvent(event: ReturnType<CrashEngine['tick']>[number]) {
    switch (event.type) {
      case 'phase': {
        if (this.lastPublishedPhase !== event.phase) {
          this.lastPublishedPhase = event.phase
          await this.publishEvent(SOCKET_EVENTS.phase, {
            phase: event.phase,
            phaseElapsedMs: event.phaseElapsedMs,
            roundId: event.roundId,
          })
        }
        break
      }
      case 'multiplier': {
        await this.publishEvent(SOCKET_EVENTS.multiplier, {
          multiplier: formatMultiplier(event.multiplierCenti),
          roundId: event.roundId,
        })
        break
      }
      case 'running_started': {
        await this.onRunningStarted(event.roundId, event.crashPointCenti)
        break
      }
      case 'round_crashed': {
        await this.onRoundCrashed(
          event.roundId,
          event.crashPointCenti,
          event.serverSeed,
        )
        break
      }
      case 'round_cycle_complete': {
        await this.onCycleComplete()
        break
      }
      default: {
        break
      }
    }
  }

  private async initializeState() {
    const rows = await this.db.query.crashRound.findMany({
      limit: 5,
      orderBy: [desc(schema.crashRound.roundNumber)],
    })
    if (rows.length === 0) {
      await this.createInitialRound()
      return
    }

    const running = rows.find((row) => row.phase === 'running')
    if (running) {
      this.currentRound = running
      this.nextRound =
        rows.find(
          (row) =>
            row.roundNumber === running.roundNumber + 1 &&
            (row.phase === 'pending' || row.phase === 'betting'),
        ) ?? null
    } else {
      const betting = rows.find((row) => row.phase === 'betting')
      if (betting) {
        this.currentRound = betting
      } else {
        const crashed = rows.find((row) => row.phase === 'crashed')
        const pending = rows.find((row) => row.phase === 'pending')
        if (crashed && pending) {
          this.currentRound = crashed
          this.nextRound = pending
        } else if (pending) {
          const now = new Date()
          const [promoted] = await this.db
            .update(schema.crashRound)
            .set({ phase: 'betting', startedAt: now })
            .where(eq(schema.crashRound.id, pending.id))
            .returning()
          this.currentRound = promoted ?? pending
        } else {
          this.currentRound = crashed ?? rows[0] ?? null
        }
      }
    }

    if (this.currentRound) {
      const prepared = await this.prepareCurrentRound(this.currentRound)
      this.currentRound = prepared
      this.engine.configure(prepared.houseEdgeBps / 10_000)
      this.engine.loadRound(
        this.toEngineRound(prepared, phaseElapsed(prepared)),
      )
      await this.refreshRoundBets(prepared.id)
      this.lastPublishedPhase = phaseOf(prepared.phase)
    }
    if (this.nextRound) {
      await this.refreshRoundBets(this.nextRound.id)
    }
    await this.persistSnapshot()
  }

  private async prepareCurrentRound(row: CrashRoundRow) {
    if (row.phase === 'running' && row.crashPointCenti === null) {
      const crashPointCenti = this.crashPointFor(row)
      const [updated] = await this.db
        .update(schema.crashRound)
        .set({ crashPointCenti })
        .where(eq(schema.crashRound.id, row.id))
        .returning()
      return updated ?? row
    }
    return row
  }

  private toEngineRound(row: CrashRoundRow, phaseElapsedMs: number) {
    return {
      clientSeed: row.clientSeed,
      crashPointCenti: row.crashPointCenti,
      id: row.id,
      nonce: row.nonce,
      phase: enginePhaseOf(row.phase),
      phaseElapsedMs,
      roundNumber: row.roundNumber,
      serverSeed: decryptSeed(row.serverSeed, this.config),
      serverSeedHash: row.serverSeedHash,
    }
  }

  private crashPointFor(row: CrashRoundRow) {
    return generateCrashPointCenti(
      decryptSeed(row.serverSeed, this.config),
      row.clientSeed,
      row.nonce,
      row.houseEdgeBps / 10_000,
    )
  }

  private async createInitialRound() {
    const seed = createRoundSeed()
    const game = await this.crashGame()
    const rtpBps = game.rtp ?? 9600
    const [round] = await this.db
      .insert(schema.crashRound)
      .values({
        clientSeed: seed.clientSeed,
        houseEdgeBps: 10_000 - rtpBps,
        id: randomUUID(),
        nonce: 1,
        phase: 'betting',
        roundNumber: 1,
        serverSeed: encryptSeed(seed.serverSeed, this.config),
        serverSeedHash: seed.serverSeedHash,
        startedAt: new Date(),
      })
      .returning()
    if (!round) {
      throw new Error('Failed to create initial crash round')
    }
    this.currentRound = round
    this.nextRound = null
    this.roundBets.set(round.id, [])
    this.engine.configure(round.houseEdgeBps / 10_000)
    this.engine.loadRound(this.toEngineRound(round, 0))
    this.lastPublishedPhase = 'betting'
    await this.persistSnapshot()
  }

  private async createNextRound() {
    if (!this.currentRound) {
      throw new Error('Crash current round is missing')
    }
    const roundNumber = this.currentRound.roundNumber + 1
    const existing = await this.db.query.crashRound.findFirst({
      where: eq(schema.crashRound.roundNumber, roundNumber),
    })
    if (existing) {
      this.nextRound = existing
      await this.refreshRoundBets(existing.id)
      return existing
    }

    const seed = createRoundSeed()
    const game = await this.crashGame()
    const [round] = await this.db
      .insert(schema.crashRound)
      .values({
        clientSeed: seed.clientSeed,
        houseEdgeBps: 10_000 - (game.rtp ?? 9600),
        id: randomUUID(),
        nonce: roundNumber,
        phase: 'pending',
        roundNumber,
        serverSeed: encryptSeed(seed.serverSeed, this.config),
        serverSeedHash: seed.serverSeedHash,
      })
      .returning()
    if (!round) {
      throw new Error('Failed to create next crash round')
    }
    this.nextRound = round
    this.roundBets.set(round.id, [])
    await this.publishEvent(SOCKET_EVENTS.nextRound, {
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      roundId: round.id,
      roundNumber: round.roundNumber,
      serverSeedHash: round.serverSeedHash,
    })
    return round
  }

  private async onRunningStarted(roundId: string, crashPointCenti: number) {
    if (!this.currentRound || this.currentRound.id !== roundId) {
      return
    }
    const now = new Date()
    const [updated] = await this.db
      .update(schema.crashRound)
      .set({ crashPointCenti, phase: 'running', runningAt: now })
      .where(eq(schema.crashRound.id, roundId))
      .returning()
    this.currentRound = updated ?? {
      ...this.currentRound,
      crashPointCenti,
      phase: 'running',
      runningAt: now,
    }
    this.logger.info(
      {
        roundId,
        roundNumber: this.currentRound.roundNumber,
      },
      'Crash round started',
    )
    await this.createNextRound()
    await this.publishEvent(SOCKET_EVENTS.roundStarted, {
      clientSeed: this.currentRound.clientSeed,
      crashPoint: null,
      nonce: this.currentRound.nonce,
      roundId,
      roundNumber: this.currentRound.roundNumber,
      serverSeedHash: this.currentRound.serverSeedHash,
    })
    await this.persistSnapshot()
  }

  private async onRoundCrashed(
    roundId: string,
    crashPointCenti: number,
    serverSeed: string,
  ) {
    if (!this.currentRound || this.currentRound.id !== roundId) {
      return
    }
    const now = new Date()
    const gameId = await this.crashGameId()
    const lostBets = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`crash-round:${roundId}`}, 0))`,
      )
      await tx
        .update(schema.crashRound)
        .set({
          crashPointCenti,
          crashedAt: now,
          phase: 'crashed',
          serverSeed: encryptSeed(serverSeed, this.config),
        })
        .where(eq(schema.crashRound.id, roundId))

      const activeBets = await tx
        .select()
        .from(schema.gameBet)
        .where(
          and(
            eq(schema.gameBet.gameId, gameId),
            eq(schema.gameBet.status, 'active'),
            sql`${schema.gameBet.result} ->> 'roundId' = ${roundId}`,
          ),
        )
        .for('update')

      for (const bet of activeBets) {
        // One transaction/connection serializes the loss settlements.
        await settleLockInTransaction(tx, {
          idempotencyKey: `${bet.id}:lost`,
          lockedAmount: bet.amount,
          payout: 0n,
          reference: {
            referenceId: bet.id,
            referenceType: WALLET_REFERENCES.crashLoss,
          },
          walletId: bet.walletId,
        })
      }
      if (activeBets.length > 0) {
        await tx
          .update(schema.gameBet)
          .set({ payout: 0n, status: 'lost' })
          .where(
            inArray(
              schema.gameBet.id,
              activeBets.map((bet) => bet.id),
            ),
          )
      }
      return activeBets
    })

    this.currentRound = {
      ...this.currentRound,
      crashPointCenti,
      crashedAt: now,
      phase: 'crashed',
    }
    this.logger.info(
      {
        crashPoint: formatMultiplier(crashPointCenti),
        roundId,
        roundNumber: this.currentRound.roundNumber,
      },
      'Crash round crashed',
    )
    await this.publishEvent(SOCKET_EVENTS.roundCrashed, {
      clientSeed: this.currentRound.clientSeed,
      crashPoint: formatMultiplier(crashPointCenti),
      nonce: this.currentRound.nonce,
      roundId,
      serverSeed,
    })
    await this.refreshRoundBets(roundId)
    await this.persistSnapshot()
    await Promise.all(
      lostBets.map((bet) => this.publishWallet(bet.userId, bet.currency)),
    )
  }

  private async onCycleComplete() {
    if (!this.nextRound) {
      await this.createNextRound()
    }
    if (!this.nextRound) {
      throw new Error('Crash next round is missing')
    }

    const now = new Date()
    const [promoted] = await this.db
      .update(schema.crashRound)
      .set({
        crashPointCenti: null,
        crashedAt: null,
        phase: 'betting',
        runningAt: null,
        startedAt: now,
      })
      .where(eq(schema.crashRound.id, this.nextRound.id))
      .returning()
    if (!promoted) {
      throw new Error('Failed to promote crash round')
    }

    this.currentRound = promoted
    this.nextRound = null
    this.lastPublishedPhase = 'betting'
    this.engine.configure(promoted.houseEdgeBps / 10_000)
    this.engine.loadRound(this.toEngineRound(promoted, 0))
    await this.refreshRoundBets(promoted.id)
    await this.publishEvent(SOCKET_EVENTS.phase, {
      phase: 'betting',
      phaseElapsedMs: 0,
      roundId: promoted.id,
    })
    await this.persistSnapshot()
  }

  private async buildLeaderSnapshot(): Promise<CrashSnapshot> {
    if (!this.currentRound) {
      throw new Error('Crash runtime is not initialized')
    }
    return {
      currentRound: await this.publicRound(this.currentRound),
      nextRound: this.nextRound ? await this.publicRound(this.nextRound) : null,
    }
  }

  private async buildSnapshotFromDatabase(): Promise<CrashSnapshot> {
    const rows = await this.db.query.crashRound.findMany({
      limit: 3,
      orderBy: [desc(schema.crashRound.roundNumber)],
    })
    const running = rows.find((row) => row.phase === 'running')
    const betting = rows.find((row) => row.phase === 'betting')
    const pending = rows.find((row) => row.phase === 'pending')
    const crashed = rows.find((row) => row.phase === 'crashed')
    const current =
      running ??
      betting ??
      (pending
        ? (rows.find(
            (row) =>
              row.phase === 'crashed' &&
              row.roundNumber === pending.roundNumber - 1,
          ) ?? pending)
        : crashed) ??
      rows[0]
    if (!current) {
      throw Object.assign(new Error('Crash round is not ready'), {
        statusCode: 503,
      })
    }
    let next: CrashRoundRow | null = null
    if (current !== pending) {
      next =
        rows.find(
          (row) =>
            row.roundNumber === current.roundNumber + 1 &&
            (row.phase === 'pending' || row.phase === 'betting'),
        ) ?? null
    }
    return {
      currentRound: await this.publicRound(current, false),
      nextRound: next ? await this.publicRound(next, false) : null,
    }
  }

  private async publicRound(row: CrashRoundRow, includeSeed = true) {
    const phase = phaseOf(row.phase)
    const phaseElapsedMs = phaseElapsed(row)
    let multiplier = '1.00'
    if (phase === 'running') {
      multiplier = formatMultiplier(computeMultiplierCenti(phaseElapsedMs))
    } else if (phase === 'crashed' && row.crashPointCenti !== null) {
      multiplier = formatMultiplier(row.crashPointCenti)
    }

    return {
      bets: this.roundBets.get(row.id) ?? (await this.loadRoundBets(row.id)),
      clientSeed: row.clientSeed,
      crashPoint:
        phase === 'crashed' && row.crashPointCenti !== null
          ? formatMultiplier(row.crashPointCenti)
          : null,
      id: row.id,
      multiplier,
      nonce: row.nonce,
      phase,
      phaseElapsedMs,
      roundNumber: row.roundNumber,
      serverSeed:
        includeSeed && phase === 'crashed'
          ? decryptSeed(row.serverSeed, this.config)
          : null,
      serverSeedHash: row.serverSeedHash,
    }
  }

  private async refreshRoundBets(roundId: string) {
    if (!this.leader) {
      await this.redis.publish(INTERNAL_REFRESH_CHANNEL, roundId)
      return
    }
    this.roundBets.set(roundId, await this.loadRoundBets(roundId))
  }

  private async loadRoundBets(roundId: string): Promise<PublicRoundBet[]> {
    const gameId = await this.crashGameId()
    const bets = await this.db.query.gameBet.findMany({
      columns: {
        amount: true,
        currency: true,
        status: true,
        userId: true,
      },
      where: and(
        eq(schema.gameBet.gameId, gameId),
        sql`${schema.gameBet.result} ->> 'roundId' = ${roundId}`,
      ),
    })
    const codes = [...new Set(bets.map((bet) => bet.currency))]
    const currencies = codes.length
      ? await this.db
          .select()
          .from(schema.currency)
          .where(inArray(schema.currency.code, codes))
      : []
    const decimals = new Map(
      currencies.map((currency) => [currency.code, currency.decimals]),
    )

    return bets.flatMap((bet) => {
      if (bet.status === 'cancelled') {
        return []
      }
      const scale = decimals.get(bet.currency)
      if (scale === undefined) {
        return []
      }
      let status: 'active' | 'cashed_out' | 'lost' = 'lost'
      if (bet.status === 'active') {
        status = 'active'
      } else if (bet.status === 'cashed_out') {
        status = 'cashed_out'
      }
      return [
        {
          amount: formatAmount(bet.amount, scale),
          status,
          userId: bet.userId,
        },
      ]
    })
  }

  private async persistSnapshot() {
    if (!this.leader || !this.currentRound) {
      return
    }
    const snapshot = await this.buildLeaderSnapshot()
    const envelope: SnapshotEnvelope = { snapshot, updatedAt: Date.now() }
    await this.redis.set(SNAPSHOT_KEY, JSON.stringify(envelope), 'EX', 30)
  }

  private async crashGame() {
    const game = await this.db.query.game.findFirst({
      columns: { id: true, rtp: true },
      where: and(
        eq(schema.game.slug, CRASH_SLUG),
        eq(schema.game.status, 'active'),
      ),
    })
    if (!game) {
      throw new Error('Crash game is not configured')
    }
    return game
  }

  private async crashGameId() {
    const cached = await this.redis.get(CRASH_GAME_ID_KEY)
    if (cached) {
      return cached
    }
    const game = await this.crashGame()
    await this.redis.set(CRASH_GAME_ID_KEY, game.id)
    return game.id
  }
}
