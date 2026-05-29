import type { Coordinates, Place, PlaceCategory } from '../domain/types'

export interface OneMapSearchResult {
  id: string
  name: string
  address: string
  category?: PlaceCategory
  coordinates: Coordinates
  confidence: number
  tags?: string[]
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
  const category = result.category ?? inferOneMapCategory(result)

  return {
    id: `onemap-${result.id}`,
    name: result.name,
    category,
    country: 'SG',
    area: inferArea(result.address),
    address: result.address,
    coordinates: result.coordinates,
    sourceId: 'onemap',
    confidence: result.confidence,
    tags: ['onemap', 'official-address', category, ...(result.tags ?? [])],
    signal: getOneMapSignal(category),
    updatedAt: new Date().toISOString().slice(0, 10),
  }
}

function inferOneMapCategory(result: Pick<OneMapSearchResult, 'name' | 'address'>): PlaceCategory {
  const value = `${result.name} ${result.address}`.toLowerCase()

  if (/\bblk\b|hdb|punggol|ang mo kio|tampines|yishun|woodlands|sengkang|jurong|bedok/.test(value)) {
    return 'hdb'
  }

  if (/\bcondo\b|condominium|residences|residence|suite|suites|apartment|apartments/.test(value)) {
    return 'condo'
  }

  if (/mrt|lrt|bus interchange|terminal|station/.test(value)) {
    return 'transport'
  }

  if (/hawker|food|restaurant|cafe|coffee|market|satay/.test(value)) {
    return 'food'
  }

  if (/mall|square|plaza|shopping|centre|center/.test(value)) {
    return 'mall'
  }

  if (/hospital|clinic|medical/.test(value)) {
    return 'medical'
  }

  if (/car park|carpark|parking/.test(value)) {
    return 'parking'
  }

  return 'building'
}

function inferArea(address: string) {
  const withoutPostal = address.replace(/\bSINGAPORE\s+\d{6}\b/i, '').trim()
  const roadMatch = withoutPostal.match(/\b([A-Z][A-Z\s']+(?:ROAD|STREET|AVENUE|AVE|LANE|LINK|DRIVE|CRESCENT|WALK|WAY|CLOSE|PLACE|VIEW|RISE|TERRACE|BOULEVARD))\b/i)
  if (roadMatch?.[1]) {
    return titleCase(roadMatch[1])
  }

  return 'Singapore'
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function getOneMapSignal(category: PlaceCategory) {
  const labels: Record<PlaceCategory, string> = {
    building: 'Official OneMap building result',
    condo: 'Official OneMap condo/apartment result',
    checkpoint: 'Official OneMap checkpoint result',
    food: 'Official OneMap food/place result',
    hdb: 'Official OneMap HDB/block result',
    transport: 'Official OneMap transport result',
    parking: 'Official OneMap parking result',
    mall: 'Official OneMap retail/building result',
    landmark: 'Official OneMap landmark result',
    medical: 'Official OneMap healthcare result',
    ev: 'Official OneMap EV result',
  }

  return labels[category]
}
