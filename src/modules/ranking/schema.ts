import * as z from 'zod'

import { RANKING_PERIOD_TYPES } from './util'

const Period = z.enum(RANKING_PERIOD_TYPES)

export const Query = z.object({
  period: Period.optional(),
})

const Entry = z.object({
  image: z.string().nullable(),
  name: z.string(),
  rank: z.number().int(),
  userId: z.string(),
  wagered: z.string(),
})

const Champion = z.object({
  amount: z.string(),
  bucketDate: z.string(),
  image: z.string().nullable(),
  name: z.string(),
  userId: z.string(),
  wagered: z.string(),
})

export const Board = z.object({
  bucketDate: z.string(),
  currency: z.string(),
  entries: z.array(Entry),
  lastChampion: Champion.nullable(),
  periodType: Period,
  poolAmount: z.string(),
  refreshesAt: z.string(),
})

export const Position = z.object({
  bucketDate: z.string(),
  inTopN: z.boolean(),
  periodType: Period,
  rank: z.number().int().nullable(),
  wagered: z.string(),
  wageredToReachTopN: z.string().nullable(),
})

z.globalRegistry.add(Entry, { id: 'RankingEntry' })
z.globalRegistry.add(Champion, { id: 'RankingChampion' })
z.globalRegistry.add(Board, { id: 'RankingBoard' })
z.globalRegistry.add(Position, { id: 'RankingPosition' })
