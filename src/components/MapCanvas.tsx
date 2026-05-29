import L from 'leaflet'
import { useEffect, useMemo, useRef } from 'react'
import type { BaseMapMode, Place } from '../domain/types'

interface MapCanvasProps {
  places: Place[]
  selectedPlace?: Place
  baseMapMode: BaseMapMode
  onSelectPlace: (placeId: string) => void
}

const singaporeBounds = L.latLngBounds([1.16, 103.55], [1.49, 104.12])

export function MapCanvas({
  places,
  selectedPlace,
  baseMapMode,
  onSelectPlace,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tileLayerRef = useRef<L.TileLayer | null>(null)
  const markerLayerRef = useRef<L.LayerGroup | null>(null)

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
