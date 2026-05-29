export type CountryCode = 'SG' | 'MY'

export type BaseMapMode = 'regional' | 'sg-official'

export type MobilityMode = 'drive' | 'transit' | 'walk'

export type AppView = 'map' | 'commute' | 'saved' | 'report'

export type UserMode = 'visitor' | 'local' | 'driver' | 'transit'

export type PlaceCategory =
  | 'building'
  | 'condo'
  | 'checkpoint'
  | 'food'
  | 'hdb'
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

export type ProviderStatus = 'idle' | 'ready' | 'loading' | 'success' | 'unconfigured' | 'error'

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

export type LayerPointKind =
  | 'traffic'
  | 'bus'
  | 'parking'
  | 'ev'
  | 'community'

export type IncidentType = 'jam' | 'accident' | 'closure' | 'hazard' | 'police'

export type Severity = 'low' | 'medium' | 'high'

export type TransitMode = 'mrt' | 'lrt' | 'bus' | 'cross-border' | 'rail'

export type TransitCrowdLevel = 'low' | 'moderate' | 'high' | 'unknown'

export interface LayerPoint {
  id: string
  layerId: LayerPointKind
  title: string
  subtitle: string
  coordinates: Coordinates
  sourceId: DataSourceId
  severity: Severity
  updatedAt: string
}

export interface IncidentReport {
  id: string
  type: IncidentType
  placeId: string
  note: string
  coordinates: Coordinates
  createdAt: string
}

export interface ModeProfile {
  id: UserMode
  label: string
  shortLabel: string
  description: string
  defaultView: AppView
  mobilityMode: MobilityMode
  countryFilter: CountryCode | 'ALL'
  visibleLayerIds: string[]
  searchPlaceholder: string
}

export interface TransitLine {
  id: string
  label: string
  mode: TransitMode
  area: string
  color: string
  status: 'normal' | 'crowded' | 'disrupted' | 'planned'
  crowdLevel: TransitCrowdLevel
  sourceId: DataSourceId
  updatedAt: string
}

export interface TransitStop {
  id: string
  name: string
  code: string
  mode: TransitMode
  country: CountryCode
  area: string
  coordinates: Coordinates
  lines: string[]
  crowdLevel: TransitCrowdLevel
}

export interface TransitArrival {
  id: string
  stopId: string
  service: string
  destination: string
  minutes: number
  load: TransitCrowdLevel
  sourceId: DataSourceId
}

export interface TransitJourney {
  id: string
  title: string
  subtitle: string
  from: string
  to: string
  durationMinutes: number
  walkMinutes: number
  fareNote: string
  steps: string[]
  bestFor: UserMode[]
}

export interface ProviderSignal {
  id: DataSourceId
  status: ProviderStatus
  label: string
  message: string
  latencyMs?: number
}

export interface QualityReport {
  placeId: string
  reason: 'wrong-location' | 'closed' | 'missing-detail' | 'duplicate' | 'other'
  note: string
  createdAt: string
}
