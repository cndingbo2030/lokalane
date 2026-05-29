export interface LtaCarParkAvailability {
  id: string
  area: string
  name: string
  location: string
  availableLots: number
  lotType: string
  agency: string
}

export interface LtaCarParkResponse {
  updatedAt: string
  results: LtaCarParkAvailability[]
}

export interface LtaBusArrivalResponse {
  busStopCode: string
  updatedAt: string
  services: unknown[]
}

export function hasLtaProxy() {
  return Boolean(import.meta.env.VITE_LOKALANE_API_BASE)
}

export async function fetchCarParkAvailability(fetcher: typeof fetch = fetch) {
  const apiBase = import.meta.env.VITE_LOKALANE_API_BASE
  if (!apiBase) {
    return null
  }

  const response = await fetcher(new URL('/lta/carparks', apiBase))
  if (!response.ok) {
    throw new Error(`LTA carpark proxy failed with ${response.status}`)
  }

  return (await response.json()) as LtaCarParkResponse
}

export async function fetchBusArrivals(busStopCode: string, fetcher: typeof fetch = fetch) {
  const apiBase = import.meta.env.VITE_LOKALANE_API_BASE
  if (!apiBase || !busStopCode.trim()) {
    return null
  }

  const url = new URL('/lta/bus-arrivals', apiBase)
  url.searchParams.set('busStopCode', busStopCode.trim())

  const response = await fetcher(url)
  if (!response.ok) {
    throw new Error(`LTA bus proxy failed with ${response.status}`)
  }

  return (await response.json()) as LtaBusArrivalResponse
}
