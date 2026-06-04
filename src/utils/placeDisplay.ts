import type { Place } from '../domain/types'

export function getPlaceDisplayTitle(place: Place) {
  const compactTitle = place.name
    .replace(/\b(Singapore|Malaysia)\b/gi, '')
    .replace(/\b\d{5,6}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return toDisplayCase(compactTitle || place.name)
}

export function getPlaceDisplayAddress(place: Place) {
  const postcode = place.address.match(/\b\d{5,6}\b/)?.[0]
  const street = place.address
    .replace(/\b(Singapore|Malaysia)\b/gi, '')
    .replace(/\b\d{5,6}\b/g, '')
    .replace(/\s*,\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const isUsefulArea = !['singapore', 'malaysia'].includes(place.area.toLowerCase())
  const area = isUsefulArea && !street.toLowerCase().includes(place.area.toLowerCase())
    ? ` · ${place.area}`
    : ''
  const code = postcode ? ` · ${postcode}` : ''

  return `${toDisplayCase(street) || place.address}${area}${code}`
}

function toDisplayCase(value: string) {
  if (value !== value.toUpperCase()) {
    return value
  }

  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .replace(/\b\d+[a-z]\b/gi, (block) => block.toUpperCase())
    .replace(/\b(Hdb|Mrt|Lrt|Jb|Cp|Mscp|Cbd)\b/g, (term) => term.toUpperCase())
    .replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix)\b/g, (term) => term.toUpperCase())
}
