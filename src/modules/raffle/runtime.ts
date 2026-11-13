import type { FastifyBaseLogger } from 'fastify'
import type Redis from 'ioredis'

import type { Db } from '@/db'
import type { AppConfig } from '@/lib/config'
import { BackgroundJobs } from '@/lib/jobs'
import { redisLeaderLock } from '@/lib/leader'

import { ensureOpenRaffleRounds, settleDueRaffleRounds } from './service'

const TICK_MS = 1000

export class RaffleRuntime {
  private readonly config: AppConfig
  private readonly db: Db
  private readonly jobs: BackgroundJobs
  private readonly logger: FastifyBaseLogger

  constructor(
    db: Db,
    redis: Redis,
    config: AppConfig,
    logger: FastifyBaseLogger,
  ) {
    this.config = config
    this.db = db
    this.logger = logger
    this.jobs = new BackgroundJobs(redisLeaderLock(redis), logger, [
      {
        intervalMs: TICK_MS,
        leaderKey: 'raffle:leader',
        name: 'raffle:tick',
        run: () => this.tick(),
      },
    ])
  }

  async start() {
    await this.jobs.start()
    this.logger.info(
      { instanceId: this.jobs.instanceId },
      'Raffle runtime ready',
    )
  }

  async stop() {
    await this.jobs.stop()
  }

  getStatuses() {
    return this.jobs.getStatuses()
  }

  private async tick() {
    await ensureOpenRaffleRounds(this.db, this.config)
    const settled = await settleDueRaffleRounds(this.db, this.config)
    if (settled.length > 0) {
      this.logger.info({ roundIds: settled }, 'Raffle rounds settled')
    }
  }
}
