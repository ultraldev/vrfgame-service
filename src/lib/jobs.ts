import { randomUUID } from 'node:crypto'

import type { FastifyBaseLogger } from 'fastify'

import { errorMessage } from './errors'
import type { LeaderLock } from './leader'

const DEFAULT_LEADER_RENEW_MS = 2000
const DEFAULT_LEADER_TTL_SECONDS = 5

export interface BackgroundJob {
  intervalMs: number
  leaderKey: string
  leaderRenewMs?: number
  leaderTtlSeconds?: number
  name: string
  onAcquire?: () => Promise<void> | void
  onLose?: () => Promise<void> | void
  run: () => Promise<void>
  runImmediately?: boolean
}

export interface BackgroundJobStatus {
  lastError: string | null
  lastRunAt: string | null
  lastSuccessAt: string | null
  leader: boolean
  name: string
  running: boolean
}

type JobLogger = Pick<FastifyBaseLogger, 'debug' | 'error' | 'info' | 'warn'>

interface JobState {
  activeRun: Promise<void> | null
  definition: BackgroundJob
  electionInFlight: boolean
  lastError: string | null
  lastRunAt: Date | null
  lastSuccessAt: Date | null
  leader: boolean
  renewTimer: NodeJS.Timeout | null
  runTimer: NodeJS.Timeout | null
  running: boolean
  stopped: boolean
}

export class BackgroundJobs {
  readonly instanceId: string
  private readonly jobs: JobState[]
  private readonly leader: LeaderLock
  private readonly logger: JobLogger
  private started = false

  constructor(
    leader: LeaderLock,
    logger: JobLogger,
    jobs: BackgroundJob[],
    instanceId = randomUUID(),
  ) {
    this.leader = leader
    this.logger = logger
    this.instanceId = instanceId
    this.jobs = jobs.map((definition) => ({
      activeRun: null,
      definition,
      electionInFlight: false,
      lastError: null,
      lastRunAt: null,
      lastSuccessAt: null,
      leader: false,
      renewTimer: null,
      runTimer: null,
      running: false,
      stopped: false,
    }))
  }

  async start() {
    if (this.started) {
      return
    }
    this.started = true
    await Promise.all(this.jobs.map((job) => this.startElection(job)))
  }

  async stop() {
    this.started = false
    for (const job of this.jobs) {
      job.stopped = true
      BackgroundJobs.clearTimers(job)
    }
    await Promise.all(
      this.jobs.flatMap((job) => (job.activeRun ? [job.activeRun] : [])),
    )
    for (const job of this.jobs) {
      if (!job.leader) {
        continue
      }
      await this.leader.release(
        job.definition.leaderKey,
        this.owner(job.definition),
      )
      job.leader = false
      await job.definition.onLose?.()
      this.logger.info(
        {
          instanceId: this.instanceId,
          job: job.definition.name,
        },
        'Background job leadership released',
      )
    }
  }

  getStatuses(): BackgroundJobStatus[] {
    return this.jobs.map((job) => ({
      lastError: job.lastError,
      lastRunAt: job.lastRunAt?.toISOString() ?? null,
      lastSuccessAt: job.lastSuccessAt?.toISOString() ?? null,
      leader: job.leader,
      name: job.definition.name,
      running: job.running,
    }))
  }

  private owner(job: BackgroundJob) {
    return `${this.instanceId}:${job.name}`
  }

  private static clearTimers(job: JobState) {
    if (job.renewTimer) {
      clearTimeout(job.renewTimer)
      job.renewTimer = null
    }
    if (job.runTimer) {
      clearTimeout(job.runTimer)
      job.runTimer = null
    }
  }

  private async startElection(job: JobState) {
    await this.maintainElection(job)
    this.scheduleElection(job)
  }

  private scheduleElection(job: JobState) {
    if (job.stopped || !this.started) {
      return
    }
    const delay = job.definition.leaderRenewMs ?? DEFAULT_LEADER_RENEW_MS
    job.renewTimer = setTimeout(() => {
      job.renewTimer = null
      void this.maintainElection(job).finally(() => {
        this.scheduleElection(job)
      })
    }, delay)
  }

  private async maintainElection(job: JobState) {
    if (job.electionInFlight || job.stopped || !this.started) {
      return
    }
    job.electionInFlight = true
    try {
      if (job.leader) {
        const renewed = await this.leader.renew(
          job.definition.leaderKey,
          this.owner(job.definition),
          job.definition.leaderTtlSeconds ?? DEFAULT_LEADER_TTL_SECONDS,
        )
        if (renewed) {
          return
        }
        job.leader = false
        BackgroundJobs.clearRunTimer(job)
        await job.definition.onLose?.()
        this.logger.warn(
          {
            instanceId: this.instanceId,
            job: job.definition.name,
          },
          'Background job leadership lost',
        )
      }

      const acquired = await this.leader.acquire(
        job.definition.leaderKey,
        this.owner(job.definition),
        job.definition.leaderTtlSeconds ?? DEFAULT_LEADER_TTL_SECONDS,
      )
      if (!acquired) {
        return
      }
      job.leader = true
      this.logger.info(
        {
          instanceId: this.instanceId,
          job: job.definition.name,
        },
        'Background job leadership acquired',
      )
      try {
        await job.definition.onAcquire?.()
      } catch (error) {
        job.leader = false
        try {
          await this.leader.release(
            job.definition.leaderKey,
            this.owner(job.definition),
          )
        } catch (releaseError) {
          this.logger.warn(
            {
              err: releaseError,
              instanceId: this.instanceId,
              job: job.definition.name,
            },
            'Background job leadership release failed',
          )
        }
        await job.definition.onLose?.()
        throw error
      }
      if (job.definition.runImmediately !== false) {
        this.scheduleRun(job, 0)
      }
    } catch (error) {
      this.logger.warn(
        {
          err: error,
          instanceId: this.instanceId,
          job: job.definition.name,
        },
        'Background job leadership check failed',
      )
    } finally {
      job.electionInFlight = false
    }
  }

  private static clearRunTimer(job: JobState) {
    if (job.runTimer) {
      clearTimeout(job.runTimer)
      job.runTimer = null
    }
  }

  private scheduleRun(job: JobState, delayMs: number) {
    if (job.stopped || !this.started || !job.leader) {
      return
    }
    BackgroundJobs.clearRunTimer(job)
    job.runTimer = setTimeout(() => {
      job.runTimer = null
      void this.execute(job)
    }, delayMs)
  }

  private async execute(job: JobState) {
    if (job.stopped || !this.started || !job.leader || job.running) {
      return
    }
    job.running = true
    job.lastRunAt = new Date()
    const run = (async () => {
      try {
        await job.definition.run()
        job.lastError = null
        job.lastSuccessAt = new Date()
        this.logger.debug(
          {
            instanceId: this.instanceId,
            job: job.definition.name,
          },
          'Background job completed',
        )
      } catch (error) {
        job.lastError = errorMessage(error)
        this.logger.error(
          {
            err: error,
            instanceId: this.instanceId,
            job: job.definition.name,
          },
          'Background job failed',
        )
      }
    })()
    job.activeRun = run
    await run
    job.activeRun = null
    job.running = false
    if (job.leader) {
      this.scheduleRun(job, job.definition.intervalMs)
    }
  }
}
