import { CircleAlert, LoaderCircle, MapPin, ShieldCheck } from 'lucide-react'
import { getSourceLabel } from '../data/sources'
import type { Place, ProviderSignal, UserMode } from '../domain/types'
import { useProviderHealth } from '../hooks/useProviderHealth'
import { ProviderStatusCard } from './ProviderStatusCard'
import { VisitorFocus } from './VisitorFocus'

interface SearchPanelProps {
  results: Place[]
  selectedPlace?: Place
  signals: ProviderSignal[]
  isLoading: boolean
  userMode: UserMode
  onQueryChange: (query: string) => void
  onSelectPlace: (placeId: string) => void
}

export function SearchPanel({
  results,
  selectedPlace,
  signals,
  isLoading,
  userMode,
  onQueryChange,
  onSelectPlace,
}: SearchPanelProps) {
  const providerHealth = useProviderHealth()

  return (
    <aside className="search-panel" aria-label="Search results">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Local precision layer</p>
          <h1>Singapore-first, Malaysia-ready map</h1>
        </div>
        <span className={isLoading ? 'live-chip loading' : 'live-chip'}>
          {isLoading ? <LoaderCircle size={13} /> : null}
          Alpha
        </span>
      </div>

      {userMode === 'visitor' ? <VisitorFocus onQueryChange={onQueryChange} /> : null}
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

      <div className="result-list">
        {results.length > 0 ? (
          results.map((place) => (
            <button
              key={place.id}
              type="button"
              className={selectedPlace?.id === place.id ? 'result-item active' : 'result-item'}
              onClick={() => onSelectPlace(place.id)}
            >
              <span className="result-icon">
                <MapPin size={18} />
              </span>
              <span className="result-copy">
                <strong>{place.name}</strong>
                <span>{formatCategory(place.category)} · {place.address}</span>
              </span>
              <span className="confidence">{Math.round(place.confidence * 100)}%</span>
            </button>
          ))
        ) : (
          <div className="empty-state compact">
            <strong>No local seed match</strong>
            <span>Connect OneMap gateway to search every Singapore HDB block, condo and building.</span>
          </div>
        )}
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
