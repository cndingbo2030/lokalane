import type { ModeProfile, UserMode } from '../domain/types'

export const modeProfiles: Record<UserMode, ModeProfile> = {
  visitor: {
    id: 'visitor',
    label: 'Visitor mode',
    shortLabel: 'Visitor',
    description: 'Attractions, hawker food, hotels and simple tourist routes.',
    defaultView: 'map',
    mobilityMode: 'transit',
    countryFilter: 'ALL',
    visibleLayerIds: ['bus', 'parking', 'community'],
    searchPlaceholder: 'Search attractions, hawker food, hotel, MRT',
  },
  local: {
    id: 'local',
    label: 'Local commute',
    shortLabel: 'Local',
    description: 'Fast repeat journeys with bus arrivals, MRT crowding and service alerts.',
    defaultView: 'commute',
    mobilityMode: 'transit',
    countryFilter: 'SG',
    visibleLayerIds: ['traffic', 'bus', 'parking', 'community'],
    searchPlaceholder: 'Search bus stop, MRT, office, school, HDB block',
  },
  driver: {
    id: 'driver',
    label: 'Driver mode',
    shortLabel: 'Driver',
    description: 'Traffic, parking, incidents and checkpoint-sensitive routing.',
    defaultView: 'map',
    mobilityMode: 'drive',
    countryFilter: 'ALL',
    visibleLayerIds: ['traffic', 'parking', 'ev', 'community'],
    searchPlaceholder: 'Search carpark, petrol, checkpoint, mall, address',
  },
  transit: {
    id: 'transit',
    label: 'Public transport',
    shortLabel: 'Transit',
    description: 'Bus arrivals, MRT crowding, service status and cross-border transit.',
    defaultView: 'commute',
    mobilityMode: 'transit',
    countryFilter: 'ALL',
    visibleLayerIds: ['bus', 'community'],
    searchPlaceholder: 'Search MRT line, bus stop, station, interchange',
  },
}

export const userModeOrder: UserMode[] = ['visitor', 'local', 'driver', 'transit']
