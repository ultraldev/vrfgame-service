import type { FastifyBaseLogger } from 'fastify'
import type Redis from 'ioredis'

import { BackgroundJobs } from '@/lib/jobs'
import { redisLeaderLock } from '@/lib/leader'

import type { CryptoDepositService } from './crypto/deposit'
import type { CryptoWithdrawalService } from './crypto/withdrawal'
import type { FiatDepositService } from './fiat/deposit'
import type { FiatPayoutService } from './fiat/payout'

const DEPOSIT_TICK_MS = 30_000
const WITHDRAWAL_SUBMIT_MS = 10_000
const WITHDRAWAL_RECONCILE_MS = 60_000

interface PaymentRuntimeOptions {
  cryptoDeposit: CryptoDepositService
  cryptoWithdrawal: CryptoWithdrawalService
  fiatDeposit: FiatDepositService
  fiatPayout: FiatPayoutService
  logger: FastifyBaseLogger
  redis: Redis
}

export class PaymentRuntime {
  private readonly cryptoDeposit: CryptoDepositService
  private readonly cryptoWithdrawal: CryptoWithdrawalService
  private readonly fiatDeposit: FiatDepositService
  private readonly fiatPayout: FiatPayoutService
  private readonly jobs: BackgroundJobs
  private readonly logger: FastifyBaseLogger

  constructor(options: PaymentRuntimeOptions) {
    this.cryptoDeposit = options.cryptoDeposit
    this.cryptoWithdrawal = options.cryptoWithdrawal
    this.fiatDeposit = options.fiatDeposit
    this.fiatPayout = options.fiatPayout
    this.logger = options.logger
    this.jobs = new BackgroundJobs(
      redisLeaderLock(options.redis),
      options.logger,
      [
        {
          intervalMs: DEPOSIT_TICK_MS,
          leaderKey: 'payments:crypto-deposit-expire:leader',
          name: 'crypto:deposit-expire',
          run: () => this.expireCryptoDeposits(),
        },
        {
          intervalMs: DEPOSIT_TICK_MS,
          leaderKey: 'payments:crypto-deposit-reconcile:leader',
          name: 'crypto:deposit-reconcile',
          run: () => this.reconcileCryptoDeposits(),
        },
        {
          intervalMs: WITHDRAWAL_SUBMIT_MS,
          leaderKey: 'payments:crypto-withdrawal-submit:leader',
          name: 'crypto:withdrawal-submit',
          run: () => this.submitCryptoWithdrawals(),
        },
        {
          intervalMs: WITHDRAWAL_RECONCILE_MS,
          leaderKey: 'payments:crypto-withdrawal-reconcile:leader',
          name: 'crypto:withdrawal-reconcile',
          run: () => this.reconcileCryptoWithdrawals(),
        },
        {
          intervalMs: DEPOSIT_TICK_MS,
          leaderKey: 'payments:fiat-deposit-expire:leader',
          name: 'fiat:deposit-expire',
          run: () => this.expireFiatDeposits(),
        },
        {
          intervalMs: DEPOSIT_TICK_MS,
          leaderKey: 'payments:fiat-deposit-reconcile:leader',
          name: 'fiat:deposit-reconcile',
          run: () => this.reconcileFiatDeposits(),
        },
        {
          intervalMs: WITHDRAWAL_SUBMIT_MS,
          leaderKey: 'payments:fiat-payout-submit:leader',
          name: 'fiat:payout-submit',
          run: () => this.submitFiatPayouts(),
        },
        {
          intervalMs: WITHDRAWAL_RECONCILE_MS,
          leaderKey: 'payments:fiat-payout-reconcile:leader',
          name: 'fiat:payout-reconcile',
          run: () => this.reconcileFiatPayouts(),
        },
      ],
    )
  }

  async start() {
    await this.jobs.start()
    this.logger.info(
      { instanceId: this.jobs.instanceId },
      'Payment runtime ready',
    )
  }

  async stop() {
    await this.jobs.stop()
  }

  getStatuses() {
    return this.jobs.getStatuses()
  }

  private async expireCryptoDeposits() {
    const expired = await this.cryptoDeposit.expireDeposits()
    if (expired > 0) {
      this.logger.info({ expired }, 'Crypto deposits expired')
    }
  }

  private async reconcileCryptoDeposits() {
    const reconciled = await this.cryptoDeposit.reconcileDeposits()
    if (reconciled > 0) {
      this.logger.info({ reconciled }, 'Crypto deposits reconciled')
    }
  }

  private async submitCryptoWithdrawals() {
    const submitted = await this.cryptoWithdrawal.processPending()
    if (submitted > 0) {
      this.logger.info({ submitted }, 'Crypto withdrawals submitted')
    }
  }

  private async reconcileCryptoWithdrawals() {
    const reconciled = await this.cryptoWithdrawal.reconcileWithdrawals()
    if (reconciled > 0) {
      this.logger.info({ reconciled }, 'Crypto withdrawals reconciled')
    }
  }

  private async expireFiatDeposits() {
    const expired = await this.fiatDeposit.expireDeposits()
    if (expired > 0) {
      this.logger.info({ expired }, 'Fiat deposits expired')
    }
  }

  private async reconcileFiatDeposits() {
    const reconciled = await this.fiatDeposit.reconcileDeposits()
    if (reconciled > 0) {
      this.logger.info({ reconciled }, 'Fiat deposits reconciled')
    }
  }

  private async submitFiatPayouts() {
    const submitted = await this.fiatPayout.processPending()
    if (submitted > 0) {
      this.logger.info({ submitted }, 'Fiat payouts submitted')
    }
  }

  private async reconcileFiatPayouts() {
    const reconciled = await this.fiatPayout.reconcilePayouts()
    if (reconciled > 0) {
      this.logger.info({ reconciled }, 'Fiat payouts reconciled')
    }
  }
}
