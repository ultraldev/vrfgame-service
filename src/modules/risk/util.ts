import { PUBLIC_ERROR_CODE_SET } from '@/lib/error-codes'

export const RISK_RULE_CODES = [
  'self_excluded',
  'cooling_off',
  'single_bet_cap',
  'daily_bet_cap',
  'weekly_bet_cap',
  'daily_loss_cap',
  'weekly_loss_cap',
  'withdraw_wagering',
] as const

export type RiskRuleCode = (typeof RISK_RULE_CODES)[number]

export const BET_LIMIT_KEYS = [
  'singleBetCap',
  'dailyBetCap',
  'weeklyBetCap',
  'dailyLossCap',
  'weeklyLossCap',
] as const

export type BetLimitKey = (typeof BET_LIMIT_KEYS)[number]

export function riskRejected(code: RiskRuleCode, message: string) {
  return Object.assign(new Error(message), { code, statusCode: 403 })
}

export function isRiskRejection(
  error: unknown,
): error is Error & { code: RiskRuleCode; statusCode: 403 } {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    PUBLIC_ERROR_CODE_SET.has(error.code) &&
    'statusCode' in error &&
    error.statusCode === 403
  )
}

export function dayBucket(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function weekBucket(date: Date) {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )
  const day = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  const week = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  )
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
