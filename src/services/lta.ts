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

export interface LtaTrainAlertsResponse {
  updatedAt: string
  alerts: unknown[]
}

export interface LtaStationCrowdResponse {
  trainLine: string
  updatedAt: string
  stations: unknown[]
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

export async function fetchTrainAlerts(fetcher: typeof fetch = fetch) {
  const apiBase = import.meta.env.VITE_LOKALANE_API_BASE
  if (!apiBase) {
    return null
  }

  const response = await fetcher(new URL('/lta/train-alerts', apiBase))
  if (!response.ok) {
    throw new Error(`LTA train alerts proxy failed with ${response.status}`)
  }

  return (await response.json()) as LtaTrainAlertsResponse
}

export async function fetchStationCrowd(trainLine = 'NSL', fetcher: typeof fetch = fetch) {
  const apiBase = import.meta.env.VITE_LOKALANE_API_BASE
  if (!apiBase) {
    return null
  }

  const url = new URL('/lta/station-crowd', apiBase)
  url.searchParams.set('trainLine', trainLine)

  const response = await fetcher(url)
  if (!response.ok) {
    throw new Error(`LTA station crowd proxy failed with ${response.status}`)
  }

  return (await response.json()) as LtaStationCrowdResponse
}
