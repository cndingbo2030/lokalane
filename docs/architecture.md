# Architecture

## System Shape

```mermaid
flowchart LR
  User["User App"] --> Web["React PWA"]
  Web --> Tile["OneMap / OSM Tiles"]
  Web --> Edge["Edge API Proxy"]
  Edge --> OneMap["OneMap APIs"]
  Edge --> LTA["LTA DataMall"]
  Edge --> Cache["KV / Redis Cache"]
  Edge --> DB["PostGIS Later"]
  Admin["Moderation Console Later"] --> DB
```

## Current Implementation

- `src/domain`: typed product entities.
- `src/data`: curated seed records, source registry and layer definitions.
- `src/services`: search and provider integration boundaries.
- `src/state`: app interaction state.
- `src/components`: map surface and UI panels.
- `api/onemap-worker.ts`: Cloudflare Worker style proxy sketch for OneMap search.

## Production Direction

1. Keep all paid or credentialed providers behind an API gateway.
2. Cache read-heavy geospatial responses with short TTLs.
3. Store user reports and POI corrections in PostGIS.
4. Add moderation, confidence scoring and source history before public crowdsourcing.
5. Use native mobile shells only after the PWA interaction model proves retention.

## Free-First Provider Choices

- Singapore base map: OneMap tiles with required attribution.
- Regional base map: OpenStreetMap during MVP.
- Search seed: curated local POIs, then OneMap proxy for Singapore.
- Transport: LTA DataMall behind the same edge proxy.
- Hosting: Vercel/Netlify plus Cloudflare Workers.
