import { errorMessage } from '@/lib/errors'
import { parseAmount } from '@/lib/money'
import { isRecord } from '@/lib/object'

import { KuCoinPayClient } from './client'
import type { KuCoinPayConfig, KuCoinPayOnchainOrder } from './client'
import { KuCoinPayRequestError } from './errors'
import { KuCoinPayoutError } from './payout-error'
import { buildSignatureString, verifySignature } from './signature'
import { arrayOfRecords, stringField } from './util'

const OFFCHAIN_PAYMENT_FIELDS = [
  'apiKey',
  'errorReason',
  'orderAmount',
  'orderCurrency',
  'payOrderId',
  'payTime',
  'reference',
  'refundCurrency',
  'requestId',
  'status',
  'subMerchantId',
  'timestamp',
] as const

const ONCHAIN_PAYMENT_FIELDS = [
  'apiKey',
  'assetUniqueId',
  'chain',
  'currency',
  'paymentAmount',
  'paymentCurrency',
  'paymentOrderType',
  'paymentStatus',
  'payOrderId',
  'requestId',
  'status',
  'subMerchantId',
  'timestamp',
] as const

const TRON_ADDRESS_PATTERN = /^T[a-zA-Z0-9]{33}$/u
const USDT_DECIMALS = 6

const PAYOUT_FIELDS = [
  'apiKey',
  'batchNo',
  'chain',
  'currency',
  'payoutType',
  'processingFee',
  'requestId',
  'status',
  'totalAmount',
  'totalCount',
  'totalPaidAmount',
  'totalPayoutFee',
  'timestamp',
] as const

type KuCoinWebhookEventType = 'offchain_payment' | 'onchain_payment' | 'payout'

export interface KuCoinDepositEvent {
  address?: string
  amount?: string
  chain: string
  failureReason?: string
  providerOrderId?: string
  providerPayload: Record<string, unknown>
  providerTxId?: string
  requestId?: string
  status: 'failed' | 'processing' | 'succeeded'
  symbol: string
  txHash?: string
  type: 'deposit'
}

export interface KuCoinWithdrawalEvent {
  address?: string
  amount?: string
  chain: string
  failureReason?: string
  providerBatchId?: string
  providerFee?: string
  providerPayload: Record<string, unknown>
  requestId?: string
  status: 'failed' | 'pending_approval' | 'processing' | 'succeeded'
  symbol: string
  txHash?: string
  type: 'withdrawal'
}

export type KuCoinWebhookResult =
  | {
      events: KuCoinDepositEvent[]
      eventType: 'onchain_payment'
      payload: Record<string, unknown>
    }
  | {
      eventType: 'offchain_payment' | 'payout'
      events?: KuCoinWithdrawalEvent[]
      payload: Record<string, unknown>
      reason: string
    }

export interface KuCoinCreateDepositInput {
  amount: bigint
  chain: string
  currency: string
  decimals: number
  requestId: string
  symbol: string
}

export interface KuCoinCreateDepositResult {
  address: string
  appPayUrl?: string
  expiresAt: Date
  providerOrderId: string
  providerPayload: Record<string, unknown>
}

export interface KuCoinQueryDepositInput {
  address: string
  createdAt: Date
  currency: string
  requestId: string
}

export interface KuCoinWithdrawalFeeInput {
  amount: bigint
  chain: string
  currency: string
  decimals: number
  platformFeeFixed?: bigint
  symbol: string
}

export interface KuCoinWithdrawalFeeResult {
  fee: bigint
  platformFee: bigint
  receiveAmount: bigint
}

export interface KuCoinSubmitWithdrawalInput {
  amount: bigint
  chain: string
  currency: string
  decimals: number
  platformFeeFixed?: bigint
  requestId: string
  symbol: string
  toAddress: string
}

export interface KuCoinSubmitWithdrawalResult {
  externalRefId: string
  fee: bigint
  platformFee: bigint
  status: 'processing'
}

