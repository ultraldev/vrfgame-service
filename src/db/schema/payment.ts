import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { user } from './auth'
import { currency, wallet } from './wallet'

export const paymentProvider = pgTable(
  'payment_provider',
  {
    code: text('code').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    depositEnabled: boolean('deposit_enabled').notNull().default(true),
    enabled: boolean('enabled').notNull().default(true),
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    withdrawalEnabled: boolean('withdrawal_enabled').notNull().default(false),
  },
  (table) => [uniqueIndex('payment_provider_code_idx').on(table.code)],
)

export const cryptoRoute = pgTable(
  'crypto_route',
  {
    chain: text('chain').notNull(),
    code: text('code').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    currencyCode: text('currency_code')
      .notNull()
      .references(() => currency.code),
    depositEnabled: boolean('deposit_enabled').notNull().default(true),
    depositFeeRateBps: integer('deposit_fee_rate_bps').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    id: text('id').primaryKey(),
    maxDepositAmount: bigint('max_deposit_amount', { mode: 'bigint' }),
    maxWithdrawAmount: bigint('max_withdraw_amount', { mode: 'bigint' }),
    minDepositAmount: bigint('min_deposit_amount', { mode: 'bigint' }),
    minWithdrawAmount: bigint('min_withdraw_amount', { mode: 'bigint' }),
    payoutFeeFixed: bigint('payout_fee_fixed', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    priority: integer('priority').notNull().default(0),
    providerId: text('provider_id')
      .notNull()
      .references(() => paymentProvider.id),
    reviewWithdrawAmount: bigint('review_withdraw_amount', { mode: 'bigint' }),
    symbol: text('symbol').notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    withdrawalEnabled: boolean('withdrawal_enabled').notNull().default(false),
  },
  (table) => [
    uniqueIndex('crypto_route_code_idx').on(table.code),
    uniqueIndex('crypto_route_provider_asset_idx').on(
      table.providerId,
      table.chain,
      table.symbol,
      table.currencyCode,
    ),
    index('crypto_route_currency_enabled_idx').on(
      table.currencyCode,
      table.enabled,
      table.priority,
    ),
    check(
      'crypto_route_deposit_fee_check',
      sql`${table.depositFeeRateBps} >= 0 and ${table.depositFeeRateBps} <= 10000`,
    ),
    check('crypto_route_payout_fee_check', sql`${table.payoutFeeFixed} >= 0`),
    check(
      'crypto_route_min_deposit_check',
      sql`${table.minDepositAmount} is null or ${table.minDepositAmount} >= 0`,
    ),
    check(
      'crypto_route_max_deposit_check',
      sql`${table.maxDepositAmount} is null or ${table.maxDepositAmount} >= 0`,
    ),
    check(
      'crypto_route_deposit_range_check',
      sql`${table.minDepositAmount} is null or ${table.maxDepositAmount} is null or ${table.minDepositAmount} <= ${table.maxDepositAmount}`,
    ),
    check(
      'crypto_route_min_withdraw_check',
      sql`${table.minWithdrawAmount} is null or ${table.minWithdrawAmount} >= 0`,
    ),
    check(
      'crypto_route_max_withdraw_check',
      sql`${table.maxWithdrawAmount} is null or ${table.maxWithdrawAmount} >= 0`,
    ),
    check(
      'crypto_route_withdraw_range_check',
      sql`${table.minWithdrawAmount} is null or ${table.maxWithdrawAmount} is null or ${table.minWithdrawAmount} <= ${table.maxWithdrawAmount}`,
    ),
    check(
      'crypto_route_review_withdraw_check',
      sql`${table.reviewWithdrawAmount} is null or ${table.reviewWithdrawAmount} >= 0`,
    ),
  ],
)

export const paymentWebhookEvent = pgTable(
  'payment_webhook_event',
  {
    dedupeKey: text('dedupe_key').notNull(),
    eventType: text('event_type').notNull(),
    id: text('id').primaryKey(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    payloadHash: text('payload_hash').notNull(),
    processedAt: timestamp('processed_at'),
    processingError: text('processing_error'),
    processingStatus: text('processing_status').notNull().default('received'),
    providerEventId: text('provider_event_id'),
    providerId: text('provider_id')
      .notNull()
      .references(() => paymentProvider.id),
    receivedAt: timestamp('received_at').defaultNow().notNull(),
    signatureValid: boolean('signature_valid').notNull(),
  },
  (table) => [
    uniqueIndex('payment_webhook_event_provider_dedupe_idx').on(
      table.providerId,
      table.dedupeKey,
    ),
    index('payment_webhook_event_status_received_idx').on(
      table.processingStatus,
      table.receivedAt,
    ),
    index('payment_webhook_event_provider_received_idx').on(
      table.providerId,
      table.receivedAt,
    ),
    check(
      'payment_webhook_event_type_check',
      sql`${table.eventType} in ('deposit', 'withdrawal', 'refund')`,
    ),
    check(
      'payment_webhook_event_status_check',
      sql`${table.processingStatus} in ('received', 'processing', 'processed', 'ignored', 'failed')`,
    ),
  ],
)

export const cryptoDeposit = pgTable(
  'crypto_deposit',
  {
    actualAmount: bigint('actual_amount', { mode: 'bigint' }),
    address: text('address'),
    appPayUrl: text('app_pay_url'),
    chain: text('chain').notNull(),
    checkAttempts: integer('check_attempts').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    currencyCode: text('currency_code')
      .notNull()
      .references(() => currency.code),
    expectedAmount: bigint('expected_amount', { mode: 'bigint' }).notNull(),
    expiresAt: timestamp('expires_at'),
    failureReason: text('failure_reason'),
    id: text('id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    lastCheckError: text('last_check_error'),
    lastCheckedAt: timestamp('last_checked_at'),
    ledgerTransactionId: text('ledger_transaction_id'),
    platformFee: bigint('platform_fee', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    platformFeeRateBps: integer('platform_fee_rate_bps'),
    providerId: text('provider_id')
      .notNull()
      .references(() => paymentProvider.id),
    providerOrderId: text('provider_order_id'),
    providerPayload: jsonb('provider_payload').$type<Record<string, unknown>>(),
    providerTxId: text('provider_tx_id'),
    requestHash: text('request_hash').notNull(),
    requestId: text('request_id').notNull(),
    routeId: text('route_id')
      .notNull()
      .references(() => cryptoRoute.id),
    status: text('status').notNull(),
    symbol: text('symbol').notNull(),
    txHash: text('tx_hash'),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    walletId: text('wallet_id').references(() => wallet.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    uniqueIndex('crypto_deposit_user_idempotency_idx').on(
      table.userId,
      table.idempotencyKey,
    ),
    uniqueIndex('crypto_deposit_provider_request_idx').on(
      table.providerId,
      table.requestId,
    ),
    uniqueIndex('crypto_deposit_provider_order_idx').on(
      table.providerId,
      table.providerOrderId,
    ),
    uniqueIndex('crypto_deposit_provider_tx_idx').on(
      table.providerId,
      table.providerTxId,
    ),
    index('crypto_deposit_user_created_idx').on(table.userId, table.createdAt),
    index('crypto_deposit_status_expires_idx').on(
      table.status,
      table.expiresAt,
    ),
    index('crypto_deposit_provider_address_idx').on(
      table.providerId,
      table.address,
    ),
    index('crypto_deposit_ledger_transaction_idx').on(
      table.ledgerTransactionId,
    ),
    check(
      'crypto_deposit_status_check',
      sql`${table.status} in ('creating', 'pending', 'processing', 'succeeded', 'failed', 'expired')`,
    ),
    check(
      'crypto_deposit_expected_amount_check',
      sql`${table.expectedAmount} > 0`,
    ),
    check(
      'crypto_deposit_actual_amount_check',
      sql`${table.actualAmount} is null or ${table.actualAmount} >= 0`,
    ),
    check(
      'crypto_deposit_platform_fee_check',
      sql`${table.platformFee} >= 0 and (${table.platformFeeRateBps} is null or (${table.platformFeeRateBps} >= 0 and ${table.platformFeeRateBps} <= 10000))`,
    ),
  ],
)

export const cryptoWithdrawal = pgTable(
  'crypto_withdrawal',
  {
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    chain: text('chain').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    currencyCode: text('currency_code')
      .notNull()
      .references(() => currency.code),
    externalRefId: text('external_ref_id'),
    failureReason: text('failure_reason'),
    fee: bigint('fee', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    feeQuotedAt: timestamp('fee_quoted_at'),
    id: text('id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    lastCheckError: text('last_check_error'),
    lastCheckedAt: timestamp('last_checked_at'),
    ledgerLockTransactionId: text('ledger_lock_transaction_id'),
    ledgerSettleTransactionId: text('ledger_settle_transaction_id'),
    ledgerUnlockTransactionId: text('ledger_unlock_transaction_id'),
    platformFee: bigint('platform_fee', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    providerFee: bigint('provider_fee', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    providerId: text('provider_id')
      .notNull()
      .references(() => paymentProvider.id),
    providerPayload: jsonb('provider_payload').$type<Record<string, unknown>>(),
    quotedFee: bigint('quoted_fee', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    requestHash: text('request_hash').notNull(),
    routeId: text('route_id')
      .notNull()
      .references(() => cryptoRoute.id),
    settledAt: timestamp('settled_at'),
    status: text('status').notNull(),
    submittedAt: timestamp('submitted_at'),
    symbol: text('symbol').notNull(),
    toAddress: text('to_address').notNull(),
    txHash: text('tx_hash'),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    walletId: text('wallet_id')
      .notNull()
      .references(() => wallet.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('crypto_withdrawal_user_idempotency_idx').on(
      table.userId,
      table.idempotencyKey,
    ),
    uniqueIndex('crypto_withdrawal_provider_ref_idx').on(
      table.providerId,
      table.externalRefId,
    ),
    index('crypto_withdrawal_user_created_idx').on(
      table.userId,
      table.createdAt,
    ),
    index('crypto_withdrawal_status_created_idx').on(
      table.status,
      table.createdAt,
    ),
    index('crypto_withdrawal_currency_idx').on(table.currencyCode),
    index('crypto_withdrawal_wallet_idx').on(table.walletId),
    check(
      'crypto_withdrawal_status_check',
      sql`${table.status} in ('pending_review', 'queued', 'submitting', 'submit_unconfirmed', 'processing', 'pending_approval', 'succeeded', 'failed', 'cancelled')`,
    ),
    check('crypto_withdrawal_amount_check', sql`${table.amount} > 0`),
    check(
      'crypto_withdrawal_fee_check',
      sql`${table.fee} >= 0 and ${table.fee} <= ${table.amount} and ${table.quotedFee} >= 0 and ${table.quotedFee} <= ${table.amount} and ${table.platformFee} >= 0 and ${table.providerFee} >= 0`,
    ),
  ],
)

export const fiatRoute = pgTable(
  'fiat_route',
  {
    billingRequired: boolean('billing_required').notNull().default(true),
    code: text('code').notNull(),
    country: text('country'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    currencyCode: text('currency_code')
      .notNull()
      .references(() => currency.code),
    depositEnabled: boolean('deposit_enabled').notNull().default(true),
    depositFeeFixed: bigint('deposit_fee_fixed', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    depositFeeRateBps: integer('deposit_fee_rate_bps').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    id: text('id').primaryKey(),
    maxDepositAmount: bigint('max_deposit_amount', { mode: 'bigint' }),
    maxWithdrawAmount: bigint('max_withdraw_amount', { mode: 'bigint' }),
    minDepositAmount: bigint('min_deposit_amount', { mode: 'bigint' }),
    minWithdrawAmount: bigint('min_withdraw_amount', { mode: 'bigint' }),
    paymentMethod: text('payment_method').notNull(),
    payoutAccountType: text('payout_account_type'),
    payoutFeeFixed: bigint('payout_fee_fixed', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    payoutFeeRateBps: integer('payout_fee_rate_bps').notNull().default(0),
    priority: integer('priority').notNull().default(0),
    providerId: text('provider_id')
      .notNull()
      .references(() => paymentProvider.id),
    providerPaymentCode: text('provider_payment_code').notNull(),
    reviewWithdrawAmount: bigint('review_withdraw_amount', { mode: 'bigint' }),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    withdrawalEnabled: boolean('withdrawal_enabled').notNull().default(false),
  },
  (table) => [
    uniqueIndex('fiat_route_code_idx').on(table.code),
    uniqueIndex('fiat_route_provider_code_currency_idx').on(
      table.providerId,
      table.providerPaymentCode,
      table.currencyCode,
    ),
    index('fiat_route_currency_enabled_idx').on(
      table.currencyCode,
      table.enabled,
      table.priority,
    ),
    check(
      'fiat_route_deposit_fee_check',
      sql`${table.depositFeeRateBps} >= 0 and ${table.depositFeeRateBps} <= 10000 and ${table.depositFeeFixed} >= 0`,
    ),
    check(
      'fiat_route_payout_fee_check',
      sql`${table.payoutFeeRateBps} >= 0 and ${table.payoutFeeRateBps} <= 10000 and ${table.payoutFeeFixed} >= 0`,
    ),
    check(
      'fiat_route_payout_account_type_check',
      sql`${table.payoutAccountType} is null or ${table.payoutAccountType} in ('card', 'paypal', 'cash_app')`,
    ),
    check(
      'fiat_route_min_deposit_check',
      sql`${table.minDepositAmount} is null or ${table.minDepositAmount} >= 0`,
    ),
    check(
      'fiat_route_max_deposit_check',
      sql`${table.maxDepositAmount} is null or ${table.maxDepositAmount} >= 0`,
    ),
    check(
      'fiat_route_deposit_range_check',
      sql`${table.minDepositAmount} is null or ${table.maxDepositAmount} is null or ${table.minDepositAmount} <= ${table.maxDepositAmount}`,
    ),
    check(
      'fiat_route_min_withdraw_check',
      sql`${table.minWithdrawAmount} is null or ${table.minWithdrawAmount} >= 0`,
    ),
    check(
      'fiat_route_max_withdraw_check',
      sql`${table.maxWithdrawAmount} is null or ${table.maxWithdrawAmount} >= 0`,
    ),
    check(
      'fiat_route_withdraw_range_check',
      sql`${table.minWithdrawAmount} is null or ${table.maxWithdrawAmount} is null or ${table.minWithdrawAmount} <= ${table.maxWithdrawAmount}`,
    ),
    check(
      'fiat_route_review_withdraw_check',
      sql`${table.reviewWithdrawAmount} is null or ${table.reviewWithdrawAmount} >= 0`,
    ),
  ],
)

export const fiatOrder = pgTable(
  'fiat_order',
  {
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    authUrl: text('auth_url'),
    confirmUrl: text('confirm_url'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    currencyCode: text('currency_code')
      .notNull()
      .references(() => currency.code),
    failureReason: text('failure_reason'),
    id: text('id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    ledgerLockTransactionId: text('ledger_lock_transaction_id'),
    ledgerSettleTransactionId: text('ledger_settle_transaction_id'),
    ledgerTransactionId: text('ledger_transaction_id'),
    ledgerUnlockTransactionId: text('ledger_unlock_transaction_id'),
    merchantOrderNo: text('merchant_order_no').notNull(),
    needAuth: boolean('need_auth').notNull().default(false),
    needUserConfirm: boolean('need_user_confirm').notNull().default(false),
    originalOrderId: text('original_order_id').references(
      (): AnyPgColumn => fiatOrder.id,
      { onDelete: 'set null' },
    ),
    payoutAmount: bigint('payout_amount', { mode: 'bigint' }),
    providerFee: bigint('provider_fee', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    providerId: text('provider_id')
      .notNull()
      .references(() => paymentProvider.id),
    providerOrderNo: text('provider_order_no'),
    providerPayload: jsonb('provider_payload').$type<Record<string, unknown>>(),
    requestHash: text('request_hash').notNull(),
    requestPayload: jsonb('request_payload').$type<Record<string, unknown>>(),
    retryable: boolean('retryable').notNull().default(false),
    routeId: text('route_id')
      .notNull()
      .references(() => fiatRoute.id),
    settledAt: timestamp('settled_at'),
    status: text('status').notNull(),
    submittedAt: timestamp('submitted_at'),
    type: text('type').notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    userFee: bigint('user_fee', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    walletId: text('wallet_id').references(() => wallet.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    uniqueIndex('fiat_order_user_idempotency_idx').on(
      table.userId,
      table.idempotencyKey,
    ),
    index('fiat_order_provider_type_merchant_idx').on(
      table.providerId,
      table.type,
      table.merchantOrderNo,
    ),
    uniqueIndex('fiat_order_provider_order_idx').on(
      table.providerId,
      table.providerOrderNo,
    ),
    index('fiat_order_user_created_idx').on(table.userId, table.createdAt),
    index('fiat_order_status_created_idx').on(table.status, table.createdAt),
    index('fiat_order_original_idx').on(table.originalOrderId),
    check(
      'fiat_order_type_check',
      sql`${table.type} in ('deposit', 'payout', 'refund')`,
    ),
    check(
      'fiat_order_status_check',
      sql`${table.status} in ('creating', 'pending', 'pending_review', 'queued', 'submitting', 'submit_unconfirmed', 'processing', 'pending_approval', 'succeeded', 'failed', 'expired', 'cancelled')`,
    ),
    check('fiat_order_amount_check', sql`${table.amount} > 0`),
    check(
      'fiat_order_fee_check',
      sql`${table.userFee} >= 0 and ${table.userFee} <= ${table.amount} and ${table.providerFee} >= 0 and (${table.payoutAmount} is null or (${table.payoutAmount} >= 0 and ${table.payoutAmount} <= ${table.amount}))`,
    ),
  ],
)

export const paymentProviderRelations = relations(
  paymentProvider,
  ({ many }) => ({
    cryptoDeposits: many(cryptoDeposit),
    cryptoRoutes: many(cryptoRoute),
    cryptoWithdrawals: many(cryptoWithdrawal),
    fiatOrders: many(fiatOrder),
    fiatRoutes: many(fiatRoute),
    webhookEvents: many(paymentWebhookEvent),
  }),
)

export const cryptoRouteRelations = relations(cryptoRoute, ({ many, one }) => ({
  currency: one(currency, {
    fields: [cryptoRoute.currencyCode],
    references: [currency.code],
  }),
  deposits: many(cryptoDeposit),
  provider: one(paymentProvider, {
    fields: [cryptoRoute.providerId],
    references: [paymentProvider.id],
  }),
  withdrawals: many(cryptoWithdrawal),
}))

export const paymentWebhookEventRelations = relations(
  paymentWebhookEvent,
  ({ one }) => ({
    provider: one(paymentProvider, {
      fields: [paymentWebhookEvent.providerId],
      references: [paymentProvider.id],
    }),
  }),
)

export const cryptoDepositRelations = relations(cryptoDeposit, ({ one }) => ({
  currency: one(currency, {
    fields: [cryptoDeposit.currencyCode],
    references: [currency.code],
  }),
  provider: one(paymentProvider, {
    fields: [cryptoDeposit.providerId],
    references: [paymentProvider.id],
  }),
  route: one(cryptoRoute, {
    fields: [cryptoDeposit.routeId],
    references: [cryptoRoute.id],
  }),
  user: one(user, {
    fields: [cryptoDeposit.userId],
    references: [user.id],
  }),
  wallet: one(wallet, {
    fields: [cryptoDeposit.walletId],
    references: [wallet.id],
  }),
}))

export const cryptoWithdrawalRelations = relations(
  cryptoWithdrawal,
  ({ one }) => ({
    currency: one(currency, {
      fields: [cryptoWithdrawal.currencyCode],
      references: [currency.code],
    }),
    provider: one(paymentProvider, {
      fields: [cryptoWithdrawal.providerId],
      references: [paymentProvider.id],
    }),
    route: one(cryptoRoute, {
      fields: [cryptoWithdrawal.routeId],
      references: [cryptoRoute.id],
    }),
    user: one(user, {
      fields: [cryptoWithdrawal.userId],
      references: [user.id],
    }),
    wallet: one(wallet, {
      fields: [cryptoWithdrawal.walletId],
      references: [wallet.id],
    }),
  }),
)

export const fiatRouteRelations = relations(fiatRoute, ({ many, one }) => ({
  currency: one(currency, {
    fields: [fiatRoute.currencyCode],
    references: [currency.code],
  }),
  orders: many(fiatOrder),
  provider: one(paymentProvider, {
    fields: [fiatRoute.providerId],
    references: [paymentProvider.id],
  }),
}))

export const fiatOrderRelations = relations(fiatOrder, ({ many, one }) => ({
  currency: one(currency, {
    fields: [fiatOrder.currencyCode],
    references: [currency.code],
  }),
  originalOrder: one(fiatOrder, {
    fields: [fiatOrder.originalOrderId],
    references: [fiatOrder.id],
    relationName: 'fiatOrderRefunds',
  }),
  provider: one(paymentProvider, {
    fields: [fiatOrder.providerId],
    references: [paymentProvider.id],
  }),
  refunds: many(fiatOrder, { relationName: 'fiatOrderRefunds' }),
  route: one(fiatRoute, {
    fields: [fiatOrder.routeId],
    references: [fiatRoute.id],
  }),
  user: one(user, {
    fields: [fiatOrder.userId],
    references: [user.id],
  }),
  wallet: one(wallet, {
    fields: [fiatOrder.walletId],
    references: [wallet.id],
  }),
}))
