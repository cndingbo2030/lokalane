export type CountryCode = 'SG' | 'MY'

export type BaseMapMode = 'regional' | 'sg-official'

export type MobilityMode = 'drive' | 'transit' | 'walk'

export type PlaceCategory =
  | 'checkpoint'
  | 'transport'
  | 'parking'
  | 'mall'
  | 'landmark'
  | 'medical'
  | 'ev'

export type DataSourceId =
  | 'onemap'
  | 'lta-datamall'
  | 'openstreetmap'
  | 'lokalane-curated'
  | 'community'

export interface Coordinates {
  lat: number
  lng: number
}

export interface DataSource {
  id: DataSourceId
  label: string
  url: string
  licenseNote: string
  refreshCadence: string
}

export interface Place {
  id: string
  name: string
  category: PlaceCategory
  country: CountryCode
  area: string
  address: string
  coordinates: Coordinates
  sourceId: DataSourceId
  confidence: number
  tags: string[]
  signal: string
  updatedAt: string
}

export interface MapLayerDefinition {
  id: string
  label: string
  sourceId: DataSourceId
  description: string
  defaultVisible: boolean
}

export interface RouteInsight {
  id: string
  title: string
  subtitle: string
  mode: MobilityMode
  durationMinutes: number
  distanceKm: number
  confidence: number
  sourceId: DataSourceId
  tollNote?: string
}
