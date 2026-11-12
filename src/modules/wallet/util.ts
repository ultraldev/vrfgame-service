export const TRANSACTION_DIRECTIONS = ['credit', 'debit'] as const
export type TransactionDirection = (typeof TRANSACTION_DIRECTIONS)[number]

export const TRANSACTION_EVENT_TYPES = [
  'deposit',
  'withdrawal',
  'bet',
  'payout',
  'refund',
  'bonus',
  'reward',
  'purchase',
  'adjustment',
] as const
export type TransactionEventType = (typeof TRANSACTION_EVENT_TYPES)[number]
export type TransactionType = TransactionEventType | 'other'

export const TRANSACTION_TYPES = [...TRANSACTION_EVENT_TYPES, 'other'] as const

const EVENT_REFERENCE_TYPES = {
  adjustment: ['admin_adjust', 'expense'],
  bet: [
    'dice_bet',
    'crash_bet',
    'crash_loss',
    'mines_bet',
    'hilo_bet',
    'plinko_bet',
    'wheel_bet',
    'wingo_bet',
    'wingo_loss',
    'case_bet',
    'case_battle_bet',
    'case_battle_bot_bet',
  ],
  bonus: [
    'wagering_bonus_claim',
    'new_user_deposit_bonus',
    'new_user_cashback',
    'new_user_leaderboard_bonus',
  ],
  deposit: ['deposit'],
  payout: [
    'dice_payout',
    'crash_payout',
    'mines_payout',
    'hilo_payout',
    'plinko_payout',
    'wheel_payout',
    'wingo_payout',
    'case_payout',
    'case_battle_payout',
    'case_battle_bot_payout',
  ],
  purchase: ['raffle_ticket_purchase'],
  refund: [
    'deposit_refund',
    'withdraw_unlock',
    'case_battle_refund',
    'case_battle_bot_refund',
  ],
  reward: ['leaderboard_reward', 'raffle_prize'],
  withdrawal: ['withdraw', 'withdraw_lock'],
} as const satisfies Record<TransactionEventType, readonly string[]>

export const HIDDEN_REFERENCE_TYPES = ['wallet_lock', 'wallet_unlock'] as const

export const KNOWN_REFERENCE_TYPES = Object.values(EVENT_REFERENCE_TYPES).flat()

export function referenceTypesFor(type: TransactionType) {
  if (type === 'other') {
    return null
  }
  return EVENT_REFERENCE_TYPES[type]
}

export function transactionType(referenceType: string): TransactionType {
  for (const type of TRANSACTION_EVENT_TYPES) {
    const references: readonly string[] = EVENT_REFERENCE_TYPES[type]
    if (references.includes(referenceType)) {
      return type
    }
  }
  return 'other'
}

export function transactionDirection(type: string): TransactionDirection {
  return type === 'credit' || type === 'unlock' || type === 'settle'
    ? 'credit'
    : 'debit'
}

export function ledgerTypesForDirection(direction: TransactionDirection) {
  return direction === 'credit'
    ? (['credit', 'unlock', 'settle'] as const)
    : (['debit', 'lock'] as const)
}
