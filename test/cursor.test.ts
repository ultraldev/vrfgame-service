import { describe, expect, it } from 'vitest'

import { decodeCursor, encodeCursor } from '@/lib/cursor'

function token(payload: unknown) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

describe('cursor helpers', () => {
  it('round-trips opaque keyset cursors', () => {
    const cursor = {
      createdAt: '2026-11-11T10:20:30.000Z',
      id: 'transaction-1',
    }

    expect(decodeCursor(encodeCursor(cursor))).toStrictEqual(cursor)
  })

  it('rejects malformed cursor payloads', () => {
    expect(() => decodeCursor('invalid')).toThrow('Invalid cursor')
    expect(() =>
      decodeCursor(token({ createdAt: 'invalid', id: '', version: 1 })),
    ).toThrow('Invalid cursor')
    expect(() =>
      decodeCursor(
        token({
          createdAt: '2026-11-11T10:20:30.000Z',
          id: 'transaction-1',
          version: 2,
        }),
      ),
    ).toThrow('Invalid cursor')
    expect(() =>
      decodeCursor(
        token({
          createdAt: '2026-11-11T10:20:30.000Z',
          extra: true,
          id: 'transaction-1',
          version: 1,
        }),
      ),
    ).toThrow('Invalid cursor')
  })

  it('rejects invalid cursor encodings', () => {
    expect(() => decodeCursor('not base64!')).toThrow('Invalid cursor')
    expect(() => decodeCursor('a'.repeat(513))).toThrow('Invalid cursor')
  })
})
