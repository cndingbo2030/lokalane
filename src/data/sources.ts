import type { DataSource } from '../domain/types'

export const dataSources: DataSource[] = [
  {
    id: 'onemap',
    label: 'OneMap Singapore',
    url: 'https://www.onemap.gov.sg',
    licenseNote:
      'Official Singapore base maps, address search, reverse geocoding and routing via SLA OneMap APIs.',
    refreshCadence: 'Token-backed API calls; cache operational responses for minutes, not days.',
  },
  {
    id: 'lta-datamall',
    label: 'LTA DataMall',
    url: 'https://datamall.lta.gov.sg',
    licenseNote:
      'Singapore transport datasets for bus arrivals, carpark availability, traffic incidents and EV chargers.',
    refreshCadence: 'Real-time feeds should be refreshed between 30 seconds and 5 minutes by dataset.',
  },
  {
    id: 'openstreetmap',
    label: 'OpenStreetMap',
    url: 'https://www.openstreetmap.org',
    licenseNote:
      'Regional Malaysia/Singapore fallback map and POI data under ODbL with visible attribution.',
    refreshCadence: 'Weekly import for MVP; daily diffs once traffic is meaningful.',
  },
  {
    id: 'lokalane-curated',
    label: 'LokaLane Curated',
    url: 'https://github.com/cndingbo2030/lokalane',
    licenseNote:
      'Editorial seed data for top commuter and cross-border use cases; every record needs source provenance.',
    refreshCadence: 'Manual updates during alpha; move to moderation queue before public launch.',
  },
  {
    id: 'community',
    label: 'Community Reports',
    url: 'https://github.com/cndingbo2030/lokalane',
    licenseNote:
      'User-submitted corrections, reports and closures. Requires moderation, abuse scoring and audit history.',
    refreshCadence: 'Real-time ingestion; confidence decays unless confirmed by multiple signals.',
  },
]

export function getSourceLabel(sourceId: DataSource['id']) {
  return dataSources.find((source) => source.id === sourceId)?.label ?? sourceId
}

export function getSource(sourceId: DataSource['id']) {
  return dataSources.find((source) => source.id === sourceId)
}
