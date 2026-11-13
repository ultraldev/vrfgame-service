export const SOCKET_EVENTS = {
  bet: 'crash:bet',
  betCancelled: 'crash:bet_cancelled',
  betPlaced: 'crash:bet_placed',
  cancel: 'crash:cancel',
  cashout: 'crash:cashout',
  connected: 'connected',
  getSnapshot: 'crash:get_snapshot',
  multiplier: 'crash:multiplier',
  nextRound: 'crash:next_round',
  phase: 'crash:phase',
  ping: 'ping',
  pong: 'pong',
  roundCrashed: 'crash:round_crashed',
  roundStarted: 'crash:round_started',
  snapshot: 'crash:snapshot',
  walletBalanceUpdate: 'wallet:balance_update',
} as const

export const REALTIME_CHANNEL = 'vrfgame:realtime'

export interface RealtimeMessage {
  data: unknown
  event: string
  userId?: string
}

export function userChannel(userId: string) {
  return `user:${userId}`
}