function isConfigured(config: KuCoinPayConfig) {
  return Boolean(
    config.apiKey?.trim() &&
    config.platformPublicKey?.trim() &&
    config.privateKey?.trim() &&
    config.subMerchantId?.trim(),
  )
}

function paymentError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode })
}

function parsePayload(rawBody: Buffer) {
  const value: unknown = JSON.parse(rawBody.toString('utf-8'))
  if (!isRecord(value)) {
    throw paymentError('Invalid KuCoin Pay callback body', 400)
  }
  return value
}

function detectWebhookEventType(
  payload: Record<string, unknown>,
): KuCoinWebhookEventType | null {
  const orderType = stringField(payload, ['orderType']).toUpperCase()
  if (orderType === 'PAYOUT') {
    return 'payout'
  }
  if (orderType === 'ONCHAIN_PAYMENT') {
    return 'onchain_payment'
  }
  if (orderType === 'TRADE') {
    return 'offchain_payment'
  }
  if (payload.withdrawDetailDtoList || payload.batchNo) {
    return 'payout'
  }
  if (payload.paymentOrderType || payload.paymentStatus) {
    return 'onchain_payment'
  }
  if (payload.orderAmount && payload.payOrderId) {
    return 'offchain_payment'
  }
  return null
}

function signatureFieldsForEvent(eventType: KuCoinWebhookEventType) {
  switch (eventType) {
    case 'offchain_payment': {
      return OFFCHAIN_PAYMENT_FIELDS
    }
    case 'onchain_payment': {
      return ONCHAIN_PAYMENT_FIELDS
    }
    case 'payout': {
      return PAYOUT_FIELDS
    }
    default: {
      throw paymentError('Unsupported KuCoin Pay callback type', 400)
    }
  }
}

function toCanonicalChain(chain: string) {
  const normalized = chain.trim().toUpperCase()
  return normalized === 'TRX' || normalized === 'TRON' ? 'TRON' : normalized
}

function toKuCoinChain(chain: string) {
  return toCanonicalChain(chain) === 'TRON' ? 'trx' : null
}

function onchainStatus(payload: Record<string, unknown>) {
  const status = stringField(payload, ['status']).toUpperCase()
  const paymentStatus = stringField(payload, ['paymentStatus']).toUpperCase()
  if (
    (status === 'USER_PAY_COMPLETED' || status === 'SUCCEEDED') &&
    (paymentStatus === 'FULL_PAYMENT' || paymentStatus === 'OVER_PAYMENT')
  ) {
    return 'succeeded' as const
  }
  if (status === 'USER_PAY_COMPLETED' && paymentStatus === 'PART_PAYMENT') {
    return 'processing' as const
  }
  if (
    status === 'FAILED' ||
    status === 'RISK_REJECT' ||
    status === 'EXPIRED' ||
    paymentStatus === 'WRONG_PAYMENT'
  ) {
    return 'failed' as const
  }
  return null
}

function parseOnchainPayment(
  payload: Record<string, unknown>,
): KuCoinDepositEvent[] {
  const symbol = stringField(payload, [
    'paymentCurrency',
    'currency',
  ]).toUpperCase()
  const chain = toCanonicalChain(stringField(payload, ['chain']))
  if (chain !== 'TRON' || symbol !== 'USDT') {
    return []
  }
  const status = onchainStatus(payload)
  if (!status) {
    return []
  }
  const amount = stringField(payload, ['paymentAmount'])
  const address = stringField(payload, ['address'])
  const requestId = stringField(payload, ['requestId'])
  const providerOrderId = stringField(payload, ['payOrderId'])
  const providerTxId = stringField(payload, [
    'assetUniqueId',
    'txId',
    'payOrderId',
  ])
  if (status === 'succeeded' && (!amount || !address || !providerTxId)) {
    throw paymentError(
      'KuCoin Pay deposit callback is missing amount, address, or transaction ID',
      400,
    )
  }

  return [
    {
      address: amount && address ? address : undefined,
      amount: amount || undefined,
      chain,
      failureReason:
        status === 'failed'
          ? stringField(payload, ['errorReason', 'status']).slice(0, 500)
          : undefined,
      providerOrderId: providerOrderId || undefined,
      providerPayload: payload,
      providerTxId: providerTxId || undefined,
      requestId: requestId || undefined,
      status,
      symbol,
      txHash: stringField(payload, ['txId']) || undefined,
      type: 'deposit',
    },
  ]
}

