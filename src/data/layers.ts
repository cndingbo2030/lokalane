import type { MapLayerDefinition, RouteInsight } from '../domain/types'

export const mapLayers: MapLayerDefinition[] = [
  {
    id: 'traffic',
    label: 'Traffic',
    sourceId: 'lta-datamall',
    description: 'Traffic incidents and expressway travel time feeds.',
    defaultVisible: true,
  },
  {
    id: 'bus',
    label: 'Bus',
    sourceId: 'lta-datamall',
    description: 'Bus stops and real-time arrival integration candidates.',
    defaultVisible: true,
  },
  {
    id: 'parking',
    label: 'Parking',
    sourceId: 'lta-datamall',
    description: 'Carpark availability and entrance quality signals.',
    defaultVisible: true,
  },
  {
    id: 'ev',
    label: 'EV',
    sourceId: 'lta-datamall',
    description: 'EV chargers and nearby amenities.',
    defaultVisible: false,
  },
  {
    id: 'community',
    label: 'Reports',
    sourceId: 'community',
    description: 'Crowd reports for closures, hazards and location fixes.',
    defaultVisible: true,
  },
]

export const routeInsights: RouteInsight[] = [
  {
    id: 'causeway-drive',
    title: 'Woodlands to JB City Square',
    subtitle: 'Cross-border driving route with checkpoint sensitivity.',
    mode: 'drive',
    durationMinutes: 42,
    distanceKm: 9.4,
    confidence: 0.61,
    sourceId: 'community',
    tollNote: 'Toll and checkpoint wait estimates need live integration.',
  },
  {
    id: 'orchard-to-mbs',
    title: 'Orchard to Marina Bay Sands',
    subtitle: 'Short city route, parking-aware in the target product.',
    mode: 'drive',
    durationMinutes: 15,
    distanceKm: 4.7,
    confidence: 0.72,
    sourceId: 'onemap',
  },
  {
    id: 'punggol-to-changi',
    title: 'Punggol to Changi Airport T3',
    subtitle: 'Airport route that can combine road and transit alternatives.',
    mode: 'transit',
    durationMinutes: 49,
    distanceKm: 17.8,
    confidence: 0.68,
    sourceId: 'lta-datamall',
  },
]
