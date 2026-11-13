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
        '/api/v1/games',
        '/api/v1/games/dice/bets',
        '/api/v1/games/dice/bets/{betId}/verify',
        '/api/v1/games/dice/seeds/active',
        '/api/v1/games/dice/seeds/rotate',
        '/api/v1/games/crash/bets',
        '/api/v1/games/crash/bets/cancel',
        '/api/v1/games/crash/bets/{betId}/cashout',
        '/api/v1/games/crash/rounds/active',
        '/api/v1/games/crash/rounds/recent',
        '/api/v1/games/crash/rounds/{roundId}/verify',
        '/api/v1/games/hilo/bets',
        '/api/v1/games/hilo/bets/active',
        '/api/v1/games/hilo/bets/{betId}/cashout',
        '/api/v1/games/hilo/bets/{betId}/guesses',
        '/api/v1/games/hilo/bets/{betId}/skips',
        '/api/v1/games/hilo/bets/{betId}/verify',
        '/api/v1/games/hilo/seeds/active',
        '/api/v1/games/hilo/seeds/rotate',
        '/api/v1/games/mines/bets',
        '/api/v1/games/mines/bets/active',
        '/api/v1/games/mines/bets/{betId}/cashout',
        '/api/v1/games/mines/bets/{betId}/reveals',
        '/api/v1/games/mines/bets/{betId}/verify',
        '/api/v1/games/mines/seeds/active',
        '/api/v1/games/mines/seeds/rotate',
        '/api/v1/games/plinko/bets',
        '/api/v1/games/plinko/bets/{betId}/verify',
        '/api/v1/games/plinko/seeds/active',
        '/api/v1/games/plinko/seeds/rotate',
        '/api/v1/games/wheel/bets',
        '/api/v1/games/wheel/bets/{betId}/verify',
        '/api/v1/games/wheel/seeds/active',
        '/api/v1/games/wheel/seeds/rotate',
        '/api/v1/games/favorites',
        '/api/v1/games/recent',
        '/api/v1/games/{slug}',
        '/api/v1/games/{slug}/favorite',
        '/api/v1/games/{slug}/plays',
        '/api/v1/lobby',
        '/api/v1/lobby/games',
        '/api/v1/lobby/raffle',
        '/api/v1/ranking',
        '/api/v1/ranking/me',
        '/api/v1/ranking/rewards',
        '/api/v1/risk/exclusions',
        '/api/v1/risk/limits',
        '/api/v1/wallet/balance',
        '/api/v1/wallet/balances',
        '/api/v1/wallet/transactions',
        '/api/v1/wallet/wagering',
        '/api/v1/wallet/fiat/options',
        '/api/v1/wallet/fiat/deposits',
        '/api/v1/wallet/fiat/deposits/{orderId}',
        '/api/v1/wallet/fiat/payouts',
        '/api/v1/wallet/fiat/payouts/{orderId}',
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
        'FiatDeposit',
        'FiatOptions',
        'FiatOrder',
        'FiatOrderList',
        'FiatPayout',
        'FiatRouteOption',
        'GameDetail',
        'GameList',
        'GameSummary',
        'DiceActiveSeed',
        'DiceBet',
        'DiceBetList',
        'DiceSeedRotation',
        'DiceVerification',
        'CrashBet',
        'CrashCancel',
        'CrashCashOut',
        'CrashHistory',
        'CrashPublicSnapshot',
        'CrashRecentRound',
        'CrashRoundBet',
        'CrashRoundSnapshot',
        'CrashRoundVerification',
        'HiloActiveSeed',
        'HiloCashOut',
        'HiloGame',
        'HiloGuess',
        'HiloHistory',
        'HiloSeedRotation',
        'HiloVerification',
        'MinesActiveSeed',
        'MinesCashOut',
        'MinesGame',
        'MinesHistory',
        'MinesReveal',
        'MinesSeedRotation',
        'MinesVerification',
        'PlinkoActiveSeed',
        'PlinkoBet',
        'PlinkoBetList',
        'PlinkoSeedRotation',
        'PlinkoVerification',
        'RankingBoard',
        'RankingEntry',
        'RankingReward',
        'RankingRewardList',
        'RiskExclusion',
        'RiskExclusionList',
        'RiskLimitList',
        'RiskLimits',
        'UserRiskLimits',
        'WheelActiveSeed',
        'WheelBet',
        'WheelBetList',
        'WheelSeedRotation',
        'WheelVerification',
        'WalletBalance',
        'WalletTransaction',
        'WalletWagering',
        'WalletTransactions',
        'LobbyResponse',
      ]),
    )
    expect(names.some((name) => name.endsWith('Input'))).toBeFalsy()
  })
})
