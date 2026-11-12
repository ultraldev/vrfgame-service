import { randomUUID } from 'node:crypto'

import { LogController } from 'fastify'
import type { FastifyServerOptions } from 'fastify'

import type { AppConfig } from '@/lib/config'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u

export function createFastifyOptions(
  config: AppConfig,
  overrides: FastifyServerOptions = {},
) {
  const logger =
    overrides.logger ??
    (config.NODE_ENV === 'development'
      ? {
          level: config.LOG_LEVEL,
          transport: {
            options: {
              colorize: true,
              ignore:
                'pid,hostname,reqId,requestId,method,url,statusCode,durationMs,userId,host,port,signal',
              singleLine: true,
              translateTime: 'SYS:HH:MM:ss',
            },
            target: 'pino-pretty',
          },
        }
      : { level: config.LOG_LEVEL })

  return {
    bodyLimit: 2 * 1024 * 1024,
    genReqId: (req: { headers: Record<string, unknown> }) => {
      const requestId = req.headers['x-request-id']
      return typeof requestId === 'string' && REQUEST_ID_PATTERN.test(requestId)
        ? requestId
        : randomUUID()
    },
    logController: new LogController({
      disableRequestLogging: true,
    }),
    logger,
    trustProxy: true,
    ...overrides,
  }
}
