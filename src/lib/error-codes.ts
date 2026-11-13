export const PUBLIC_ERROR_CODES = [
  'user_banned',
  'virtual_account_expired',
  'self_excluded',
  'cooling_off',
  'single_bet_cap',
  'daily_bet_cap',
  'weekly_bet_cap',
  'daily_loss_cap',
  'weekly_loss_cap',
  'withdraw_wagering',
] as const

export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number]

export const PUBLIC_ERROR_CODE_SET = new Set<string>(PUBLIC_ERROR_CODES)
