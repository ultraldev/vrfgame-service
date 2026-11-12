import { drizzle } from 'drizzle-orm/node-postgres'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import { Pool } from 'pg'

import type { Db } from '@/db'
import * as schema from '@/db/schema'

interface Options {
  connectionString: string
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Db
    pool: Pool
  }
}

function database(
  fastify: FastifyInstance,
  options: Options,
  done: (error?: Error) => void,
) {
  const pool = new Pool({ connectionString: options.connectionString })

  fastify.decorate('db', drizzle(pool, { schema }))
  fastify.decorate('pool', pool)
  fastify.addHook('onClose', async () => {
    await pool.end()
  })
  done()
}

export default fp(database, { name: 'database' })
