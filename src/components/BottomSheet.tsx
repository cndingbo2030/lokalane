import { BadgeDollarSign, Clock3, Route, Sparkles } from 'lucide-react'
import { routeInsights } from '../data/layers'
import { getSourceLabel } from '../data/sources'
import type { MobilityMode, Place } from '../domain/types'
import { PlaceDetails } from './PlaceDetails'

interface BottomSheetProps {
  selectedPlace?: Place
  mobilityMode: MobilityMode
  onMobilityModeChange: (mode: MobilityMode) => void
}

export function BottomSheet({
  selectedPlace,
  mobilityMode,
  onMobilityModeChange,
}: BottomSheetProps) {
  return (
    <aside className="bottom-sheet" aria-label="Route intelligence">
      <div className="sheet-tabs" aria-label="Mobility mode">
        {(['drive', 'transit', 'walk'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={mobilityMode === mode ? 'active' : ''}
            onClick={() => onMobilityModeChange(mode)}
          >
            {mode}
          </button>
        ))}
      </div>

      <PlaceDetails place={selectedPlace} />

      <section className="route-stack" aria-label="Suggested routes">
        {routeInsights.map((route) => (
          <article key={route.id} className="route-row">
            <span className="route-icon">
              <Route size={18} />
            </span>
            <div>
              <strong>{route.title}</strong>
              <span>{route.subtitle}</span>
              <small>{getSourceLabel(route.sourceId)} · {Math.round(route.confidence * 100)}% confidence</small>
            </div>
            <span className="eta">
              <Clock3 size={15} />
              {route.durationMinutes}m
            </span>
          </article>
        ))}
      </section>

      <section className="ad-slot" aria-label="Sponsored recommendation">
        <span className="sponsor-icon">
          <BadgeDollarSign size={18} />
        </span>
        <div>
          <p>Sponsored</p>
          <strong>City Square weekday lunch deal</strong>
          <span>Nearby offer after checkpoint arrival · hidden during active navigation.</span>
        </div>
        <Sparkles size={18} />
      </section>
    </aside>
  )
}
