import { errorMessage } from '@/lib/errors'
import { formatAmount } from '@/lib/money'
import { isRecord } from '@/lib/object'

import { KuCoinPayRequestError } from './errors'
import { buildSignatureString, signRequest } from './signature'
import {
  businessFailureClass,
  failureClassForResponse,
  numberField,
  optionalString,
  requiredOption,
  stringField,
} from './util'

const CREATE_ORDER_FIELDS = [
  'apiKey',
  'chain',
  'cryptoAmount',
  'cryptoCurrency',
  'fiatAmount',
  'fiatCurrency',
  'requestId',
  'subMerchantId',
  'timestamp',
] as const

const CREATE_PAYOUT_FIELDS = [
  'apiKey',
  'batchName',
  'bizScene',
  'chain',
  'currency',
  'payoutType',
  'requestId',
  'timestamp',
  'totalAmount',
  'totalCount',
] as const

const QUERY_PAYOUT_FIELDS = [
  'apiKey',
  'detailStatus',
  'requestId',
  'timestamp',
] as const

const QUERY_PAYOUT_FEE_FIELDS = [
  'apiKey',
  'chain',
  'currency',
  'receivedAmount',
  'timestamp',
] as const

const QUERY_ONCHAIN_ORDER_FIELDS = [
  'apiKey',
  'currency',
  'endTime',
  'startTime',
  'status',
  'timestamp',
  'uniqueId',
] as const

export interface KuCoinPayConfig {
  apiBaseUrl: string
  apiKey?: string
  platformPublicKey?: string
  privateKey?: string
  relayAuthBase64?: string
  subMerchantId?: string
}

export interface KuCoinPayOrder {
  address: string
  appPayUrl?: string
  chain: string
  cryptoAmount: string
  cryptoCurrency: string
  expireTime: number
  payOrderId: string
  qrcodeUrl?: string
  requestId: string
}

export interface KuCoinPayPayoutDetail {
  amount?: string
  detailId?: string
  payoutFee?: string | null
  receiverAddress?: string | null
  receiverUID?: string | null
  remark?: string | null
  status?: string
}

export interface KuCoinPayPayoutBatch {
  batchName?: string
  batchNo?: string
  chain?: string
  currency?: string
  payoutType?: string
  processingFee?: string
  requestId?: string
  status?: string
  totalAmount?: string
  totalCount?: number
  totalPaidAmount?: string
  totalPayoutFee?: string
  withdrawDetailDtoList?: KuCoinPayPayoutDetail[]
}

export interface KuCoinPayCreatePayoutResult {
  batchNo: string
  requestId: string
}

export interface KuCoinPayPayoutFee {
  maxWithdraw?: string
  withdrawAmount?: string
  withdrawFee?: string
  withdrawFeeRate?: string
  withdrawMaxFee?: string
  withdrawMinFee?: string
  withdrawMinSize?: string
}

export interface KuCoinPayOnchainOrder {
  address?: string
  assetUniqueId?: string
  chain?: string
  cryptoAmount?: string
  cryptoCurrency?: string
  expireTime?: number
  payOrderId?: string
  paymentAmount?: string
  paymentChain?: string
  paymentCurrency?: string
  paymentOrderType?: string
  paymentStatus?: string
  requestId?: string
  status?: string
}

export class KuCoinPayClient {
  private readonly config: KuCoinPayConfig

  constructor(config: KuCoinPayConfig) {
    this.config = config
  }

  async createOnchainOrder(params: {
    amount: bigint
    chain: string
    currency: string
    decimals: number
    requestId: string
  }): Promise<KuCoinPayOrder> {
    const cryptoAmount = formatAmount(params.amount, params.decimals)
    const data = await this.post<Record<string, unknown>>(
      '/api/v1/onchain/payment/create',
      CREATE_ORDER_FIELDS,
      {
        chain: params.chain,
        cryptoAmount,
        cryptoCurrency: params.currency,
        expireTime: 30 * 60 * 1000,
        goods: [
          {
            goodsDesc: 'USDT wallet deposit',
            goodsId: 'vrfgame-wallet-topup',
            goodsName: 'VRF Game account balance top-up',
          },
        ],
        requestId: params.requestId,
        subMerchantId: requiredOption(
          this.config.subMerchantId,
          'KUCOIN_PAY_SUB_MERCHANT_ID',
        ),
      },
    )
    const address = stringField(data, ['address'])
    const payOrderId = stringField(data, ['payOrderId'])
    const expireTime = numberField(data, ['expireTime'])
    if (!address || !payOrderId || expireTime === null) {
      throw new KuCoinPayRequestError(
        'KuCoin Pay create order returned incomplete data',
        'server',
      )
    }

    return {
      address,
      appPayUrl: optionalString(stringField(data, ['appPayUrl'])),
      chain: stringField(data, ['chain']) || params.chain,
      cryptoAmount: stringField(data, ['cryptoAmount']) || cryptoAmount,
      cryptoCurrency: stringField(data, ['cryptoCurrency']) || params.currency,
      expireTime,
      payOrderId,
      qrcodeUrl: optionalString(stringField(data, ['qrcodeUrl'])),
      requestId: stringField(data, ['requestId']) || params.requestId,
    }
  }

