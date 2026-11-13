import { createHash } from 'node:crypto'

import { httpErrors } from '@fastify/sensible'

import type * as schema from '@/db/schema'
import { formatAmount } from '@/lib/money'
import type {
  ZeffraBilling,
  ZeffraDevice,
  ZeffraRecipient,
} from '@/modules/payments/providers/zeffra/types'

type FiatRouteRow = typeof schema.fiatRoute.$inferSelect
type CurrencyRow = typeof schema.currency.$inferSelect
type PaymentProviderRow = typeof schema.paymentProvider.$inferSelect

export function fiatRouteOption(
  currency: CurrencyRow,
  provider: PaymentProviderRow,
  route: FiatRouteRow,
) {
  return {
    billingRequired: route.billingRequired,
    code: route.code,
    currency: currency.code,
    depositEnabled: route.depositEnabled,
    depositFeeFixed: formatAmount(route.depositFeeFixed, currency.decimals),
    depositFeeRateBps: route.depositFeeRateBps,
    maxDepositAmount:
      route.maxDepositAmount === null
        ? null
        : formatAmount(route.maxDepositAmount, currency.decimals),
    maxWithdrawAmount:
      route.maxWithdrawAmount === null
        ? null
        : formatAmount(route.maxWithdrawAmount, currency.decimals),
    minDepositAmount:
      route.minDepositAmount === null
        ? null
        : formatAmount(route.minDepositAmount, currency.decimals),
    minWithdrawAmount:
      route.minWithdrawAmount === null
        ? null
        : formatAmount(route.minWithdrawAmount, currency.decimals),
    paymentMethod: route.paymentMethod,
    payoutAccountType: route.payoutAccountType,
    payoutFeeFixed: formatAmount(route.payoutFeeFixed, currency.decimals),
    payoutFeeRateBps: route.payoutFeeRateBps,
    providerCode: provider.code,
    providerName: provider.name,
    withdrawalEnabled: route.withdrawalEnabled,
  }
}

export function resolveFiatBilling(
  user: Pick<(typeof schema.user)['$inferSelect'], 'email' | 'name'>,
  billing: ZeffraBilling = {},
): ZeffraBilling {
  const [firstName = 'John', ...rest] = user.name.trim().split(/\s+/u)
  return {
    address1: '123 Main Street',
    city: 'New York',
    country: 'US',
    email: user.email,
    firstName,
    lastName: rest.join(' ') || 'Doe',
    phone: '+10000000000',
    postalCode: '10001',
    state: 'NY',
    ...billing,
  }
}

export function resolveFiatDevice(
  userId: string,
  clientIp: string,
  device: Omit<ZeffraDevice, 'clientIp'> = {},
): ZeffraDevice {
  const sessionId = createHash('sha256')
    .update(`fiat-device:${userId}`)
    .digest('hex')
    .slice(0, 32)
  return {
    browser: 'Unknown',
    cardInputMethod: 'typed',
    clientIp,
    cookie: `session_id=${sessionId}`,
    language: 'en-US',
    os: 'Unknown',
    screenResolution: '1920x1080',
    timezone: 'GMT+8',
    ...device,
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const CASHTAG_PATTERN = /^\$[A-Za-z][A-Za-z0-9]{0,19}$/u
const CARD_ACCOUNT_PATTERN = /^\d{4,32}$/u

function virtualPayoutRecipient(
  userId: string,
  email?: string,
): ZeffraRecipient {
  const seed = createHash('sha256')
    .update(`fiat-payout:${userId}`)
    .digest('hex')
  const suffix = seed.slice(0, 8).toUpperCase()
  const phoneSuffix = String(
    Number.parseInt(seed.slice(8, 12), 16) % 10_000,
  ).padStart(4, '0')
  return {
    address: `1 Market Street ${suffix}`,
    city: 'Los Angeles',
    country: 'US',
    email: email ?? `payout+${seed.slice(0, 12)}@vrfgame.com`,
    firstName: 'Payout',
    lastName: `User${suffix}`,
    phone: `+1202555${phoneSuffix}`,
    postalCode: '90001',
    state: 'CA',
  }
}

export function resolveFiatPayoutAccount(input: {
  receiveAccount: string
  receiveAccountExpireAt?: string
  recipient?: ZeffraRecipient
  route: Pick<FiatRouteRow, 'payoutAccountType'>
  userId: string
}) {
  const receiveAccount = input.receiveAccount.trim()
  switch (input.route.payoutAccountType) {
    case 'card': {
      if (!input.recipient) {
        throw httpErrors.badRequest('Card payout recipient is required')
      }
      if (!CARD_ACCOUNT_PATTERN.test(receiveAccount)) {
        throw httpErrors.badRequest('Card payout account is invalid')
      }
      if (!input.receiveAccountExpireAt) {
        throw httpErrors.badRequest('Card payout expiry is required')
      }
      return {
        receiveAccount,
        receiveAccountExpireAt: input.receiveAccountExpireAt,
        recipient: input.recipient,
      }
    }
    case 'paypal': {
      const email = receiveAccount.toLowerCase()
      if (!EMAIL_PATTERN.test(email) || email.length > 128) {
        throw httpErrors.badRequest('PayPal email is invalid')
      }
      return {
        receiveAccount: email,
        receiveAccountExpireAt: '12/2035',
        recipient: virtualPayoutRecipient(input.userId, email),
      }
    }
    case 'cash_app': {
      const normalizedTag = receiveAccount.startsWith('$')
        ? receiveAccount
        : `$${receiveAccount}`
      if (!CASHTAG_PATTERN.test(normalizedTag)) {
        throw httpErrors.badRequest('Cash App Cashtag is invalid')
      }
      return {
        receiveAccount: normalizedTag,
        receiveAccountExpireAt: '12/2035',
        recipient: virtualPayoutRecipient(input.userId),
      }
    }
    default: {
      throw httpErrors.badRequest('Fiat payout account type is not supported')
    }
  }
}
