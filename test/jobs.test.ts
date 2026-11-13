import type { FastifyBaseLogger } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BackgroundJobs } from '@/lib/jobs'
import type { LeaderLock } from '@/lib/leader'

function logger() {
  return {
    debug: vi.fn<() => void>(),
    error: vi.fn<() => void>(),
    info: vi.fn<() => void>(),
    warn: vi.fn<() => void>(),
  } satisfies Pick<FastifyBaseLogger, 'debug' | 'error' | 'info' | 'warn'>
}

function leaderLock(acquired = true): LeaderLock {
  return {
    acquire: vi.fn<LeaderLock['acquire']>(() => Promise.resolve(acquired)),
    release: vi.fn<LeaderLock['release']>(() => Promise.resolve()),
    renew: vi.fn<LeaderLock['renew']>(() => Promise.resolve(acquired)),
  }
}

describe(BackgroundJobs, () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs a job without overlapping and schedules after completion', async () => {
    vi.useFakeTimers()
    let pending = Promise.withResolvers<boolean>()
    const run = vi.fn<() => Promise<void>>(async () => {
      pending = Promise.withResolvers<boolean>()
      await pending.promise
    })
    const jobs = new BackgroundJobs(leaderLock(), logger(), [
      {
        intervalMs: 1000,
        leaderKey: 'job:leader',
        name: 'job',
        run,
      },
    ])

    await jobs.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(5000)
    expect(run).toHaveBeenCalledOnce()
    pending.resolve(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(2)
    pending.resolve(true)
    await jobs.stop()
  })

  it('does not run without leadership', async () => {
    vi.useFakeTimers()
    const run = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const jobs = new BackgroundJobs(leaderLock(false), logger(), [
      {
        intervalMs: 1000,
        leaderKey: 'job:leader',
        name: 'job',
        run,
      },
    ])

    await jobs.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(run).not.toHaveBeenCalled()
    expect(jobs.getStatuses()[0]).toMatchObject({
      leader: false,
      running: false,
    })
    await jobs.stop()
  })

  it('tracks success and error status', async () => {
    vi.useFakeTimers()
    const run = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('failed'))
    const jobs = new BackgroundJobs(leaderLock(), logger(), [
      {
        intervalMs: 10,
        leaderKey: 'job:leader',
        name: 'job',
        run,
      },
    ])

    await jobs.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(jobs.getStatuses()[0]).toMatchObject({
      lastError: null,
      leader: true,
      running: false,
    })
    expect(jobs.getStatuses()[0]?.lastSuccessAt).not.toBeNull()

    await vi.advanceTimersByTimeAsync(10)
    expect(jobs.getStatuses()[0]).toMatchObject({
      lastError: 'failed',
      leader: true,
      running: false,
    })
    await jobs.stop()
  })
})