function parseQueriedOnchainOrder(
  order: KuCoinPayOnchainOrder,
  requestId: string,
) {
  return parseOnchainPayment({
    ...order,
    chain: order.paymentChain ?? order.chain,
    requestId: order.requestId ?? requestId,
  })
}

function payoutStatus(
  detail: Record<string, unknown>,
  batchStatus?: string,
): KuCoinWithdrawalEvent['status'] {
  const detailStatus = stringField(detail, ['status']).toUpperCase()
  const rootStatus = (batchStatus ?? '').toUpperCase()
  if (detailStatus === 'SUCCEEDED') {
    return 'succeeded'
  }
  if (detailStatus === 'FAILED' || rootStatus === 'FAILED') {
    return 'failed'
  }
  if (
    detailStatus === 'PENDING_APPROVAL' ||
    rootStatus === 'PENDING_APPROVAL'
  ) {
    return 'pending_approval'
  }
  return 'processing'
}

function parsePayout(
  payload: Record<string, unknown>,
): KuCoinWithdrawalEvent[] {
  const chain = toCanonicalChain(stringField(payload, ['chain']))
  const symbol = stringField(payload, ['currency']).toUpperCase()
  const batchNo = stringField(payload, ['batchNo'])
  const details = arrayOfRecords(payload, ['withdrawDetailDtoList']) ?? []
  if (chain !== 'TRON' || symbol !== 'USDT') {
    return []
  }

  return details.flatMap((detail) => {
    const requestId = stringField(detail, ['detailId'])
    const address = stringField(detail, ['receiverAddress'])
    const amount = stringField(detail, ['amount'])
    if (!requestId || !address || !amount) {
      return []
    }
    const status = payoutStatus(detail, stringField(payload, ['status']))
    return [
      {
        address,
        amount,
        chain,
        failureReason:
          status === 'failed'
            ? stringField(detail, ['remark', 'failureReason']) ||
              'KuCoin Pay payout failed'
            : undefined,
        providerBatchId: batchNo || undefined,
        providerFee:
          stringField(detail, ['payoutFee']) ||
          stringField(payload, ['processingFee']) ||
          undefined,
        providerPayload: { detail, payload },
        requestId,
        status,
        symbol,
        txHash: stringField(detail, ['txHash', 'transactionHash']) || undefined,
        type: 'withdrawal' as const,
      },
    ]
  })
}

function isValidTronAddress(address: string) {
  return TRON_ADDRESS_PATTERN.test(address)
}

function mapPayoutError(error: unknown) {
  if (error instanceof KuCoinPayoutError) {
    return error
  }
  if (error instanceof KuCoinPayRequestError) {
    if (error.failureClass === 'throttled') {
      return new KuCoinPayoutError(error.message, 'retry_later')
    }
    if (error.failureClass === 'rejected') {
      return new KuCoinPayoutError(
        error.message,
        error.code === '480014' ||
          /insufficient|not enough|balance too low/iu.test(error.message)
          ? 'retry_later'
          : 'rejected',
      )
    }
    return new KuCoinPayoutError(error.message, 'unknown')
  }
  return new KuCoinPayoutError(errorMessage(error), 'unknown')
}

function mapCreateError(error: unknown) {
  if (error instanceof KuCoinPayRequestError) {
    if (error.failureClass === 'rejected') {
      return paymentError(error.message, 400)
    }
    if (error.failureClass === 'throttled') {
      return paymentError('KuCoin Pay is rate limited', 503)
    }
    return paymentError('KuCoin Pay is temporarily unavailable', 503)
  }
  return error
}

export class KuCoinPayAdapter {
  readonly providerCode = 'kucoinpay'
  private readonly client: KuCoinPayClient
  private readonly config: KuCoinPayConfig

