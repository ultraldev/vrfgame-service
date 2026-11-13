import type Redis from 'ioredis'

export interface LeaderLock {
  acquire: (key: string, owner: string, ttlSeconds: number) => Promise<boolean>
  release: (key: string, owner: string) => Promise<void>
  renew: (key: string, owner: string, ttlSeconds: number) => Promise<boolean>
}

export function redisLeaderLock(
  redis: Pick<Redis, 'eval' | 'set'>,
): LeaderLock {
  return {
    acquire: async (key, owner, ttlSeconds) => {
      const result = await redis.set(key, owner, 'EX', ttlSeconds, 'NX')
      return result === 'OK'
    },
    release: async (key, owner) => {
      await redis.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        key,
        owner,
      )
    },
    renew: async (key, owner, ttlSeconds) => {
      const result = await redis.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], ARGV[2]) else return 0 end`,
        1,
        key,
        owner,
        ttlSeconds,
      )
      return result === 1
    },
  }
}
