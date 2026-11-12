import * as z from 'zod'

const CURSOR_MAX_LENGTH = 512
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/u

const CursorPayload = z.strictObject({
  createdAt: z.iso.datetime(),
  id: z.string().min(1).max(256),
  version: z.literal(1),
})

export interface KeysetCursor {
  createdAt: string
  id: string
}

function invalidCursor() {
  return Object.assign(new Error('Invalid cursor'), {
    statusCode: 400,
  })
}

export function encodeCursor(cursor: KeysetCursor) {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt,
      id: cursor.id,
      version: 1,
    }),
  ).toString('base64url')
}

export function decodeCursor(value: string) {
  if (value.length > CURSOR_MAX_LENGTH || !CURSOR_PATTERN.test(value)) {
    throw invalidCursor()
  }

  let payload: unknown

  try {
    payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf-8'))
  } catch {
    throw invalidCursor()
  }

  const parsed = CursorPayload.safeParse(payload)
  if (!parsed.success) {
    throw invalidCursor()
  }

  return {
    createdAt: new Date(parsed.data.createdAt).toISOString(),
    id: parsed.data.id,
  }
}
