import * as z from 'zod'

export const FiatOptionsQuery = z.object({
  currency: z.string().trim().min(1).max(16).default('USD'),
})

export const FiatBilling = z.object({
  address1: z.string().trim().min(1).max(256).optional(),
  address2: z.string().trim().min(1).max(256).optional(),
  city: z.string().trim().min(1).max(128).optional(),
  country: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/u)
    .optional(),
  email: z.email().optional(),
  firstName: z.string().trim().min(1).max(64).optional(),
  lastName: z.string().trim().min(2).max(64).optional(),
  phone: z.string().trim().min(1).max(32).optional(),
  postalCode: z.string().trim().min(1).max(16).optional(),
  state: z.string().trim().min(1).max(8).optional(),
})

export const FiatDevice = z.object({
  browser: z.string().trim().min(1).max(64).optional(),
  cardInputMethod: z.enum(['typed', 'pasted']).optional(),
  cookie: z.string().trim().min(1).max(1024).optional(),
  language: z.string().trim().min(1).max(16).optional(),
  os: z.string().trim().min(1).max(64).optional(),
  screenResolution: z.string().trim().min(1).max(32).optional(),
  timezone: z.string().trim().min(1).max(16).optional(),
})

export const FiatRecipient = z.object({
  address: z.string().trim().min(1).max(256),
  birthday: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/u)
    .optional(),
  city: z.string().trim().min(1).max(128),
  country: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/u),
  email: z.email(),
  firstName: z.string().trim().min(1).max(64),
  lastName: z.string().trim().min(2).max(64),
  phone: z.string().trim().min(1).max(32),
  postalCode: z.string().trim().min(1).max(16),
  state: z.string().trim().min(1).max(8),
})

export const FiatHeaders = z.object({
  'idempotency-key': z.string().trim().min(1).max(128),
})

export const FiatDepositInput = z.object({
  amount: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^\d+(?:\.\d+)?$/u),
  billing: FiatBilling.optional(),
  currency: z.string().trim().min(1).max(16).default('USD'),
  device: FiatDevice.optional(),
  routeCode: z.string().trim().min(1).max(64),
})

export const FiatPayoutInput = z.object({
  amount: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^\d+(?:\.\d+)?$/u),
  bankCode: z.string().trim().min(1).max(32).optional(),
  currency: z.string().trim().min(1).max(16).default('USD'),
  ext1: z.string().trim().min(1).max(256).optional(),
  ext2: z.string().trim().min(1).max(128).optional(),
  ext3: z.string().trim().min(1).max(128).optional(),
  receiveAccount: z.string().trim().min(1).max(128),
  receiveAccountExpireAt: z
    .string()
    .trim()
    .regex(/^(?:0[1-9]|1[0-2])\/\d{2}(?:\d{2})?$/u)
    .optional(),
  recipient: FiatRecipient.optional(),
  routeCode: z.string().trim().min(1).max(64),
})

export const FiatHistoryQuery = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type FiatHistoryFilters = z.infer<typeof FiatHistoryQuery>

export const FiatOrderParams = z.object({
  orderId: z.uuid(),
})

export const FiatRouteOption = z.object({
  billingRequired: z.boolean(),
  code: z.string(),
  currency: z.string(),
  depositEnabled: z.boolean(),
  depositFeeFixed: z.string(),
  depositFeeRateBps: z.number().int(),
  maxDepositAmount: z.string().nullable(),
  maxWithdrawAmount: z.string().nullable(),
  minDepositAmount: z.string().nullable(),
  minWithdrawAmount: z.string().nullable(),
  paymentMethod: z.string(),
  payoutAccountType: z.string().nullable(),
  payoutFeeFixed: z.string(),
  payoutFeeRateBps: z.number().int(),
  providerCode: z.string(),
  providerName: z.string(),
  withdrawalEnabled: z.boolean(),
})

export const FiatOptions = z.object({
  items: z.array(FiatRouteOption),
})

export const FiatDeposit = z.object({
  amount: z.string(),
  authUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
  currency: z.string(),
  failureReason: z.string().nullable(),
  id: z.string(),
  needAuth: z.boolean(),
  routeCode: z.string(),
  status: z.enum([
    'creating',
    'pending',
    'submit_unconfirmed',
    'processing',
    'succeeded',
    'failed',
    'expired',
  ]),
  type: z.literal('deposit'),
  updatedAt: z.iso.datetime(),
})

export type FiatDepositResponse = z.infer<typeof FiatDeposit>

export const FiatPayout = z.object({
  amount: z.string(),
  confirmUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
  currency: z.string(),
  failureReason: z.string().nullable(),
  id: z.string(),
  needUserConfirm: z.boolean(),
  payoutAmount: z.string(),
  routeCode: z.string(),
  status: z.enum([
    'pending_review',
    'queued',
    'submitting',
    'submit_unconfirmed',
    'processing',
    'pending_approval',
    'succeeded',
    'failed',
    'cancelled',
  ]),
  type: z.literal('payout'),
  updatedAt: z.iso.datetime(),
  userFee: z.string(),
})

export type FiatPayoutResponse = z.infer<typeof FiatPayout>

export const FiatOrder = z.discriminatedUnion('type', [FiatDeposit, FiatPayout])

export type FiatOrderResponse = z.infer<typeof FiatOrder>

export const FiatOrderList = z.object({
  items: z.array(FiatOrder),
  nextCursor: z.string().nullable(),
})

export const FiatWebhook = z.object({
  duplicate: z.boolean(),
  ignored: z.boolean(),
  processed: z.number().int().nonnegative(),
})

z.globalRegistry.add(FiatRouteOption, { id: 'FiatRouteOption' })
z.globalRegistry.add(FiatOptions, { id: 'FiatOptions' })
z.globalRegistry.add(FiatDeposit, { id: 'FiatDeposit' })
z.globalRegistry.add(FiatPayout, { id: 'FiatPayout' })
z.globalRegistry.add(FiatOrder, { id: 'FiatOrder' })
z.globalRegistry.add(FiatOrderList, { id: 'FiatOrderList' })
