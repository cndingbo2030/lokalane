import { BadgeDollarSign, Clock3, Route, Sparkles } from 'lucide-react'
import { routeInsights } from '../data/layers'
import { getSourceLabel } from '../data/sources'
import type {
  AppView,
  IncidentReport,
  MobilityMode,
  Place,
  QualityReport,
} from '../domain/types'
import { CommutePanel } from './CommutePanel'
import { PlaceDetails } from './PlaceDetails'
import { QualityReportPanel } from './QualityReportPanel'
import { ReportIncidentPanel } from './ReportIncidentPanel'
import { SavedPlacesPanel } from './SavedPlacesPanel'

interface BottomSheetProps {
  activeRouteId: string
  activeView: AppView
  incidentReportCount: number
  isNavigating: boolean
  isSelectedPlaceSaved: boolean
  selectedPlace?: Place
  savedPlaces: Place[]
  mobilityMode: MobilityMode
  reportCount: number
  onIncidentReport: (report: Omit<IncidentReport, 'id' | 'createdAt'>) => void
  onMobilityModeChange: (mode: MobilityMode) => void
  onRouteSelect: (routeId: string) => void
  onSelectPlace: (placeId: string) => void
  onStartNavigation: () => void
  onQualityReport: (report: Omit<QualityReport, 'createdAt'>) => void
  onToggleSavedPlace: (placeId: string) => void
}

export function BottomSheet({
  activeRouteId,
  activeView,
  incidentReportCount,
  isNavigating,
  isSelectedPlaceSaved,
  selectedPlace,
  savedPlaces,
  mobilityMode,
  reportCount,
  onIncidentReport,
  onMobilityModeChange,
  onRouteSelect,
  onSelectPlace,
  onStartNavigation,
  onQualityReport,
  onToggleSavedPlace,
}: BottomSheetProps) {
  if (activeView === 'commute') {
    return (
      <aside className="bottom-sheet" aria-label="Commute intelligence">
        <CommutePanel
          activeRouteId={activeRouteId}
          onSelectRoute={onRouteSelect}
          onStartNavigation={onStartNavigation}
        />
      </aside>
    )
  }

  if (activeView === 'saved') {
    return (
      <aside className="bottom-sheet" aria-label="Saved places">
        <SavedPlacesPanel
          savedPlaces={savedPlaces}
          onRemove={onToggleSavedPlace}
          onSelect={onSelectPlace}
        />
      </aside>
    )
  }

  if (activeView === 'report') {
    return (
      <aside className="bottom-sheet" aria-label="Report road condition">
        <ReportIncidentPanel
          selectedPlace={selectedPlace}
          reportCount={incidentReportCount}
          onSubmit={onIncidentReport}
        />
        <QualityReportPanel
          place={selectedPlace}
          reportCount={reportCount}
          onSubmit={onQualityReport}
        />
      </aside>
    )
  }

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

      <PlaceDetails
        place={selectedPlace}
        isNavigating={isNavigating}
        isSaved={isSelectedPlaceSaved}
        onStartNavigation={onStartNavigation}
        onToggleSaved={() => {
          if (selectedPlace) {
            onToggleSavedPlace(selectedPlace.id)
          }
        }}
      />

      <QualityReportPanel
        place={selectedPlace}
        reportCount={reportCount}
        onSubmit={onQualityReport}
      />

      <section className="route-stack" aria-label="Suggested routes">
        {routeInsights.map((route) => (
          <button
            key={route.id}
            type="button"
            className={activeRouteId === route.id ? 'route-row active' : 'route-row'}
            onClick={() => onRouteSelect(route.id)}
          >
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
          </button>
        ))}
      </section>

      {isNavigating ? null : (
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
      )}
    </aside>
  )
}
