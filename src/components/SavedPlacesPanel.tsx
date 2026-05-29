import { BookmarkCheck, MapPin, Trash2 } from 'lucide-react'
import type { Place } from '../domain/types'

interface SavedPlacesPanelProps {
  savedPlaces: Place[]
  onRemove: (placeId: string) => void
  onSelect: (placeId: string) => void
}

export function SavedPlacesPanel({ savedPlaces, onRemove, onSelect }: SavedPlacesPanelProps) {
  return (
    <section className="saved-panel" aria-label="Saved places">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Personal map</p>
          <h2>Saved places</h2>
        </div>
        <span className="live-chip">{savedPlaces.length}</span>
      </div>

      {savedPlaces.length === 0 ? (
        <div className="empty-state">
          <BookmarkCheck size={22} />
          <strong>No saved places yet</strong>
          <span>Save checkpoints, carparks and frequent destinations for quick routing.</span>
        </div>
      ) : (
        <div className="saved-list">
          {savedPlaces.map((place) => (
            <article key={place.id} className="saved-item">
              <button type="button" className="saved-main" onClick={() => onSelect(place.id)}>
                <span className="result-icon">
                  <MapPin size={18} />
                </span>
                <span>
                  <strong>{place.name}</strong>
                  <small>{place.area} · {place.country}</small>
                </span>
              </button>
              <button type="button" className="icon-danger" onClick={() => onRemove(place.id)}>
                <Trash2 size={16} />
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
