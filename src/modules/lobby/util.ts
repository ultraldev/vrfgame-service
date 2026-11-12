const LIMIT = 6
const TAGS = {
  featured: 12,
  hot: 40,
  new: 25,
} as const
const COVERS = ['thumbnail', 'icon', 'banner'] as const

interface Tags {
  featured?: boolean
  hot?: boolean
  new?: boolean
}

interface Weights {
  popularity: number
  rtp: number
  value: number
}

interface Candidate {
  id: string
  popularity?: number | null
  rtpBps?: number | null
  sortOrder: number
  tags: Tags
  value?: number | null
}

export const GAMES: Weights = {
  popularity: 30,
  rtp: 30,
  value: 0,
}

function points(tags: Tags) {
  return (
    (tags.hot ? TAGS.hot : 0) +
    (tags.new ? TAGS.new : 0) +
    (tags.featured ? TAGS.featured : 0)
  )
}

function finite(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function normalize(values: number[]) {
  if (values.length === 0) {
    return []
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  return span === 0
    ? values.map(() => 0)
    : values.map((value) => (value - min) / span)
}

function rank<T extends Candidate>(
  items: T[],
  weights: Weights,
  limit = LIMIT,
) {
  const rtpValues = normalize(items.map((item) => finite(item.rtpBps)))
  const popularity = normalize(
    items.map((item) => Math.log1p(Math.max(0, finite(item.popularity)))),
  )
  const value = normalize(
    items.map((item) => Math.log1p(Math.max(0, finite(item.value)))),
  )

  return items
    .map((item, index) => ({
      item,
      score:
        points(item.tags) +
        weights.rtp * (rtpValues[index] ?? 0) +
        weights.popularity * (popularity[index] ?? 0) +
        weights.value * (value[index] ?? 0),
    }))
    .toSorted((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score
      }
      if (a.item.sortOrder !== b.item.sortOrder) {
        return a.item.sortOrder - b.item.sortOrder
      }
      return a.item.id.localeCompare(b.item.id)
    })
    .slice(0, limit)
    .map((row) => row.item)
}

export function games<T extends Candidate>(items: T[]) {
  return rank(items, GAMES)
}

export function ordered<T extends Candidate>(items: T[]) {
  return items
    .map((item) => ({ item, score: points(item.tags) }))
    .toSorted((a, b) => {
      if (a.item.sortOrder !== b.item.sortOrder) {
        return a.item.sortOrder - b.item.sortOrder
      }
      if (b.score !== a.score) {
        return b.score - a.score
      }
      return a.item.id.localeCompare(b.item.id)
    })
    .slice(0, LIMIT)
    .map((row) => row.item)
}

export function cover(
  assets: {
    locale: string
    sortOrder?: number | null
    type: string
    url: string
  }[],
) {
  for (const type of COVERS) {
    const matches = assets
      .filter((asset) => asset.type === type)
      .toSorted((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    const match = matches.find((asset) => asset.locale === 'en') ?? matches[0]
    if (match) {
      return match.url
    }
  }
  return null
}

export function multiplier(centi: number) {
  return `${Math.floor(centi / 100)}.${Math.abs(centi % 100)
    .toString()
    .padStart(2, '0')}`
}

export function rtp(
  items: { payout: bigint | string; weight: number }[],
  basePrice: bigint,
) {
  const weight = items.reduce((sum, item) => sum + item.weight, 0)
  if (weight <= 0 || basePrice <= 0n) {
    return 0
  }
  const weighted = items.reduce(
    (sum, item) => sum + BigInt(item.weight) * BigInt(item.payout),
    0n,
  )
  return Number((weighted * 10_000n) / (basePrice * BigInt(weight)))
}

export function gift(capacity: number, bps: number) {
  return Math.floor((capacity * bps) / 10_000)
}

export function outcome(input: {
  myShares: number
  status: string
  userId?: string
  winnerIsPlatform: boolean
  winnerUserId: string | null
}) {
  if (input.myShares <= 0) {
    return 'none' as const
  }
  if (input.status === 'voided') {
    return 'voided' as const
  }
  if (input.status === 'open' || input.status === 'drawing') {
    return 'open' as const
  }
  if (
    input.status === 'settled' &&
    input.userId &&
    !input.winnerIsPlatform &&
    input.winnerUserId === input.userId
  ) {
    return 'won' as const
  }
  return input.status === 'settled' ? ('lost' as const) : ('none' as const)
}
