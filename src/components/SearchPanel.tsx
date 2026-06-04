import {
  Building2,
  CircleAlert,
  Clock3,
  Home,
  Hospital,
  LoaderCircle,
  MapPin,
  ParkingCircle,
  SearchX,
  ShieldCheck,
  ShoppingBag,
  TrainFront,
  Utensils,
  Zap,
} from 'lucide-react'
import { getSourceLabel } from '../data/sources'
import type { Coordinates, Place, ProviderSignal, UserMode } from '../domain/types'
import { useProviderHealth } from '../hooks/useProviderHealth'
import { ProviderStatusCard } from './ProviderStatusCard'
import { VisitorFocus } from './VisitorFocus'

interface SearchPanelProps {
  results: Place[]
  savedPlaces: Place[]
  selectedPlace?: Place
  signals: ProviderSignal[]
  isLoading: boolean
  isOpen: boolean
  query: string
  userMode: UserMode
  onQueryChange: (query: string) => void
  onSelectPlace: (placeId: string) => void
}

export function SearchPanel({
  results,
  savedPlaces,
  selectedPlace,
  signals,
  isLoading,
  isOpen,
  query,
  userMode,
  onQueryChange,
  onSelectPlace,
}: SearchPanelProps) {
  const providerHealth = useProviderHealth()
  const hasQuery = query.trim().length > 0

  if (hasQuery && !isOpen) {
    return null
  }

  if (hasQuery) {
    return (
      <aside className="search-panel search-results-layer" aria-label="Search results">
        <div className="search-results-head">
          <div>
            <p className="eyebrow">Search results</p>
            <h1>{isLoading ? 'Updating places' : `${results.length} places found`}</h1>
          </div>
          <span className={isLoading ? 'live-chip loading' : 'live-chip'}>
            {isLoading ? <LoaderCircle size={13} /> : null}
            Live
          </span>
        </div>

        {isLoading && results.length === 0 ? <SearchSkeletonList /> : null}

        {!isLoading && results.length === 0 ? (
          <div className="search-empty-state">
            <span className="empty-search-icon">
              <SearchX size={22} />
            </span>
            <strong>没有找到相关地点</strong>
            <span>试试完整邮编、HDB block、建筑名、商场或 MRT 站名。</span>
          </div>
        ) : null}

        {results.length > 0 ? (
          <div className="search-result-list" aria-label="Place results">
            {results.map((place) => (
              <SearchResultRow
                key={place.id}
                place={place}
                referenceCoordinates={selectedPlace?.coordinates ?? results[0]?.coordinates}
                isActive={selectedPlace?.id === place.id}
                onSelect={() => onSelectPlace(place.id)}
              />
            ))}
          </div>
        ) : null}
      </aside>
    )
  }

  return (
    <aside className="search-panel is-discovery" aria-label="Search home">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Local precision layer</p>
          <h1>Find places, routes and local signals</h1>
        </div>
        <span className={isLoading ? 'live-chip loading' : 'live-chip'}>
          {isLoading ? <LoaderCircle size={13} /> : null}
          Alpha
        </span>
      </div>

      {userMode === 'visitor' ? <VisitorFocus onQueryChange={onQueryChange} /> : null}

      <div className="quick-search-home" aria-label="Recent and saved places">
        <div className="quick-search-section">
          <span className="quick-search-label">Recent</span>
          {selectedPlace ? (
            <button type="button" onClick={() => onSelectPlace(selectedPlace.id)}>
              <Clock3 size={15} />
              <span>{selectedPlace.name}</span>
            </button>
          ) : null}
        </div>
        <div className="quick-search-section">
          <span className="quick-search-label">Saved</span>
          {savedPlaces.slice(0, 2).map((place) => (
            <button key={place.id} type="button" onClick={() => onSelectPlace(place.id)}>
              <Home size={15} />
              <span>{place.name}</span>
            </button>
          ))}
        </div>
      </div>

      <ProviderStatusCard health={providerHealth} />

      <div className="provider-strip" aria-label="Data provider status">
        {signals.map((signal) => (
          <span key={signal.id} className={`provider-pill ${signal.status}`}>
            {signal.status === 'error' ? <CircleAlert size={13} /> : null}
            <strong>{signal.label}</strong>
            {signal.latencyMs ? `${signal.latencyMs}ms` : signal.message}
          </span>
        ))}
      </div>

      <div className="source-row">
        <ShieldCheck size={17} />
        <span>
          {selectedPlace
            ? `${getSourceLabel(selectedPlace.sourceId)} · updated ${selectedPlace.updatedAt}`
            : 'Source provenance required for every production record'}
        </span>
      </div>
    </aside>
  )
}

