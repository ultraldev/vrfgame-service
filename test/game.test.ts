import { build } from '@test/helper'
import { describe, expect, it, vi } from 'vitest'

import { GameListQuery } from '@/modules/game/schema'
import {
  decodeGameCursor,
  encodeGameCursor,
  gameCoverUrl,
} from '@/modules/game/util'

describe('game catalog helpers', () => {
  it('parses list filters and defaults', () => {
    expect(GameListQuery.parse({})).toStrictEqual({
      limit: 24,
      sort: 'default',
    })
    expect(
      GameListQuery.parse({
        cursor: 'cursor',
        isFeatured: 'false',
        isHot: 'true',
        isNew: 'false',
        limit: '50',
        search: 'dice',
        sort: 'newest',
      }),
    ).toStrictEqual({
      cursor: 'cursor',
      isFeatured: false,
      isHot: true,
      isNew: false,
      limit: 50,
      search: 'dice',
      sort: 'newest',
    })
  })

  it('round-trips a sort-specific cursor', () => {
    const cursor = encodeGameCursor(
      {
        createdAt: new Date('2026-11-13T00:00:00.000Z'),
        slug: 'dice',
        sortOrder: 2,
      },
      'newest',
    )

    expect(decodeGameCursor(cursor, 'newest')).toStrictEqual({
      createdAt: new Date('2026-11-13T00:00:00.000Z'),
      slug: 'dice',
      sort: 'newest',
      sortOrder: 2,
    })
    expect(() => decodeGameCursor(cursor, 'default')).toThrow('Invalid cursor')
  })

  it('rejects malformed cursors', () => {
    expect(() => decodeGameCursor('not%a%cursor', 'default')).toThrow(
      'Invalid cursor',
    )
  })

  it('picks game cover assets in display order', () => {
    expect(
      gameCoverUrl([
        { locale: 'en', type: 'banner', url: 'banner' },
        { locale: 'en', type: 'thumbnail', url: 'thumbnail' },
        { locale: 'en', type: 'icon', url: 'icon' },
      ]),
    ).toBe('thumbnail')
    expect(
      gameCoverUrl([
        { locale: 'pt-BR', sortOrder: 1, type: 'thumbnail', url: 'pt' },
        { locale: 'en', sortOrder: 0, type: 'thumbnail', url: 'en' },
      ]),
    ).toBe('en')
  })
})

describe('game routes', () => {
  it('validates list filters before resolving the catalog', async () => {
    const app = await build()

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/games?limit=101',
    })

    expect(response.statusCode).toBe(400)
  })

  it('guards player-specific game endpoints', async () => {
    const app = await build()
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(null)

    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/api/v1/games/favorites' }),
      app.inject({ method: 'GET', url: '/api/v1/games/recent' }),
      app.inject({ method: 'PUT', url: '/api/v1/games/dice/favorite' }),
      app.inject({ method: 'DELETE', url: '/api/v1/games/dice/favorite' }),
      app.inject({ method: 'POST', url: '/api/v1/games/dice/plays' }),
    ])

    expect(responses.map((response) => response.statusCode)).toStrictEqual([
      401, 401, 401, 401, 401,
    ])
  })

  it('validates game slugs before resolving a game', async () => {
    const app = await build()

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/games/Not%20A%20Slug',
    })

    expect(response.statusCode).toBe(400)
  })
})