  constructor(config: KuCoinPayConfig) {
    this.config = config
    this.client = new KuCoinPayClient(config)
  }

  createDeposit(
    input: KuCoinCreateDepositInput,
  ): Promise<KuCoinCreateDepositResult> {
    return this.createDepositInternal(input)
  }

  queryDeposit(
    input: KuCoinQueryDepositInput,
  ): Promise<KuCoinDepositEvent | null> {
    return this.queryDepositInternal(input)
  }

  quoteWithdrawal(input: KuCoinWithdrawalFeeInput) {
    return this.loadWithdrawalFee(input)
  }

  submitWithdrawal(
    input: KuCoinSubmitWithdrawalInput,
  ): Promise<KuCoinSubmitWithdrawalResult> {
    return this.submitWithdrawalInternal(input)
  }

  queryWithdrawal(
    requestId: string,
    batchId?: string,
  ): Promise<KuCoinWithdrawalEvent | null> {
    return this.queryWithdrawalInternal(requestId, batchId)
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): KuCoinWebhookResult {
    if (!this.isConfigured()) {
      throw paymentError('KuCoin Pay is not configured', 503)
    }
    const signature = headers['pay-api-sign']
    const timestamp = headers['pay-api-timestamp']
    const apiKey = this.config.apiKey ?? ''
    const publicKey = this.config.platformPublicKey ?? ''
    if (!signature || !timestamp || !apiKey || !publicKey) {
      throw paymentError('Missing KuCoin Pay signature headers', 400)
    }

    const payload = parsePayload(rawBody)
    const eventType = detectWebhookEventType(payload)
    if (!eventType) {
      throw paymentError('Unsupported KuCoin Pay callback type', 400)
    }
    const signingString = buildSignatureString({
      apiKey,
      fieldOrder: signatureFieldsForEvent(eventType),
      fields: payload,
      timestamp,
    })
    if (!verifySignature({ publicKey, signature, signingString })) {
      throw paymentError('Invalid KuCoin Pay callback signature', 400)
    }

    if (eventType === 'onchain_payment') {
      return { eventType, events: parseOnchainPayment(payload), payload }
    }
    if (eventType === 'payout') {
      return {
        eventType,
        events: parsePayout(payload),
        payload,
        reason: 'KuCoin Pay payout event',
      }
    }
    return {
      eventType,
      payload,
      reason: 'Off-chain payment events are not supported',
    }
  }

  isConfigured() {
    return isConfigured(this.config)
  }

  static isValidAddress(chain: string, address: string) {
    return toCanonicalChain(chain) === 'TRON' && isValidTronAddress(address)
  }

  private async createDepositInternal(
    input: KuCoinCreateDepositInput,
  ): Promise<KuCoinCreateDepositResult> {
    if (!this.isConfigured()) {
      throw paymentError('KuCoin Pay is not configured', 503)
    }
    const chain = toKuCoinChain(input.chain)
    const symbol = input.symbol.trim().toUpperCase()
    if (!chain || symbol !== 'USDT') {
      throw paymentError('KuCoin Pay currently supports TRC20 USDT only', 400)
    }

    try {
      const result = await this.client.createOnchainOrder({
        amount: input.amount,
        chain,
        currency: symbol,
        decimals: input.decimals,
        requestId: input.requestId,
      })
      return {
        address: result.address,
        appPayUrl: result.appPayUrl,
        expiresAt: new Date(result.expireTime),
        providerOrderId: result.payOrderId,
        providerPayload: {
          appPayUrl: result.appPayUrl,
          chain: result.chain,
          cryptoAmount: result.cryptoAmount,
          cryptoCurrency: result.cryptoCurrency,
          expireTime: result.expireTime,
          payOrderId: result.payOrderId,
          qrcodeUrl: result.qrcodeUrl,
          requestId: result.requestId,
        },
      }
    } catch (error) {
      throw mapCreateError(error)
    }
  }

