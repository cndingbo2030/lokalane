import { places } from '../data/places'
import type { CountryCode, Place, UserMode } from '../domain/types'

export interface SearchOptions {
  country?: CountryCode | 'ALL'
  intent?: UserMode
  limit?: number
}

export function searchPlaces(query: string, options: SearchOptions = {}): Place[] {
  const normalizedQuery = normalize(query)
  const country = options.country ?? 'ALL'
  const limit = options.limit ?? 8

  const candidates = places.filter((place) => {
    return country === 'ALL' || place.country === country
  })

  if (!normalizedQuery) {
    return candidates
      .slice()
      .sort((a, b) => getRankScore(b, options.intent) - getRankScore(a, options.intent))
      .slice(0, limit)
  }

  return candidates
    .map((place) => ({ place, score: scorePlace(place, normalizedQuery, options.intent) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || b.place.confidence - a.place.confidence)
    .map((result) => result.place)
    .slice(0, limit)
}

export function getPlaceById(placeId: string) {
  return places.find((place) => place.id === placeId)
}

function scorePlace(place: Place, query: string, intent?: UserMode) {
  const searchable = [
    place.name,
    place.area,
    place.address,
    place.country,
    place.category,
    ...place.tags,
  ]
    .map(normalize)
    .join(' ')

  if (searchable.includes(query)) {
    return 100 + place.confidence * 10 + getIntentBoost(place, intent)
  }

  const tokens = query.split(' ').filter(Boolean)
  const matchedTokens = tokens.filter((token) => searchable.includes(token))
  if (matchedTokens.length === 0) {
    return 0
  }

  return matchedTokens.length * 24 + place.confidence * 10 + getIntentBoost(place, intent)
}

function getRankScore(place: Place, intent?: UserMode) {
  return place.confidence * 100 + getIntentBoost(place, intent)
}

function getIntentBoost(place: Place, intent?: UserMode) {
  if (!intent) {
    return 0
  }

  if (intent === 'visitor') {
    return categoryBoost(place, {
      food: 28,
      landmark: 20,
      mall: 12,
      transport: 8,
      condo: -8,
      hdb: -8,
      building: -6,
      parking: -10,
      medical: -16,
      checkpoint: -4,
      ev: -12,
    }) + tagBoost(place, ['attraction', 'hawker', 'food', 'hotel', 'garden', 'museum', 'tourist'])
  }

  if (intent === 'local') {
    return categoryBoost(place, {
      hdb: 22,
      transport: 18,
      building: 10,
      food: 8,
      mall: 6,
      parking: 4,
      checkpoint: 0,
      condo: 10,
      landmark: -2,
      medical: 0,
      ev: 0,
    })
  }

  if (intent === 'driver') {
    return categoryBoost(place, {
      parking: 24,
      checkpoint: 18,
      ev: 14,
      mall: 8,
      food: 4,
      building: 2,
      condo: 2,
      hdb: 2,
      transport: -6,
      landmark: 0,
      medical: 0,
    })
  }

  return categoryBoost(place, {
    transport: 26,
    hdb: 10,
    building: 6,
    mall: 4,
    food: 4,
    checkpoint: 4,
    condo: 4,
    parking: -10,
    landmark: 0,
    medical: 0,
    ev: -12,
  })
}

function categoryBoost(place: Place, boosts: Record<Place['category'], number>) {
  return boosts[place.category] ?? 0
}

function tagBoost(place: Place, tags: string[]) {
  const normalizedTags = place.tags.map(normalize)
  return tags.reduce((score, tag) => {
    return normalizedTags.some((item) => item.includes(tag)) ? score + 8 : score
  }, 0)
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}
