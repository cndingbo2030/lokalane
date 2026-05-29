import { create } from 'zustand'
import { mapLayers } from '../data/layers'
import { modeProfiles } from '../data/modes'
import type {
  AppView,
  BaseMapMode,
  CountryCode,
  IncidentReport,
  MobilityMode,
  QualityReport,
  UserMode,
} from '../domain/types'

interface AppState {
  activeRouteId: string
  activeView: AppView
  baseMapMode: BaseMapMode
  countryFilter: CountryCode | 'ALL'
  incidentReports: IncidentReport[]
  isNavigating: boolean
  mobilityMode: MobilityMode
  qualityReports: QualityReport[]
  query: string
  savedPlaceIds: string[]
  selectedPlaceId: string
  userMode: UserMode
  visibleLayerIds: string[]
  addIncidentReport: (report: Omit<IncidentReport, 'id' | 'createdAt'>) => void
  addQualityReport: (report: Omit<QualityReport, 'createdAt'>) => void
  setActiveRouteId: (routeId: string) => void
  setActiveView: (view: AppView) => void
  setBaseMapMode: (mode: BaseMapMode) => void
  setCountryFilter: (country: CountryCode | 'ALL') => void
  setIsNavigating: (isNavigating: boolean) => void
  setMobilityMode: (mode: MobilityMode) => void
  setQuery: (query: string) => void
  setSelectedPlaceId: (placeId: string) => void
  setUserMode: (mode: UserMode) => void
  toggleSavedPlace: (placeId: string) => void
  toggleLayer: (layerId: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeRouteId: 'causeway-drive',
  activeView: 'map',
  baseMapMode: 'regional',
  countryFilter: 'ALL',
  incidentReports: [],
  isNavigating: false,
  mobilityMode: 'drive',
  qualityReports: [],
  query: '',
  savedPlaceIds: ['woodlands-checkpoint', 'jb-city-square'],
  selectedPlaceId: 'woodlands-checkpoint',
  userMode: 'visitor',
  visibleLayerIds: mapLayers
    .filter((layer) => layer.defaultVisible)
    .map((layer) => layer.id),
  addIncidentReport: (report) =>
    set((state) => ({
      activeView: 'map',
      incidentReports: [
        {
          ...report,
          id: `incident-${Date.now()}`,
          createdAt: new Date().toISOString(),
        },
        ...state.incidentReports,
      ],
      visibleLayerIds: state.visibleLayerIds.includes('community')
        ? state.visibleLayerIds
        : [...state.visibleLayerIds, 'community'],
    })),
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
  setActiveRouteId: (activeRouteId) => set({ activeRouteId }),
  setActiveView: (activeView) => set({ activeView }),
  setBaseMapMode: (baseMapMode) => set({ baseMapMode }),
  setCountryFilter: (countryFilter) => set({ countryFilter }),
  setIsNavigating: (isNavigating) => set({ isNavigating }),
  setMobilityMode: (mobilityMode) => set({ mobilityMode }),
  setQuery: (query) => set({ query }),
  setSelectedPlaceId: (selectedPlaceId) => set({ selectedPlaceId }),
  setUserMode: (userMode) => {
    const profile = modeProfiles[userMode]
    set({
      activeView: profile.defaultView,
      countryFilter: profile.countryFilter,
      isNavigating: false,
      mobilityMode: profile.mobilityMode,
      userMode,
      visibleLayerIds: profile.visibleLayerIds,
    })
  },
  toggleSavedPlace: (placeId) =>
    set((state) => {
      const isSaved = state.savedPlaceIds.includes(placeId)
      return {
        savedPlaceIds: isSaved
          ? state.savedPlaceIds.filter((savedId) => savedId !== placeId)
          : [placeId, ...state.savedPlaceIds],
      }
    }),
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
