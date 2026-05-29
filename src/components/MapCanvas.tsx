import L from 'leaflet'
import { useEffect, useMemo, useRef } from 'react'
import type { BaseMapMode, IncidentReport, LayerPoint, Place } from '../domain/types'

interface MapCanvasProps {
  places: Place[]
  selectedPlace?: Place
  baseMapMode: BaseMapMode
  incidentReports: IncidentReport[]
  layerPoints: LayerPoint[]
  visibleLayerIds: string[]
  onSelectPlace: (placeId: string) => void
}

const singaporeBounds = L.latLngBounds([1.16, 103.55], [1.49, 104.12])

export function MapCanvas({
  places,
  selectedPlace,
  baseMapMode,
  incidentReports,
  layerPoints,
  visibleLayerIds,
  onSelectPlace,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tileLayerRef = useRef<L.TileLayer | null>(null)
  const markerLayerRef = useRef<L.LayerGroup | null>(null)
  const overlayLayerRef = useRef<L.LayerGroup | null>(null)

  const tileLayer = useMemo(() => createTileLayer(baseMapMode), [baseMapMode])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      center: [1.3521, 103.8198],
      zoom: 11,
    })

    L.control.zoom({ position: 'bottomright' }).addTo(map)
    markerLayerRef.current = L.layerGroup().addTo(map)
    overlayLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) {
      return
    }

    if (tileLayerRef.current) {
      tileLayerRef.current.removeFrom(map)
    }

    tileLayer.addTo(map)
    tileLayerRef.current = tileLayer

    if (baseMapMode === 'sg-official') {
      map.fitBounds(singaporeBounds, { padding: [24, 24], maxZoom: 12 })
    }
  }, [baseMapMode, tileLayer])

  useEffect(() => {
    const map = mapRef.current
    const markerLayer = markerLayerRef.current
    if (!map || !markerLayer) {
      return
    }

    markerLayer.clearLayers()

    places.forEach((place) => {
      const marker = L.marker([place.coordinates.lat, place.coordinates.lng], {
        icon: createPlaceIcon(place, selectedPlace?.id === place.id),
        title: place.name,
      })

      marker.on('click', () => onSelectPlace(place.id))
      marker.addTo(markerLayer)
    })
  }, [onSelectPlace, places, selectedPlace?.id])

  useEffect(() => {
    const overlayLayer = overlayLayerRef.current
    if (!overlayLayer) {
      return
    }

    overlayLayer.clearLayers()

    const reportsAsPoints = incidentReports.map<LayerPoint>((report) => ({
      id: report.id,
      layerId: 'community',
      title: getIncidentLabel(report.type),
      subtitle: report.note || 'New commuter report',
      coordinates: report.coordinates,
      sourceId: 'community',
      severity: report.type === 'accident' || report.type === 'closure' ? 'high' : 'medium',
      updatedAt: report.createdAt,
    }))

    const visiblePoints = [...layerPoints, ...reportsAsPoints].filter((point) =>
      visibleLayerIds.includes(point.layerId),
    )

    visiblePoints.forEach((point) => {
      L.marker([point.coordinates.lat, point.coordinates.lng], {
        icon: createLayerIcon(point),
        title: `${point.title}: ${point.subtitle}`,
      }).addTo(overlayLayer)
    })
  }, [incidentReports, layerPoints, visibleLayerIds])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedPlace) {
      return
    }

    map.flyTo([selectedPlace.coordinates.lat, selectedPlace.coordinates.lng], 14, {
      duration: 0.7,
    })
  }, [selectedPlace])

  return <div ref={containerRef} className="map-canvas" aria-label="LokaLane map" />
}

function createTileLayer(mode: BaseMapMode) {
  if (mode === 'sg-official') {
    return L.tileLayer('https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png', {
      bounds: singaporeBounds,
      maxZoom: 18,
      minZoom: 11,
      detectRetina: true,
      attribution:
        '<a href="https://www.onemap.gov.sg/" rel="noreferrer">OneMap</a> &copy; <a href="https://www.sla.gov.sg/" rel="noreferrer">Singapore Land Authority</a>',
    })
  }

  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    detectRetina: true,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">OpenStreetMap contributors</a>',
  })
}

function createPlaceIcon(place: Place, selected: boolean) {
  const countryClass = place.country === 'SG' ? 'marker-sg' : 'marker-my'
  const selectedClass = selected ? 'marker-selected' : ''

  return L.divIcon({
    className: `place-marker ${countryClass} ${selectedClass}`,
    html: `<span>${getCategoryInitial(place.category)}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}

function getCategoryInitial(category: Place['category']) {
  const labels: Record<Place['category'], string> = {
    checkpoint: 'C',
    transport: 'T',
    parking: 'P',
    mall: 'M',
    landmark: 'L',
    medical: '+',
    ev: 'E',
  }

  return labels[category]
}

function createLayerIcon(point: LayerPoint) {
  return L.divIcon({
    className: `layer-marker layer-${point.layerId} severity-${point.severity}`,
    html: `<span>${getLayerInitial(point.layerId)}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

function getLayerInitial(layerId: LayerPoint['layerId']) {
  const labels: Record<LayerPoint['layerId'], string> = {
    traffic: '!',
    bus: 'B',
    parking: 'P',
    ev: 'E',
    community: 'R',
  }

  return labels[layerId]
}

function getIncidentLabel(type: IncidentReport['type']) {
  const labels: Record<IncidentReport['type'], string> = {
    jam: 'Traffic jam',
    accident: 'Accident',
    closure: 'Road closure',
    hazard: 'Road hazard',
    police: 'Police presence',
  }

  return labels[type]
}
