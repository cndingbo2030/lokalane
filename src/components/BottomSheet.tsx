import { BadgeDollarSign, Clock3, Route, Sparkles } from 'lucide-react'
import type { PointerEvent, ReactNode } from 'react'
import { useRef, useState } from 'react'
import { routeInsights } from '../data/layers'
import { getSourceLabel } from '../data/sources'
import type {
  AppView,
  IncidentReport,
  MobilityMode,
  Place,
  QualityReport,
  UserMode,
} from '../domain/types'
import { CommutePanel } from './CommutePanel'
import { CommunityDigest } from './CommunityDigest'
import { CommunityPanel } from './CommunityPanel'
import { ModeSummaryPanel } from './ModeSummaryPanel'
import { PlaceDetails } from './PlaceDetails'
import { PublicTransportPanel } from './PublicTransportPanel'
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
  userMode: UserMode
  onIncidentReport: (report: Omit<IncidentReport, 'id' | 'createdAt'>) => void
  onMobilityModeChange: (mode: MobilityMode) => void
  onQueryChange: (query: string) => void
  onRouteSelect: (routeId: string) => void
  onSelectPlace: (placeId: string) => void
  onStartNavigation: () => void
  onQualityReport: (report: Omit<QualityReport, 'createdAt'>) => void
  onToggleSavedPlace: (placeId: string) => void
  onViewChange: (view: AppView) => void
}

type SheetStage = 'peek' | 'half' | 'full'

const stageOrder: SheetStage[] = ['peek', 'half', 'full']

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
  userMode,
  onIncidentReport,
  onMobilityModeChange,
  onQueryChange,
  onRouteSelect,
  onSelectPlace,
  onStartNavigation,
  onQualityReport,
  onToggleSavedPlace,
  onViewChange,
}: BottomSheetProps) {
  const [sheetStage, setSheetStage] = useState<SheetStage>('peek')
  const dragStartYRef = useRef<number | null>(null)
  const effectiveSheetStage = activeView === 'map' ? sheetStage : sheetStage === 'peek' ? 'half' : sheetStage

  const promoteSheet = () => {
    setSheetStage((current) => stageOrder[Math.min(stageOrder.indexOf(current) + 1, stageOrder.length - 1)])
  }

  const demoteSheet = () => {
    setSheetStage((current) => stageOrder[Math.max(stageOrder.indexOf(current) - 1, 0)])
  }

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    dragStartYRef.current = event.clientY
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const dragStartY = dragStartYRef.current
    dragStartYRef.current = null

    if (dragStartY === null) {
      return
    }

    const deltaY = event.clientY - dragStartY

    if (Math.abs(deltaY) < 18) {
      promoteSheet()
      return
    }

    if (deltaY < -32) {
      promoteSheet()
      return
    }

    if (deltaY > 32) {
      demoteSheet()
    }
  }

  const sheetLabel = getSheetLabel(activeView)
  const sheetClassName = `bottom-sheet view-${activeView} sheet-stage-${effectiveSheetStage}`

  let content: ReactNode

  if (activeView === 'commute') {
    content = (
      <>
        <ModeSummaryPanel userMode={userMode} />
        <PublicTransportPanel
          userMode={userMode}
          onStartNavigation={onStartNavigation}
        />
        <CommutePanel
          activeRouteId={activeRouteId}
          onSelectRoute={onRouteSelect}
          onStartNavigation={onStartNavigation}
        />
      </>
    )
  } else if (activeView === 'saved') {
    content = (
      <>
        <SavedPlacesPanel
          savedPlaces={savedPlaces}
          onRemove={onToggleSavedPlace}
          onSelect={onSelectPlace}
        />
      </>
    )
  } else if (activeView === 'community') {
    content = (
      <>
        <CommunityPanel
          selectedPlace={selectedPlace}
          onQueryChange={onQueryChange}
        />
      </>
    )
  } else if (activeView === 'report') {
    content = (
      <>
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
      </>
    )
  } else {
    content = (
      <>
        <div className="sheet-tabs sheet-stage-extra" aria-label="Mobility mode">
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

        {selectedPlace ? (
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
        ) : (
          <div className="empty-state compact">
            <strong>No place selected</strong>
            <span>Try a building name, HDB block, condo, mall, food centre or station.</span>
          </div>
        )}

        <div className="sheet-stage-extra">
          {isNavigating || !selectedPlace ? null : (
            <CommunityDigest
              place={selectedPlace}
              onQueryChange={onQueryChange}
              onViewChange={onViewChange}
            />
          )}

          {selectedPlace && (userMode === 'visitor' || userMode === 'transit') ? (
            <PublicTransportPanel
              userMode={userMode}
              onStartNavigation={onStartNavigation}
            />
          ) : null}

          {selectedPlace ? (
            <QualityReportPanel
              place={selectedPlace}
              reportCount={reportCount}
              onSubmit={onQualityReport}
            />
          ) : null}

          {selectedPlace ? (
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
          ) : null}

          {isNavigating || !selectedPlace ? null : (
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
        </div>
      </>
    )
  }

  return (
    <aside className={sheetClassName} aria-label={sheetLabel} data-stage={effectiveSheetStage}>
      <button
        type="button"
        className="sheet-handle"
        aria-label={`Expand ${sheetLabel}`}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <span aria-hidden="true" />
      </button>
      {content}
    </aside>
  )
}

function getSheetLabel(activeView: AppView) {
  const labels: Record<AppView, string> = {
    map: 'Route intelligence',
    commute: 'Commute intelligence',
    community: 'Community intelligence',
    saved: 'Saved places',
    report: 'Report road condition',
  }

  return labels[activeView]
}