  async createPayout(params: {
    amount: bigint
    batchName: string
    chain: string
    currency: string
    decimals: number
    merchantRef: string
    receiverAddress: string
  }): Promise<KuCoinPayCreatePayoutResult> {
    const amount = formatAmount(params.amount, params.decimals)
    const data = await this.post<Record<string, unknown>>(
      '/api/v1/withdraw/batch/create',
      CREATE_PAYOUT_FIELDS,
      {
        batchName: params.batchName,
        bizScene: 'MERCHANT_PAYMENT',
        chain: params.chain,
        currency: params.currency,
        payoutType: 'onChain',
        requestId: params.merchantRef,
        totalAmount: amount,
        totalCount: 1,
        withdrawDetailDtoList: [
          {
            amount,
            detailId: params.merchantRef,
            receiverAddress: params.receiverAddress,
            remark: 'VRF Game withdrawal',
          },
        ],
      },
    )
    const batchNo = stringField(data, ['batchNo'])
    if (!batchNo) {
      throw new KuCoinPayRequestError(
        'KuCoin Pay payout returned no batch number',
        'server',
      )
    }

    return {
      batchNo,
      requestId: stringField(data, ['requestId']) || params.merchantRef,
    }
  }

  async queryPayoutFee(params: {
    amount: bigint
    chain: string
    currency: string
    decimals: number
  }): Promise<KuCoinPayPayoutFee> {
    const data = await this.post<Record<string, unknown>>(
      '/api/v1/withdraw/fee/query',
      QUERY_PAYOUT_FEE_FIELDS,
      {
        chain: params.chain,
        currency: params.currency,
        receivedAmount: formatAmount(params.amount, params.decimals),
      },
    )
    if (!isRecord(data)) {
      throw new KuCoinPayRequestError(
        'KuCoin Pay payout fee query returned invalid data',
        'server',
      )
    }

    return {
      maxWithdraw: optionalString(stringField(data, ['maxWithdraw'])),
      withdrawAmount: optionalString(stringField(data, ['withdrawAmount'])),
      withdrawFee: optionalString(stringField(data, ['withdrawFee'])),
      withdrawFeeRate: optionalString(stringField(data, ['withdrawFeeRate'])),
      withdrawMaxFee: optionalString(stringField(data, ['withdrawMaxFee'])),
      withdrawMinFee: optionalString(stringField(data, ['withdrawMinFee'])),
      withdrawMinSize: optionalString(stringField(data, ['withdrawMinSize'])),
    }
  }

  async queryOnchainOrders(params: {
    address: string
    currency: string
    requestId: string
    startTime: number
    endTime: number
  }): Promise<KuCoinPayOnchainOrder[]> {
    const data = await this.post<Record<string, unknown>>(
      '/api/v1/onchain/recharge/order/query',
      QUERY_ONCHAIN_ORDER_FIELDS,
      {
        address: params.address,
        currency: params.currency,
        endTime: params.endTime,
        pageNum: 1,
        pageSize: 20,
        startTime: params.startTime,
        uniqueId: params.requestId,
      },
    )
    if (!isRecord(data) || !Array.isArray(data.items)) {
      throw new KuCoinPayRequestError(
        'KuCoin Pay on-chain order query returned invalid data',
        'server',
      )
    }
    return data.items.filter(isRecord).map((item) => ({
      address: optionalString(stringField(item, ['address'])),
      assetUniqueId: optionalString(stringField(item, ['assetUniqueId'])),
      chain: optionalString(stringField(item, ['chain'])),
      cryptoAmount: optionalString(stringField(item, ['cryptoAmount'])),
      cryptoCurrency: optionalString(stringField(item, ['cryptoCurrency'])),
      expireTime: numberField(item, ['expireTime']) ?? undefined,
      payOrderId: optionalString(stringField(item, ['payOrderId'])),
      paymentAmount: optionalString(stringField(item, ['paymentAmount'])),
      paymentChain: optionalString(stringField(item, ['paymentChain'])),
      paymentCurrency: optionalString(stringField(item, ['paymentCurrency'])),
      paymentOrderType: optionalString(stringField(item, ['paymentOrderType'])),
      paymentStatus: optionalString(stringField(item, ['paymentStatus'])),
      requestId: optionalString(stringField(item, ['requestId'])),
      status: optionalString(stringField(item, ['status'])),
    }))
  }

