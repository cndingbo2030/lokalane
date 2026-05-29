import type { CountryCode, Place, ProviderSignal, UserMode } from '../domain/types'
import { hasOneMapProxy, oneMapResultToPlace, searchOneMapProxy } from './onemap'
import { searchPlaces } from './search'

export interface HybridSearchOptions {
  country: CountryCode | 'ALL'
  limit?: number
  userMode?: UserMode
  fetcher?: typeof fetch
}

export interface HybridSearchResult {
  places: Place[]
  signals: ProviderSignal[]
}

export async function hybridSearch(
  query: string,
  options: HybridSearchOptions,
): Promise<HybridSearchResult> {
  const limit = options.limit ?? 8
  const localPlaces = searchPlaces(query, {
    country: options.country,
    intent: options.userMode,
    limit,
  })

  const baseSignals: ProviderSignal[] = [
    {
      id: 'lokalane-curated',
      status: 'success',
      label: 'Curated seed',
      message: `${localPlaces.length} instant local result${localPlaces.length === 1 ? '' : 's'}`,
    },
  ]

  if (options.country === 'MY') {
    return {
      places: localPlaces,
      signals: [
        ...baseSignals,
        {
          id: 'openstreetmap',
          status: 'ready',
          label: 'Malaysia fallback',
          message: 'OSM-backed coverage until MY official/commercial feeds are added',
        },
      ],
    }
  }

  if (!hasOneMapProxy()) {
    return {
      places: localPlaces,
      signals: [
        ...baseSignals,
        {
          id: 'onemap',
          status: 'unconfigured',
          label: 'OneMap live',
          message: 'Official SG search will activate after provider setup',
        },
      ],
    }
  }

  const trimmedQuery = query.trim()
  if (trimmedQuery.length < 2) {
    return {
      places: localPlaces,
      signals: [
        ...baseSignals,
        {
          id: 'onemap',
          status: 'idle',
          label: 'OneMap live',
          message: 'Type at least 2 characters for official SG search',
        },
      ],
    }
  }

  const startedAt = performance.now()

  try {
    const oneMapPlaces = (await searchOneMapProxy(trimmedQuery, options.fetcher)).map(
      oneMapResultToPlace,
    )
    const latencyMs = Math.round(performance.now() - startedAt)
    const mergedPlaces = mergePlaces(localPlaces, oneMapPlaces, limit)

    return {
      places: mergedPlaces,
      signals: [
        ...baseSignals,
        {
          id: 'onemap',
          status: 'success',
          label: 'OneMap live',
          message: `${oneMapPlaces.length} official SG result${oneMapPlaces.length === 1 ? '' : 's'}`,
          latencyMs,
        },
      ],
    }
  } catch {
    return {
      places: localPlaces,
      signals: [
        ...baseSignals,
        {
          id: 'onemap',
          status: 'error',
          label: 'OneMap live',
          message: 'Official search unavailable; showing trusted local fallback',
        },
      ],
    }
  }
}

export function mergePlaces(primary: Place[], secondary: Place[], limit: number) {
  const seen = new Set<string>()
  const merged: Place[] = []

  for (const place of [...secondary, ...primary]) {
    const key = placeKey(place)
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    merged.push(place)
  }

  return merged.slice(0, limit)
}

function placeKey(place: Place) {
  const postal = place.address.match(/\b\d{6}\b/)?.[0]
  if (postal) {
    return `${place.country}-${postal}`
  }

  return `${place.country}-${place.name.trim().toLowerCase()}-${place.area
    .trim()
    .toLowerCase()}`
}
