import type { Coordinates, Place } from '../domain/types'

export interface OneMapSearchResult {
  id: string
  name: string
  address: string
  coordinates: Coordinates
  confidence: number
}

export interface OneMapProxyResponse {
  found: number
  results: OneMapSearchResult[]
}

export function hasOneMapProxy() {
  return Boolean(import.meta.env.VITE_LOKALANE_API_BASE)
}

export async function searchOneMapProxy(
  query: string,
  fetcher: typeof fetch = fetch,
): Promise<OneMapSearchResult[]> {
  const apiBase = import.meta.env.VITE_LOKALANE_API_BASE
  if (!apiBase || query.trim().length < 2) {
    return []
  }

  const url = new URL('/onemap/search', apiBase)
  url.searchParams.set('q', query)

  const response = await fetcher(url)
  if (!response.ok) {
    throw new Error(`OneMap proxy failed with ${response.status}`)
  }

  const payload = (await response.json()) as OneMapProxyResponse
  return payload.results
}

export function oneMapResultToPlace(result: OneMapSearchResult): Place {
  return {
    id: `onemap-${result.id}`,
    name: result.name,
    category: 'landmark',
    country: 'SG',
    area: 'Singapore',
    address: result.address,
    coordinates: result.coordinates,
    sourceId: 'onemap',
    confidence: result.confidence,
    tags: ['onemap', 'search'],
    signal: 'Live OneMap search result',
    updatedAt: new Date().toISOString().slice(0, 10),
  }
}
