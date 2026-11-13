import http from 'node:http'

import { hasZodFastifySchemaValidationErrors } from '@fastify/type-provider-zod'
import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify'
import fp from 'fastify-plugin'

import { PUBLIC_ERROR_CODE_SET } from '@/lib/error-codes'

const databaseErrors: Record<
  string,
  { statusCode: number; message: string; retryAfter?: boolean }
> = {
  '23503': {
    message: 'Operation conflicts with related data',
    statusCode: 409,
  },
  '23505': { message: 'Resource already exists', statusCode: 409 },
  '23514': { message: 'Data violates a database constraint', statusCode: 400 },
  '40001': {
    message: 'Database operation should be retried',
    retryAfter: true,
    statusCode: 503,
  },
  '40P01': {
    message: 'Database operation should be retried',
    retryAfter: true,
    statusCode: 503,
  },
  '55P03': {
    message: 'Database operation should be retried',
    retryAfter: true,
    statusCode: 503,
  },
}

function notFoundHandler(_request: FastifyRequest, reply: FastifyReply) {
  return reply.code(404).send({
    error: 'Not Found',
    message: 'Not Found',
    statusCode: 404,
  })
}

function handleError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (hasZodFastifySchemaValidationErrors(error)) {
    return reply.code(400).send({
      error: 'Bad Request',
      message: 'Request validation failed',
      statusCode: 400,
    })
  }

  let current: unknown = error
  const visited = new Set<unknown>()
  let databaseCode: string | null = null

  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current)
    if ('code' in current && typeof current.code === 'string') {
      databaseCode = current.code
      break
    }
    current = 'cause' in current ? current.cause : null
  }

  const databaseError = databaseCode ? databaseErrors[databaseCode] : undefined

  if (databaseError) {
    if (databaseError.retryAfter) {
      reply.header('Retry-After', '1')
    }
    return reply.code(databaseError.statusCode).send({
      error: http.STATUS_CODES[databaseError.statusCode] ?? 'Error',
      message: databaseError.message,
      statusCode: databaseError.statusCode,
    })
  }

  const statusCode = error.statusCode ?? 500
  const code =
    statusCode < 500 && error.code && PUBLIC_ERROR_CODE_SET.has(error.code)
      ? error.code
      : undefined
  if (statusCode >= 500) {
    request.log.error({ err: error }, 'Request failed')
  }

  return reply.code(statusCode).send({
    ...(code ? { code } : {}),
    error: http.STATUS_CODES[statusCode] ?? 'Error',
    message: statusCode >= 500 ? 'Internal Server Error' : error.message,
    statusCode,
  })
}

function errors(
  fastify: FastifyInstance,
  _options: unknown,
  done: (error?: Error) => void,
) {
  fastify.setNotFoundHandler(notFoundHandler)
  fastify.setErrorHandler(handleError)
  done()
}

export default fp(errors, { name: 'errors' })
