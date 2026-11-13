import { Readable } from 'node:stream'

import type { FastifyRequest } from 'fastify'

import { Failure } from '@/lib/schemas'

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer
  }
}

export const paymentFailures = {
  400: Failure,
  401: Failure,
  403: Failure,
  404: Failure,
  409: Failure,
  500: Failure,
  502: Failure,
  503: Failure,
}

export async function captureRawBody(
  request: FastifyRequest,
  _reply: unknown,
  payload: NodeJS.ReadableStream,
) {
  const chunks: Buffer[] = []
  for await (const chunk of payload) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const rawBody = Buffer.concat(chunks)
  request.rawBody = rawBody
  return Readable.from(rawBody)
}

export function requestHeaders(request: FastifyRequest) {
  const headers: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string' || value === undefined) {
      headers[key.toLowerCase()] = value
    }
  }
  return headers
}