  private async queryDepositInternal(
    input: KuCoinQueryDepositInput,
  ): Promise<KuCoinDepositEvent | null> {
    if (!this.isConfigured()) {
      throw paymentError('KuCoin Pay is not configured', 503)
    }
    const endTime = Date.now()
    const startTime = Math.max(
      input.createdAt.getTime() - 5 * 60 * 1000,
      endTime - 24 * 60 * 60 * 1000,
    )
    const orders = await this.client.queryOnchainOrders({
      address: input.address,
      currency: input.currency.toUpperCase(),
      endTime,
      requestId: input.requestId,
      startTime,
    })
    const order = orders.find(
      (candidate) => candidate.address === input.address,
    )
    if (!order) {
      return null
    }
    return parseQueriedOnchainOrder(order, input.requestId)[0] ?? null
  }
  private async loadWithdrawalFee(
    input: KuCoinWithdrawalFeeInput,
  ): Promise<KuCoinWithdrawalFeeResult> {
    if (!this.isConfigured()) {
      throw paymentError('KuCoin Pay is not configured', 503)
    }
    const chain = toKuCoinChain(input.chain)
    const symbol = input.symbol.trim().toUpperCase()
    if (!chain || symbol !== 'USDT' || input.decimals !== USDT_DECIMALS) {
      throw paymentError('KuCoin Pay currently supports TRC20 USDT only', 400)
    }
    if (input.amount <= 0n) {
      throw paymentError('Withdrawal amount must be positive', 400)
    }
    try {
      const quoted = await this.client.queryPayoutFee({
        amount: input.amount,
        chain,
        currency: symbol,
        decimals: input.decimals,
      })
      if (!quoted.withdrawFee) {
        throw paymentError('KuCoin Pay payout fee is unavailable', 503)
      }
      const fee = parseAmount(quoted.withdrawFee, input.decimals)
      if (fee >= input.amount) {
        throw paymentError('Withdrawal amount must exceed the network fee', 400)
      }
      return {
        fee,
        platformFee: input.platformFeeFixed ?? 0n,
        receiveAmount: input.amount - fee,
      }
    } catch (error) {
      throw mapCreateError(error)
    }
  }

  private async submitWithdrawalInternal(
    input: KuCoinSubmitWithdrawalInput,
  ): Promise<KuCoinSubmitWithdrawalResult> {
    if (!this.isConfigured()) {
      throw new KuCoinPayoutError('KuCoin Pay is not configured', 'unknown')
    }
    const chain = toKuCoinChain(input.chain)
    const symbol = input.symbol.trim().toUpperCase()
    if (!chain || symbol !== 'USDT' || input.decimals !== USDT_DECIMALS) {
      throw new KuCoinPayoutError(
        'KuCoin Pay currently supports TRC20 USDT only',
        'rejected',
      )
    }
    if (!KuCoinPayAdapter.isValidAddress(input.chain, input.toAddress)) {
      throw new KuCoinPayoutError('Invalid TRON payout address', 'rejected')
    }
    try {
      const fee = await this.loadWithdrawalFee(input)
      const payout = await this.client.createPayout({
        amount: input.amount,
        batchName: `VRF Game ${input.requestId}`,
        chain,
        currency: symbol,
        decimals: input.decimals,
        merchantRef: input.requestId,
        receiverAddress: input.toAddress,
      })
      return {
        externalRefId: payout.batchNo,
        fee: fee.fee,
        platformFee: fee.platformFee,
        status: 'processing',
      }
    } catch (error) {
      throw mapPayoutError(error)
    }
  }

  private async queryWithdrawalInternal(
    requestId: string,
    batchId?: string,
  ): Promise<KuCoinWithdrawalEvent | null> {
    if (!this.isConfigured()) {
      throw paymentError('KuCoin Pay is not configured', 503)
    }
    const batch = await this.client.queryPayout(requestId)
    if (!batch || (batchId && batch.batchNo && batch.batchNo !== batchId)) {
      return null
    }
    return (
      parsePayout({ ...batch }).find(
        (event) => event.requestId === requestId,
      ) ?? null
    )
  }
}
