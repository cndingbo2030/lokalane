import { MapPin, ShieldCheck } from 'lucide-react'
import { getSourceLabel } from '../data/sources'
import type { Place } from '../domain/types'

interface SearchPanelProps {
  results: Place[]
  selectedPlace?: Place
  onSelectPlace: (placeId: string) => void
}

export function SearchPanel({ results, selectedPlace, onSelectPlace }: SearchPanelProps) {
  return (
    <aside className="search-panel" aria-label="Search results">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Local precision layer</p>
          <h1>Singapore-first, Malaysia-ready map</h1>
        </div>
        <span className="live-chip">Alpha</span>
      </div>

      <div className="result-list">
        {results.map((place) => (
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
              <span>{place.area} · {place.address}</span>
            </span>
            <span className="confidence">{Math.round(place.confidence * 100)}%</span>
          </button>
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
