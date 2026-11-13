import { describe, expect, it } from 'vitest'

import { TransactionsQuery } from '@/modules/wallet/schema'
import {
  HIDDEN_REFERENCE_TYPES,
  ledgerTypesForDirection,
  referenceTypesFor,
  transactionDirection,
  transactionType,
} from '@/modules/wallet/util'

describe('wallet transaction helpers', () => {
  it('maps ledger references to public transaction types', () => {
    expect({
      adjustment: transactionType('admin_adjust'),
      bet: transactionType('dice_bet'),
      bonus: transactionType('new_user_cashback'),
      crashRefund: transactionType('crash_refund'),
      deposit: transactionType('deposit'),
      other: transactionType('unknown_reference'),
      payout: transactionType('crash_payout'),
      purchase: transactionType('raffle_ticket_purchase'),
      refund: transactionType('withdraw_unlock'),
      reward: transactionType('ranking_reward'),
      withdrawal: transactionType('withdraw_lock'),
    }).toStrictEqual({
      adjustment: 'adjustment',
      bet: 'bet',
      bonus: 'bonus',
      crashRefund: 'refund',
      deposit: 'deposit',
      other: 'other',
      payout: 'payout',
      purchase: 'purchase',
      refund: 'refund',
      reward: 'reward',
      withdrawal: 'withdrawal',
    })
  })

  it('maps ledger types to player-facing directions', () => {
    expect({
      credit: transactionDirection('credit'),
      creditTypes: ledgerTypesForDirection('credit'),
      debit: transactionDirection('debit'),
      debitTypes: ledgerTypesForDirection('debit'),
      lock: transactionDirection('lock'),
      settle: transactionDirection('settle'),
      unlock: transactionDirection('unlock'),
    }).toStrictEqual({
      credit: 'credit',
      creditTypes: ['credit', 'unlock', 'settle'],
      debit: 'debit',
      debitTypes: ['debit', 'lock'],
      lock: 'debit',
      settle: 'credit',
      unlock: 'credit',
    })
  })

  it('keeps internal bookkeeping references out of the player ledger', () => {
    expect(HIDDEN_REFERENCE_TYPES).toStrictEqual([
      'wallet_lock',
      'wallet_unlock',
    ])
    expect(referenceTypesFor('bet')).toContain('dice_bet')
    expect(referenceTypesFor('other')).toBeNull()
  })

  it('validates transaction filters and defaults', () => {
    const query = TransactionsQuery.parse({
      cursor: 'cursor',
      direction: 'credit',
      from: '2026-11-01T00:00:00Z',
      limit: '50',
      to: '2026-11-11T00:00:00Z',
      type: 'deposit',
    })

    expect(query).toStrictEqual({
      cursor: 'cursor',
      direction: 'credit',
      from: '2026-11-01T00:00:00Z',
      limit: 50,
      to: '2026-11-11T00:00:00Z',
      type: 'deposit',
    })
    expect(TransactionsQuery.parse({}).limit).toBe(20)
    expect(() => TransactionsQuery.parse({ limit: 101 })).toThrow('Too big')
    expect(() =>
      TransactionsQuery.parse({
        from: '2026-11-11T00:00:00Z',
        to: '2026-11-01T00:00:00Z',
      }),
    ).toThrow('`to` must be after `from`')
  })
})

describe('wallet routes', () => {
  it('guards the wagering summary endpoint', async () => {
    const { build } = await import('@test/helper')
    const { vi } = await import('vitest')
    const app = await build()
    vi.spyOn(app.auth.api, 'getSession').mockResolvedValue(null)
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/wallet/wagering?currency=USD',
    })
    expect(response.statusCode).toBe(401)
  })
})
