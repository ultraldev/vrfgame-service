import * as z from 'zod'

import { BET_LIMIT_KEYS } from './util'

const Amount = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^\d+(?:\.\d+)?$/u)
  .nullable()

const ExclusionType = z.enum(['self_exclusion', 'cooling_off'])

export const CreateExclusion = z.discriminatedUnion('type', [
  z.object({
    durationDays: z.number().int().min(1).max(365).optional(),
    type: z.literal('self_exclusion'),
  }),
  z.object({
    durationHours: z.number().int().min(1).max(168),
    type: z.literal('cooling_off'),
  }),
])

export type CreateExclusionInput = z.infer<typeof CreateExclusion>

export const UpdateLimits = z
  .object({
    currency: z.string().trim().min(1).max(16),
    dailyBetCap: Amount.optional(),
    dailyLossCap: Amount.optional(),
    singleBetCap: Amount.optional(),
    weeklyBetCap: Amount.optional(),
    weeklyLossCap: Amount.optional(),
  })
  .refine((input) => BET_LIMIT_KEYS.some((key) => input[key] !== undefined), {
    message: 'At least one limit is required',
  })

export type UpdateLimitsInput = z.infer<typeof UpdateLimits>

export const RiskExclusion = z.object({
  expiresAt: z.iso.datetime().nullable(),
  id: z.string(),
  startsAt: z.iso.datetime(),
  type: ExclusionType,
})

export const RiskExclusionList = z.object({
  items: z.array(RiskExclusion),
})

const Limits = z.object({
  dailyBetCap: z.string().nullable(),
  dailyLossCap: z.string().nullable(),
  singleBetCap: z.string().nullable(),
  weeklyBetCap: z.string().nullable(),
  weeklyLossCap: z.string().nullable(),
})

export const UserRiskLimits = z.object({
  currency: z.string(),
  limits: Limits,
  updatedAt: z.iso.datetime(),
})

export const RiskLimitList = z.object({
  items: z.array(UserRiskLimits),
})

z.globalRegistry.add(RiskExclusion, { id: 'RiskExclusion' })
z.globalRegistry.add(RiskExclusionList, { id: 'RiskExclusionList' })
z.globalRegistry.add(Limits, { id: 'RiskLimits' })
z.globalRegistry.add(UserRiskLimits, { id: 'UserRiskLimits' })
z.globalRegistry.add(RiskLimitList, { id: 'RiskLimitList' })