  async queryPayout(requestId: string): Promise<KuCoinPayPayoutBatch | null> {
    const data = await this.post<Record<string, unknown>>(
      '/api/v1/withdraw/batch/query',
      QUERY_PAYOUT_FIELDS,
      { detailStatus: 'ALL', requestId },
    )
    if (!isRecord(data)) {
      return null
    }

    return {
      batchName: optionalString(stringField(data, ['batchName'])),
      batchNo: optionalString(stringField(data, ['batchNo'])),
      chain: optionalString(stringField(data, ['chain'])),
      currency: optionalString(stringField(data, ['currency'])),
      payoutType: optionalString(stringField(data, ['payoutType'])),
      processingFee: optionalString(stringField(data, ['processingFee'])),
      requestId: optionalString(stringField(data, ['requestId'])),
      status: optionalString(stringField(data, ['status'])),
      totalAmount: optionalString(stringField(data, ['totalAmount'])),
      totalCount:
        typeof data.totalCount === 'number' ? data.totalCount : undefined,
      totalPaidAmount: optionalString(stringField(data, ['totalPaidAmount'])),
      totalPayoutFee: optionalString(stringField(data, ['totalPayoutFee'])),
      withdrawDetailDtoList: Array.isArray(data.withdrawDetailDtoList)
        ? data.withdrawDetailDtoList.filter(isRecord).map((detail) => ({
            amount: optionalString(stringField(detail, ['amount'])),
            detailId: optionalString(stringField(detail, ['detailId'])),
            payoutFee: optionalString(stringField(detail, ['payoutFee'])),
            receiverAddress: optionalString(
              stringField(detail, ['receiverAddress']),
            ),
            receiverUID: optionalString(stringField(detail, ['receiverUID'])),
            remark: optionalString(stringField(detail, ['remark'])),
            status: optionalString(stringField(detail, ['status'])),
          }))
        : undefined,
    }
  }

  private async post<T>(
    path: string,
    fieldOrder: readonly string[],
    fields: Record<string, unknown>,
  ): Promise<T> {
    const apiKey = requiredOption(this.config.apiKey, 'KUCOIN_PAY_API_KEY')
    const privateKey = requiredOption(
      this.config.privateKey,
      'KUCOIN_PAY_PRIVATE_KEY',
    )
    const timestamp = Date.now().toString()
    const signingString = buildSignatureString({
      apiKey,
      fieldOrder,
      fields,
      timestamp,
    })
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'PAY-API-KEY': apiKey,
      'PAY-API-SIGN': signRequest(signingString, privateKey),
      'PAY-API-TIMESTAMP': timestamp,
      'PAY-API-VERSION': '1.0',
    }
    if (this.config.relayAuthBase64) {
      headers.Authorization = `Basic ${this.config.relayAuthBase64}`
    }

    let response: Response
    try {
      response = await fetch(
        `${this.config.apiBaseUrl.replace(/\/$/u, '')}${path}`,
        {
          body: JSON.stringify(fields),
          headers,
          method: 'POST',
          signal: AbortSignal.timeout(20_000),
        },
      )
    } catch (error) {
      throw new KuCoinPayRequestError(
        `KuCoin Pay request failed: ${errorMessage(error)}`,
        'transport',
      )
    }

    const text = await response.text().catch(() => '')
    let payload: unknown
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }

    if (!response.ok) {
      const message =
        isRecord(payload) && typeof payload.msg === 'string'
          ? payload.msg
          : `HTTP ${response.status}`
      throw new KuCoinPayRequestError(
        `KuCoin Pay request rejected: ${message}`,
        failureClassForResponse(response.status, payload),
        isRecord(payload) ? stringField(payload, ['code']) : undefined,
      )
    }

    if (!isRecord(payload) || payload.success !== true) {
      const message =
        isRecord(payload) && typeof payload.msg === 'string'
          ? payload.msg
          : 'invalid API response'
      const code = isRecord(payload)
        ? stringField(payload, ['code'])
        : undefined
      throw new KuCoinPayRequestError(
        `KuCoin Pay request rejected: ${message}`,
        businessFailureClass(payload),
        code,
      )
    }

    const data =
      payload.data ?? (Array.isArray(payload.items) ? payload : undefined)
    if (data === undefined || data === null) {
      throw new KuCoinPayRequestError(
        'KuCoin Pay returned no response data',
        'server',
      )
    }
    return data as T
  }
}
