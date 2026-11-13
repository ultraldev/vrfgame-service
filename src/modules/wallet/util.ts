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

export const WALLET_REFERENCES = {
  adminAdjust: 'admin_adjust',
  caseBattleBet: 'case_battle_bet',
  caseBattleBotBet: 'case_battle_bot_bet',
  caseBattleBotPayout: 'case_battle_bot_payout',
  caseBattleBotRefund: 'case_battle_bot_refund',
  caseBattlePayout: 'case_battle_payout',
  caseBattleRefund: 'case_battle_refund',
  caseBet: 'case_bet',
  casePayout: 'case_payout',
  crashBet: 'crash_bet',
  crashLoss: 'crash_loss',
  crashPayout: 'crash_payout',
  crashRefund: 'crash_refund',
  deposit: 'deposit',
  depositRefund: 'deposit_refund',
  diceBet: 'dice_bet',
  dicePayout: 'dice_payout',
  expense: 'expense',
  hiloBet: 'hilo_bet',
  hiloPayout: 'hilo_payout',
  minesBet: 'mines_bet',
  minesPayout: 'mines_payout',
  newUserCashback: 'new_user_cashback',
  newUserDepositBonus: 'new_user_deposit_bonus',
  newUserLeaderboardBonus: 'new_user_leaderboard_bonus',
  plinkoBet: 'plinko_bet',
  plinkoPayout: 'plinko_payout',
  raffleEntry: 'raffle_entry',
  rafflePrize: 'raffle_prize',
  raffleRefund: 'raffle_refund',
  raffleTicketPurchase: 'raffle_ticket_purchase',
  rankingReward: 'ranking_reward',
  wageringBonusClaim: 'wagering_bonus_claim',
  walletLock: 'wallet_lock',
  walletUnlock: 'wallet_unlock',
  wheelBet: 'wheel_bet',
  wheelPayout: 'wheel_payout',
  withdraw: 'withdraw',
  withdrawLock: 'withdraw_lock',
  withdrawUnlock: 'withdraw_unlock',
} as const

export type WalletReferenceType =
  (typeof WALLET_REFERENCES)[keyof typeof WALLET_REFERENCES]

const EVENT_REFERENCE_TYPES = {
  adjustment: [WALLET_REFERENCES.adminAdjust, WALLET_REFERENCES.expense],
  bet: [
    WALLET_REFERENCES.diceBet,
    WALLET_REFERENCES.crashBet,
    WALLET_REFERENCES.crashLoss,
    WALLET_REFERENCES.minesBet,
    WALLET_REFERENCES.hiloBet,
    WALLET_REFERENCES.plinkoBet,
    WALLET_REFERENCES.wheelBet,
    WALLET_REFERENCES.caseBet,
    WALLET_REFERENCES.caseBattleBet,
    WALLET_REFERENCES.caseBattleBotBet,
    WALLET_REFERENCES.raffleEntry,
  ],
  bonus: [
    WALLET_REFERENCES.wageringBonusClaim,
    WALLET_REFERENCES.newUserDepositBonus,
    WALLET_REFERENCES.newUserCashback,
    WALLET_REFERENCES.newUserLeaderboardBonus,
  ],
  deposit: [WALLET_REFERENCES.deposit],
  payout: [
    WALLET_REFERENCES.dicePayout,
    WALLET_REFERENCES.crashPayout,
    WALLET_REFERENCES.minesPayout,
    WALLET_REFERENCES.hiloPayout,
    WALLET_REFERENCES.plinkoPayout,
    WALLET_REFERENCES.wheelPayout,
    WALLET_REFERENCES.casePayout,
    WALLET_REFERENCES.caseBattlePayout,
    WALLET_REFERENCES.caseBattleBotPayout,
  ],
  purchase: [WALLET_REFERENCES.raffleTicketPurchase],
  refund: [
    WALLET_REFERENCES.crashRefund,
    WALLET_REFERENCES.depositRefund,
    WALLET_REFERENCES.withdrawUnlock,
    WALLET_REFERENCES.caseBattleRefund,
    WALLET_REFERENCES.caseBattleBotRefund,
    WALLET_REFERENCES.raffleRefund,
  ],
  reward: [WALLET_REFERENCES.rankingReward, WALLET_REFERENCES.rafflePrize],
  withdrawal: [WALLET_REFERENCES.withdraw, WALLET_REFERENCES.withdrawLock],
} as const satisfies Record<TransactionEventType, readonly string[]>

export const HIDDEN_REFERENCE_TYPES = [
  WALLET_REFERENCES.walletLock,
  WALLET_REFERENCES.walletUnlock,
] as const

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
