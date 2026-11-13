export const DEFAULT_GAME_RTP_BPS = 9600
const MIN_GAME_RTP_BPS = 100
const MAX_GAME_RTP_BPS = 9999

export function clampRtpBps(value: number) {
  return Math.min(
    MAX_GAME_RTP_BPS,
    Math.max(MIN_GAME_RTP_BPS, Math.round(value)),
  )
}

export function rtpBpsToHouseEdgeBps(rtpBps: number) {
  return 10_000 - rtpBps
}
