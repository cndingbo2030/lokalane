import { create } from 'zustand'
import { mapLayers } from '../data/layers'
import type {
  BaseMapMode,
  CountryCode,
  MobilityMode,
  QualityReport,
} from '../domain/types'

interface AppState {
  baseMapMode: BaseMapMode
  countryFilter: CountryCode | 'ALL'
  mobilityMode: MobilityMode
  qualityReports: QualityReport[]
  query: string
  selectedPlaceId: string
  visibleLayerIds: string[]
  addQualityReport: (report: Omit<QualityReport, 'createdAt'>) => void
  setBaseMapMode: (mode: BaseMapMode) => void
  setCountryFilter: (country: CountryCode | 'ALL') => void
  setMobilityMode: (mode: MobilityMode) => void
  setQuery: (query: string) => void
  setSelectedPlaceId: (placeId: string) => void
  toggleLayer: (layerId: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  baseMapMode: 'regional',
  countryFilter: 'ALL',
  mobilityMode: 'drive',
  qualityReports: [],
  query: '',
  selectedPlaceId: 'woodlands-checkpoint',
  visibleLayerIds: mapLayers
    .filter((layer) => layer.defaultVisible)
    .map((layer) => layer.id),
  addQualityReport: (report) =>
    set((state) => ({
      qualityReports: [
        {
          ...report,
          createdAt: new Date().toISOString(),
        },
        ...state.qualityReports,
      ],
    })),
  setBaseMapMode: (baseMapMode) => set({ baseMapMode }),
  setCountryFilter: (countryFilter) => set({ countryFilter }),
  setMobilityMode: (mobilityMode) => set({ mobilityMode }),
  setQuery: (query) => set({ query }),
  setSelectedPlaceId: (selectedPlaceId) => set({ selectedPlaceId }),
  toggleLayer: (layerId) =>
    set((state) => {
      const isVisible = state.visibleLayerIds.includes(layerId)
      return {
        visibleLayerIds: isVisible
          ? state.visibleLayerIds.filter((id) => id !== layerId)
          : [...state.visibleLayerIds, layerId],
      }
    }),
}))
