import { describe, expect, it } from 'vitest'

import { applyLedgerMutation } from '@/modules/wallet/ledger'

const wallet = {
  balance: 10_000n,
  lockedBalance: 2000n,
  version: 7,
}

describe('wallet ledger mutations', () => {
  it('debits available balance without changing locked balance', () => {
    expect(
      applyLedgerMutation(wallet, { amount: 2500n, type: 'debit' }),
    ).toStrictEqual({
      balance: 7500n,
      lockedBalance: 2000n,
      transactionAmount: 2500n,
      type: 'debit',
      version: 8,
    })
  })

  it('credits available balance without changing locked balance', () => {
    expect(
      applyLedgerMutation(wallet, { amount: 2500n, type: 'credit' }),
    ).toStrictEqual({
      balance: 12_500n,
      lockedBalance: 2000n,
      transactionAmount: 2500n,
      type: 'credit',
      version: 8,
    })
  })

  it('moves funds from available to locked balance', () => {
    expect(
      applyLedgerMutation(wallet, { amount: 2500n, type: 'lock' }),
    ).toStrictEqual({
      balance: 7500n,
      lockedBalance: 4500n,
      transactionAmount: 2500n,
      type: 'lock',
      version: 8,
    })
  })

  it('moves funds from locked back to available balance', () => {
    expect(
      applyLedgerMutation(wallet, { amount: 1500n, type: 'unlock' }),
    ).toStrictEqual({
      balance: 11_500n,
      lockedBalance: 500n,
      transactionAmount: 1500n,
      type: 'unlock',
      version: 8,
    })
  })

  it('settles locked funds and records only the payout as the ledger amount', () => {
    expect(
      applyLedgerMutation(wallet, {
        lockedAmount: 1500n,
        payout: 3250n,
        type: 'settle',
      }),
    ).toStrictEqual({
      balance: 13_250n,
      lockedBalance: 500n,
      transactionAmount: 3250n,
      type: 'settle',
      version: 8,
    })
  })

  it('allows a losing settlement with zero payout', () => {
    expect(
      applyLedgerMutation(wallet, {
        lockedAmount: 1500n,
        payout: 0n,
        type: 'settle',
      }),
    ).toStrictEqual({
      balance: 10_000n,
      lockedBalance: 500n,
      transactionAmount: 0n,
      type: 'settle',
      version: 8,
    })
  })

  it('allows a refund chargeback to leave the wallet in debt', () => {
    expect(
      applyLedgerMutation(wallet, { amount: 12_500n, type: 'chargeback' }),
    ).toStrictEqual({
      balance: -2500n,
      lockedBalance: 2000n,
      transactionAmount: 12_500n,
      type: 'debit',
      version: 8,
    })
  })

  it('rejects non-positive mutation amounts', () => {
    expect(() =>
      applyLedgerMutation(wallet, { amount: 0n, type: 'credit' }),
    ).toThrow('Amount must be positive')
    expect(() =>
      applyLedgerMutation(wallet, { amount: -1n, type: 'debit' }),
    ).toThrow('Amount must be positive')
  })

  it('rejects invalid settlement amounts', () => {
    expect(() =>
      applyLedgerMutation(wallet, {
        lockedAmount: 0n,
        payout: 0n,
        type: 'settle',
      }),
    ).toThrow('Locked amount must be positive')
    expect(() =>
      applyLedgerMutation(wallet, {
        lockedAmount: 1000n,
        payout: -1n,
        type: 'settle',
      }),
    ).toThrow('Payout must not be negative')
  })

  it('rejects debits and locks above the available balance', () => {
    expect(() =>
      applyLedgerMutation(wallet, { amount: 10_001n, type: 'debit' }),
    ).toThrow('Insufficient balance')
    expect(() =>
      applyLedgerMutation(wallet, { amount: 10_001n, type: 'lock' }),
    ).toThrow('Insufficient balance')
  })

  it('rejects unlocks and settlements above the locked balance', () => {
    expect(() =>
      applyLedgerMutation(wallet, { amount: 2001n, type: 'unlock' }),
    ).toThrow('Insufficient locked balance')
    expect(() =>
      applyLedgerMutation(wallet, {
        lockedAmount: 2001n,
        payout: 0n,
        type: 'settle',
      }),
    ).toThrow('Insufficient locked balance')
  })
})
