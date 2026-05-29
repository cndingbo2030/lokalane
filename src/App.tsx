import { useCallback } from 'react'
import { BottomSheet } from './components/BottomSheet'
import { LayerDock } from './components/LayerDock'
import { MapCanvas } from './components/MapCanvas'
import { SearchPanel } from './components/SearchPanel'
import { TopBar } from './components/TopBar'
import { places } from './data/places'
import { useHybridSearch } from './hooks/useHybridSearch'
import { getPlaceById } from './services/search'
import { useAppStore } from './state/useAppStore'

function App() {
  const {
    baseMapMode,
    countryFilter,
    mobilityMode,
    qualityReports,
    query,
    selectedPlaceId,
    visibleLayerIds,
    addQualityReport,
    setBaseMapMode,
    setCountryFilter,
    setMobilityMode,
    setQuery,
    setSelectedPlaceId,
    toggleLayer,
  } = useAppStore()

  const { places: results, signals, isLoading } = useHybridSearch(query, {
    country: countryFilter,
    limit: 7,
  })

  const selectedPlace =
    results.find((place) => place.id === selectedPlaceId) ??
    getPlaceById(selectedPlaceId) ??
    results[0] ??
    places[0]

  const handleSelectPlace = useCallback(
    (placeId: string) => {
      setSelectedPlaceId(placeId)
    },
    [setSelectedPlaceId],
  )

  return (
    <main className="app-shell">
      <MapCanvas
        places={results}
        selectedPlace={selectedPlace}
        baseMapMode={baseMapMode}
        onSelectPlace={handleSelectPlace}
      />

      <TopBar
        baseMapMode={baseMapMode}
        countryFilter={countryFilter}
        query={query}
        onBaseMapChange={setBaseMapMode}
        onCountryChange={setCountryFilter}
        onQueryChange={setQuery}
      />

      <SearchPanel
        results={results}
        selectedPlace={selectedPlace}
        signals={signals}
        isLoading={isLoading}
        onSelectPlace={handleSelectPlace}
      />

      <LayerDock visibleLayerIds={visibleLayerIds} onToggleLayer={toggleLayer} />

      <BottomSheet
        selectedPlace={selectedPlace}
        mobilityMode={mobilityMode}
        reportCount={
          selectedPlace
            ? qualityReports.filter((report) => report.placeId === selectedPlace.id).length
            : 0
        }
        onMobilityModeChange={setMobilityMode}
        onQualityReport={addQualityReport}
      />
    </main>
  )
}

export default App
