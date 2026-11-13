import { and, eq, gt, lt, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import * as z from 'zod'

import * as schema from '@/db/schema'

const CURSOR_MAX_LENGTH = 512
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/u
const COVER_TYPES = ['thumbnail', 'icon', 'banner'] as const

export const GAME_CATEGORIES = [
  'slots',
  'live_casino',
  'table',
  'inhouse',
  'fishing',
  'arcade',
  'lottery',
] as const

export const GAME_SORTS = [
  'default',
  'newest',
  'name_asc',
  'name_desc',
] as const

export type GameSort = (typeof GAME_SORTS)[number]

export interface GameCursor {
  createdAt: Date
  slug: string
  sort: GameSort
  sortOrder: number
}

interface GameCursorRow {
  createdAt: Date
  slug: string
  sortOrder: number | null
}

const GameCursorPayload = z.strictObject({
  createdAt: z.iso.datetime(),
  slug: z.string().min(1).max(256),
  sort: z.enum(GAME_SORTS),
  sortOrder: z.number().int(),
  version: z.literal(1),
})

function invalidCursor() {
  return Object.assign(new Error('Invalid cursor'), {
    statusCode: 400,
  })
}

export function encodeGameCursor(row: GameCursorRow, sort: GameSort) {
  return Buffer.from(
    JSON.stringify({
      createdAt: row.createdAt.toISOString(),
      slug: row.slug,
      sort,
      sortOrder: row.sortOrder ?? 0,
      version: 1,
    }),
  ).toString('base64url')
}

export function decodeGameCursor(value: string, sort: GameSort) {
  if (value.length > CURSOR_MAX_LENGTH || !CURSOR_PATTERN.test(value)) {
    throw invalidCursor()
  }

  let payload: unknown

  try {
    payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf-8'))
  } catch {
    throw invalidCursor()
  }

  const parsed = GameCursorPayload.safeParse(payload)
  if (!parsed.success || parsed.data.sort !== sort) {
    throw invalidCursor()
  }

  return {
    createdAt: new Date(parsed.data.createdAt),
    slug: parsed.data.slug,
    sort: parsed.data.sort,
    sortOrder: parsed.data.sortOrder,
  } satisfies GameCursor
}

export function gamesAfterCursor(sort: GameSort, cursor: GameCursor): SQL {
  switch (sort) {
    case 'newest': {
      const condition = or(
        lt(schema.game.createdAt, cursor.createdAt),
        and(
          eq(schema.game.createdAt, cursor.createdAt),
          lt(schema.game.slug, cursor.slug),
        ),
      )
      if (!condition) {
        throw new Error('Failed to build game cursor condition')
      }
      return condition
    }
    case 'name_asc': {
      return gt(schema.game.slug, cursor.slug)
    }
    case 'name_desc': {
      return lt(schema.game.slug, cursor.slug)
    }
    default: {
      const condition = or(
        gt(schema.game.sortOrder, cursor.sortOrder),
        and(
          eq(schema.game.sortOrder, cursor.sortOrder),
          gt(schema.game.slug, cursor.slug),
        ),
      )
      if (!condition) {
        throw new Error('Failed to build game cursor condition')
      }
      return condition
    }
  }
}

export function gameCoverUrl(
  assets: {
    locale: string
    sortOrder?: number | null
    type: string
    url: string
  }[],
) {
  for (const type of COVER_TYPES) {
    const matches = assets
      .filter((asset) => asset.type === type)
      .toSorted((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    const match = matches.find((asset) => asset.locale === 'en') ?? matches[0]
    if (match) {
      return match.url
    }
  }

  return null
}

export function formatMultiplierCenti(multiplierCenti: number) {
  return (multiplierCenti / 100).toFixed(2)
}

export function formatMultiplierBps(multiplierBps: number) {
  const text = (multiplierBps / 10_000).toFixed(4).replace(/0+$/u, '')
  const [whole = '0', fraction = ''] = text.split('.')
  return `${whole}.${fraction.padEnd(2, '0')}`
}

export function multiplierDetails(
  amount: bigint,
  payout: bigint,
  theoreticalMultiplierCenti: number,
) {
  const effectiveMultiplierCenti =
    amount > 0n ? Number((payout * 100n) / amount) : 0
  const theoreticalPayout = (amount * BigInt(theoreticalMultiplierCenti)) / 100n

  return {
    effectiveMultiplier: formatMultiplierCenti(effectiveMultiplierCenti),
    multiplier: formatMultiplierCenti(theoreticalMultiplierCenti),
    payoutCapped: payout < theoreticalPayout,
    theoreticalMultiplier: formatMultiplierCenti(theoreticalMultiplierCenti),
  }
}
