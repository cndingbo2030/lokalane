import { useCallback, useMemo } from 'react'
import { BottomSheet } from './components/BottomSheet'
import { LayerDock } from './components/LayerDock'
import { MapCanvas } from './components/MapCanvas'
import { SearchPanel } from './components/SearchPanel'
import { TopBar } from './components/TopBar'
import { places } from './data/places'
import { getPlaceById, searchPlaces } from './services/search'
import { useAppStore } from './state/useAppStore'

function App() {
  const {
    baseMapMode,
    countryFilter,
    mobilityMode,
    query,
    selectedPlaceId,
    visibleLayerIds,
    setBaseMapMode,
    setCountryFilter,
    setMobilityMode,
    setQuery,
    setSelectedPlaceId,
    toggleLayer,
  } = useAppStore()

  const results = useMemo(
    () => searchPlaces(query, { country: countryFilter, limit: 7 }),
    [countryFilter, query],
  )

  const selectedPlace = getPlaceById(selectedPlaceId) ?? results[0] ?? places[0]

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
        onSelectPlace={handleSelectPlace}
      />

      <LayerDock visibleLayerIds={visibleLayerIds} onToggleLayer={toggleLayer} />

      <BottomSheet
        selectedPlace={selectedPlace}
        mobilityMode={mobilityMode}
        onMobilityModeChange={setMobilityMode}
      />
    </main>
  )
}

export default App
