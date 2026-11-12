import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

function request(
  fastify: FastifyInstance,
  _options: unknown,
  done: (error?: Error) => void,
) {
  fastify.addHook('onSend', (req, reply, payload, next) => {
    reply.header('X-Request-Id', req.id)
    next(null, payload)
  })
  fastify.addHook('onResponse', (req, res, nextHook) => {
    const { statusCode } = res
    const durationMs = Math.round(res.elapsedTime * 100) / 100
    const userId = req.user?.id
    const log = {
      durationMs,
      method: req.method,
      requestId: req.id,
      statusCode,
      url: req.url,
      userId: userId ?? null,
    }
    const requestId = req.id.slice(0, 8)
    const message = `${req.method} ${req.url} ${statusCode} ${durationMs}ms req=${requestId}${userId ? ` user=${userId}` : ''}`

    if (statusCode >= 500) {
      req.log.error(log, message)
    } else if (statusCode >= 400) {
      req.log.warn(log, message)
    } else {
      req.log.info(log, message)
    }
    nextHook()
  })
  done()
}

export default fp(request, { name: 'request' })
