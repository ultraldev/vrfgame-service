import { readFile } from 'node:fs/promises'

import { build } from '@test/helper'
import type { OpenAPIV3 } from 'openapi-types'
import { describe, expect, it } from 'vitest'

import { openapi } from '@/lib/openapi'

describe(openapi, () => {
  it('includes service paths', async () => {
    const app = await build()
    const document = app.swagger() as OpenAPIV3.Document

    expect(document.info).toStrictEqual({
      description: 'VRF Game API contract',
      title: 'VRF Game Service',
      version: '1.0.0',
    })
    expect(Object.keys(document.paths ?? {})).toStrictEqual(
      expect.arrayContaining([
        '/healthz',
        '/readyz',
        '/api/v1/lobby',
        '/api/v1/lobby/games',
        '/api/v1/lobby/raffle',
        '/api/v1/ranking',
        '/api/v1/ranking/me',
        '/api/v1/wallet/balance',
        '/api/v1/wallet/balances',
        '/api/v1/wallet/transactions',
      ]),
    )
  })

  it('does not expose unversioned business paths', async () => {
    const app = await build()
    const document = app.swagger() as OpenAPIV3.Document

    expect(document.paths).not.toHaveProperty('/api/lobby')
    expect(document.paths).not.toHaveProperty('/api/ranking')
    expect(document.paths).not.toHaveProperty('/api/wallet/balance')
  })

  it('omits documentation routes and exports failure schema', async () => {
    const app = await build()
    const document = app.swagger() as OpenAPIV3.Document

    expect(document.paths).not.toHaveProperty('/docs')
    expect(document.paths).not.toHaveProperty('/docs-json')
    expect(document.paths).toHaveProperty('/api/v1/lobby/crates')
    expect(document.components?.schemas).toHaveProperty('Failure')
  })

  it('matches the generated contract snapshot', async () => {
    const app = await build()
    const saved = JSON.parse(
      await readFile(new URL('../openapi.json', import.meta.url), 'utf-8'),
    )

    expect(openapi(app)).toStrictEqual(saved)
  })

  it('exports only reachable named components', async () => {
    const app = await build()
    const document = openapi(app)
    const names = Object.keys(document.components?.schemas ?? {})

    expect(names).toStrictEqual(
      expect.arrayContaining([
        'Failure',
        'RankingBoard',
        'RankingEntry',
        'WalletBalance',
        'WalletTransaction',
        'WalletTransactions',
        'LobbyResponse',
      ]),
    )
    expect(names.some((name) => name.endsWith('Input'))).toBeFalsy()
  })
})