function SearchResultRow({
  isActive,
  place,
  referenceCoordinates,
  onSelect,
}: {
  isActive: boolean
  place: Place
  referenceCoordinates?: Coordinates
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={isActive ? 'search-result-row active' : 'search-result-row'}
      aria-label={`Select ${place.name}, ${place.address}`}
      onClick={onSelect}
    >
      <span className="search-result-icon">
        {renderCategoryIcon(place.category)}
      </span>
      <span className="search-result-copy">
        <strong>{place.name}</strong>
        <span>{place.address}</span>
        <em>{formatCategory(place.category)}</em>
      </span>
      <span className="search-result-metrics">
        <strong>{formatDistance(place.coordinates, referenceCoordinates)}</strong>
      </span>
    </button>
  )
}

function SearchSkeletonList() {
  return (
    <div className="search-skeleton-list" aria-label="Loading search suggestions">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="search-skeleton-row">
          <span />
          <div>
            <i />
            <i />
          </div>
        </div>
      ))}
    </div>
  )
}

function renderCategoryIcon(category: Place['category']) {
  const iconProps = { size: 19, strokeWidth: 1.65 }

  if (category === 'transport') {
    return <TrainFront {...iconProps} />
  }

  if (category === 'mall' || category === 'landmark') {
    return <ShoppingBag {...iconProps} />
  }

  if (category === 'food') {
    return <Utensils {...iconProps} />
  }

  if (category === 'hdb' || category === 'condo') {
    return <Home {...iconProps} />
  }

  if (category === 'parking') {
    return <ParkingCircle {...iconProps} />
  }

  if (category === 'medical') {
    return <Hospital {...iconProps} />
  }

  if (category === 'ev') {
    return <Zap {...iconProps} />
  }

  if (category === 'building') {
    return <Building2 {...iconProps} />
  }

  return <MapPin {...iconProps} />
}

function formatDistance(placeCoordinates: Coordinates, referenceCoordinates?: Coordinates) {
  if (!referenceCoordinates) {
    return 'Nearby'
  }

  const distanceKm = getDistanceKm(placeCoordinates, referenceCoordinates)

  if (distanceKm < 0.1) {
    return '<100 m'
  }

  if (distanceKm < 10) {
    return `${distanceKm.toFixed(1)} km`
  }

  return `${Math.round(distanceKm)} km`
}

function getDistanceKm(a: Coordinates, b: Coordinates) {
  const earthRadiusKm = 6371
  const latDelta = toRadians(b.lat - a.lat)
  const lngDelta = toRadians(b.lng - a.lng)
  const latA = toRadians(a.lat)
  const latB = toRadians(b.lat)
  const h =
    Math.sin(latDelta / 2) * Math.sin(latDelta / 2) +
    Math.cos(latA) * Math.cos(latB) * Math.sin(lngDelta / 2) * Math.sin(lngDelta / 2)

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

function formatCategory(category: Place['category']) {
  const labels: Record<Place['category'], string> = {
    building: 'Building',
    condo: 'Condo',
    checkpoint: 'Checkpoint',
    food: 'Food',
    hdb: 'HDB block',
    transport: 'Transport',
    parking: 'Parking',
    mall: 'Mall',
    landmark: 'Landmark',
    medical: 'Medical',
    ev: 'EV',
  }

  return labels[category]
}
