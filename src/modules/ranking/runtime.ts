import type { FastifyBaseLogger } from 'fastify'
import type Redis from 'ioredis'

import type { Db } from '@/db'
import { BackgroundJobs } from '@/lib/jobs'
import { redisLeaderLock } from '@/lib/leader'

import {
  catchUpRankingPeriods,
  payPendingRankingRewards,
  rebuildRankingPeriod,
  settleDueRankingPeriods,
} from './settlement'
import {
  currentPeriodStart,
  getRankingConfig,
  RANKING_PERIOD_TYPES,
} from './util'

const TICK_MS = 2 * 60 * 1000

export class RankingRuntime {
  private readonly db: Db
  private readonly jobs: BackgroundJobs
  private readonly logger: FastifyBaseLogger
  private readonly redis: Redis

  constructor(db: Db, redis: Redis, logger: FastifyBaseLogger) {
    this.db = db
    this.logger = logger
    this.redis = redis
    this.jobs = new BackgroundJobs(redisLeaderLock(redis), logger, [
      {
        intervalMs: TICK_MS,
        leaderKey: 'ranking:settle:leader',
        name: 'ranking:tick',
        run: () => this.tick(),
      },
    ])
  }

  async start() {
    await this.jobs.start()
    this.logger.info(
      { instanceId: this.jobs.instanceId },
      'Ranking runtime ready',
    )
  }

  async stop() {
    await this.jobs.stop()
  }

  getStatuses() {
    return this.jobs.getStatuses()
  }

  private async tick() {
    const now = new Date()
    for (const periodType of RANKING_PERIOD_TYPES) {
      const config = getRankingConfig(periodType)
      if (!config) {
        continue
      }
      const caughtUp = await catchUpRankingPeriods(this.db, config, now)
      const current = currentPeriodStart(periodType, now)
      await rebuildRankingPeriod(this.db, config, current, now)
      const settled = await settleDueRankingPeriods(this.db, periodType)
      if (caughtUp > 0 || settled.settled > 0 || settled.failed > 0) {
        this.logger.info(
          {
            caughtUp,
            failed: settled.failed,
            periodType,
            settled: settled.settled,
          },
          'Ranking periods processed',
        )
      }
    }

    const rewards = await payPendingRankingRewards(this.db, this.redis)
    if (rewards.paid > 0 || rewards.failed > 0) {
      this.logger.info(rewards, 'Ranking rewards processed')
    }
  }
}
