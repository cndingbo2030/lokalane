import { places } from '../data/places'
import type { CountryCode, Place } from '../domain/types'

export interface SearchOptions {
  country?: CountryCode | 'ALL'
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
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit)
  }

  return candidates
    .map((place) => ({ place, score: scorePlace(place, normalizedQuery) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || b.place.confidence - a.place.confidence)
    .map((result) => result.place)
    .slice(0, limit)
}

export function getPlaceById(placeId: string) {
  return places.find((place) => place.id === placeId)
}

function scorePlace(place: Place, query: string) {
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
    return 100 + place.confidence * 10
  }

  const tokens = query.split(' ').filter(Boolean)
  const matchedTokens = tokens.filter((token) => searchable.includes(token))
  if (matchedTokens.length === 0) {
    return 0
  }

  return matchedTokens.length * 24 + place.confidence * 10
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}
