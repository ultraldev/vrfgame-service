import * as z from 'zod'

export const Query = z.object({
  currency: z.string().optional(),
})

const Game = z.object({
  imageUrl: z.string().nullable(),
  isHot: z.boolean(),
  isNew: z.boolean(),
  name: z.string(),
  rtp: z.number().nullable(),
  slug: z.string(),
})

const Round = z.object({
  botShares: z.number().int(),
  capacity: z.number().int(),
  currency: z.string(),
  earlyWindowSec: z.number().int(),
  endsAt: z.string(),
  giftRemaining: z.number().int(),
  id: z.string(),
  myGiftShares: z.number().int(),
  myOutcome: z.enum(['none', 'open', 'won', 'lost', 'voided']),
  myShares: z.number().int(),
  payoutAmount: z.string(),
  roundNumber: z.number().int(),
  serverSeed: z.string().nullable(),
  serverSeedHash: z.string(),
  sharePrice: z.string(),
  sold: z.number().int(),
  soldGift: z.number().int(),
  startsAt: z.string(),
  status: z.string(),
  tauBps: z.number().int(),
  tauEarlyBps: z.number().int(),
  winProbabilityBps: z.number().int(),
  winnerIsPlatform: z.boolean(),
  winningNumber: z.number().int().nullable(),
})

const Raffle = z.object({
  category: z.string(),
  currency: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  lastRound: Round.nullable(),
  name: z.string(),
  payoutAmount: z.string(),
  round: Round.nullable(),
  skuId: z.string(),
  slug: z.string(),
  sortOrder: z.number().int(),
  tag: z.string().nullable(),
})

const Crate = z.object({
  coverUrl: z.string().nullable(),
  currency: z.string(),
  decimals: z.number().int(),
  id: z.string(),
  maxMultiplier: z.string(),
  name: z.string(),
  price: z.string(),
  rtpBps: z.number().int(),
  slug: z.string(),
  sortOrder: z.number().int(),
  tag: z.string().nullable(),
  version: z.number().int(),
})

export const Lobby = z.object({
  crates: z.array(Crate),
  games: z.array(Game),
  raffle: z.array(Raffle),
})

export const Games = z.array(Game)
export const Raffles = z.array(Raffle)
export const Crates = z.array(Crate)

z.globalRegistry.add(Game, { id: 'LobbyGame' })
z.globalRegistry.add(Round, { id: 'LobbyRaffleRound' })
z.globalRegistry.add(Raffle, { id: 'LobbyRaffle' })
z.globalRegistry.add(Crate, { id: 'LobbyCrate' })
z.globalRegistry.add(Lobby, { id: 'LobbyResponse' })
z.globalRegistry.add(Games, { id: 'LobbyGames' })
z.globalRegistry.add(Raffles, { id: 'LobbyRaffles' })
z.globalRegistry.add(Crates, { id: 'LobbyCrates' })
