export interface ZeffraConfig {
  apiBaseUrl: string
  authReturnUrl?: string
  enable3ds: boolean
  merchantCode?: string
  notifyUrl?: string
  privateKey?: string
  publicKey?: string
  website?: string
}

export interface ZeffraBilling {
  address1?: string
  address2?: string
  city?: string
  country?: string
  email?: string
  firstName?: string
  lastName?: string
  phone?: string
  postalCode?: string
  state?: string
}

export interface ZeffraDevice {
  browser?: string
  cardInputMethod?: 'typed' | 'pasted'
  clientIp: string
  cookie?: string
  language?: string
  os?: string
  screenResolution?: string
  timezone?: string
}

export interface ZeffraRecipient {
  address: string
  birthday?: string
  city: string
  country: string
  email: string
  firstName: string
  lastName: string
  phone: string
  postalCode: string
  state: string
}

export interface ZeffraDepositInput {
  amount: bigint
  authReturnUrl: string
  billing: ZeffraBilling
  currency: string
  device: ZeffraDevice
  merchantOrderNo: string
  notifyUrl: string
  providerPaymentCode: string
  userId: string
  userRegisteredAt: number
}

export interface ZeffraDepositResult {
  authUrl?: string
  needAuth: boolean
  providerOrderNo: string
}

export interface ZeffraPayoutInput {
  amount: bigint
  bankCode?: string
  currency: string
  ext1?: string
  ext2?: string
  ext3?: string
  merchantOrderNo: string
  notifyUrl: string
  providerPaymentCode: string
  receiveAccount: string
  receiveAccountExpireAt?: string
  recipient: ZeffraRecipient
  userId: string
}

export interface ZeffraPayoutResult {
  confirmUrl?: string
  needUserConfirm: boolean
  providerOrderNo: string
}

export type ZeffraOrderStatus = 'pending' | 'succeeded' | 'failed'

export interface ZeffraDepositQuery {
  failReason?: string
  found: boolean
  providerOrderNo?: string
  providerPayload?: Record<string, unknown>
  status?: ZeffraOrderStatus
}

export interface ZeffraPayoutQuery extends ZeffraDepositQuery {
  confirmUrl?: string
  needUserConfirm?: boolean
}

export type ZeffraEventType = 'deposit' | 'payout' | 'refund'

export interface ZeffraEvent {
  amount: string
  currency?: string
  failReason?: string
  merchantOrderNo: string
  providerOrderNo: string
  providerPayload: Record<string, unknown>
  status: ZeffraOrderStatus
  type: ZeffraEventType
}
