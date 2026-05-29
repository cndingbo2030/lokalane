import { useCallback } from 'react'
import { BottomNav } from './components/BottomNav'
import { BottomSheet } from './components/BottomSheet'
import { LayerDock } from './components/LayerDock'
import { MapCanvas } from './components/MapCanvas'
import { NavigationBanner } from './components/NavigationBanner'
import { SearchPanel } from './components/SearchPanel'
import { TopBar } from './components/TopBar'
import { modeProfiles } from './data/modes'
import { layerPoints } from './data/overlays'
import { places } from './data/places'
import { useHybridSearch } from './hooks/useHybridSearch'
import { getPlaceById } from './services/search'
import { useAppStore } from './state/useAppStore'

function App() {
  const {
    activeRouteId,
    activeView,
    baseMapMode,
    countryFilter,
    incidentReports,
    isNavigating,
    mobilityMode,
    qualityReports,
    query,
    savedPlaceIds,
    selectedPlaceId,
    userMode,
    visibleLayerIds,
    addIncidentReport,
    addQualityReport,
    setActiveRouteId,
    setActiveView,
    setBaseMapMode,
    setCountryFilter,
    setIsNavigating,
    setMobilityMode,
    setQuery,
    setSelectedPlaceId,
    setUserMode,
    toggleSavedPlace,
    toggleLayer,
  } = useAppStore()

  const { places: results, signals, isLoading } = useHybridSearch(query, {
    country: countryFilter,
    limit: 7,
    userMode,
  })
  const activeModeProfile = modeProfiles[userMode]

  const selectedPlace =
    results.find((place) => place.id === selectedPlaceId) ??
    results[0] ??
    getPlaceById(selectedPlaceId) ??
    places[0]

  const savedPlaces = savedPlaceIds
    .map((placeId) => results.find((place) => place.id === placeId) ?? getPlaceById(placeId))
    .filter((place): place is NonNullable<typeof place> => Boolean(place))

  const handleSelectPlace = useCallback(
    (placeId: string) => {
      setSelectedPlaceId(placeId)
      setActiveView('map')
    },
    [setActiveView, setSelectedPlaceId],
  )

  const handleStartNavigation = useCallback(() => {
    setIsNavigating(true)
    setActiveView('map')
  }, [setActiveView, setIsNavigating])

  const handleStopNavigation = useCallback(
    () => setIsNavigating(false),
    [setIsNavigating],
  )

  return (
    <main className={isNavigating ? 'app-shell is-navigating' : 'app-shell'}>
      <MapCanvas
        places={results}
        selectedPlace={selectedPlace}
        baseMapMode={baseMapMode}
        incidentReports={incidentReports}
        layerPoints={layerPoints}
        visibleLayerIds={visibleLayerIds}
        onSelectPlace={handleSelectPlace}
      />

      <NavigationBanner
        activeRouteId={activeRouteId}
        destination={selectedPlace}
        isNavigating={isNavigating}
        onStop={handleStopNavigation}
      />

      <TopBar
        baseMapMode={baseMapMode}
        countryFilter={countryFilter}
        query={query}
        searchPlaceholder={activeModeProfile.searchPlaceholder}
        userMode={userMode}
        onBaseMapChange={setBaseMapMode}
        onCountryChange={setCountryFilter}
        onUserModeChange={setUserMode}
        onQueryChange={setQuery}
      />

      <SearchPanel
        results={results}
        selectedPlace={selectedPlace}
        signals={signals}
        isLoading={isLoading}
        userMode={userMode}
        onQueryChange={setQuery}
        onSelectPlace={handleSelectPlace}
      />

      <LayerDock visibleLayerIds={visibleLayerIds} onToggleLayer={toggleLayer} />

      <BottomSheet
        activeRouteId={activeRouteId}
        activeView={activeView}
        incidentReportCount={incidentReports.length}
        isNavigating={isNavigating}
        isSelectedPlaceSaved={savedPlaceIds.includes(selectedPlace.id)}
        selectedPlace={selectedPlace}
        savedPlaces={savedPlaces}
        mobilityMode={mobilityMode}
        reportCount={
          selectedPlace
            ? qualityReports.filter((report) => report.placeId === selectedPlace.id).length
            : 0
        }
        userMode={userMode}
        onIncidentReport={addIncidentReport}
        onMobilityModeChange={setMobilityMode}
        onRouteSelect={setActiveRouteId}
        onSelectPlace={handleSelectPlace}
        onStartNavigation={handleStartNavigation}
        onQualityReport={addQualityReport}
        onToggleSavedPlace={toggleSavedPlace}
      />

      <BottomNav
        activeView={activeView}
        isNavigating={isNavigating}
        onViewChange={setActiveView}
      />
    </main>
  )
}

export default App
