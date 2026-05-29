import { ExternalLink, Gauge, MapPinned, Navigation2 } from 'lucide-react'
import { getSource, getSourceLabel } from '../data/sources'
import type { Place } from '../domain/types'

interface PlaceDetailsProps {
  place?: Place
}

export function PlaceDetails({ place }: PlaceDetailsProps) {
  if (!place) {
    return null
  }

  const confidence = Math.round(place.confidence * 100)
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${place.coordinates.lat},${place.coordinates.lng}`
  const sourceUrl = getSource(place.sourceId)?.url ?? 'https://www.onemap.gov.sg/'

  return (
    <section className="place-details" aria-label="Place details">
      <div>
        <p className="eyebrow">{place.country} · {place.category}</p>
        <h2>{place.name}</h2>
        <p>{place.address}</p>
      </div>

      <div className="metric-strip">
        <span>
          <Gauge size={16} />
          {confidence}% confidence
        </span>
        <span>
          <MapPinned size={16} />
          {getSourceLabel(place.sourceId)}
        </span>
      </div>

      <p className="signal-line">{place.signal}</p>

      <div className="action-row">
        <a href={mapsUrl} target="_blank" rel="noreferrer">
          <Navigation2 size={17} />
          Open route
        </a>
        <a href={sourceUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={17} />
          Data source
        </a>
      </div>
    </section>
  )
}
