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
- `api/onemap-worker.ts`: Cloudflare Worker style proxy for OneMap search plus LTA parking and bus feeds.

## Production Direction

1. Keep all paid or credentialed providers behind an API gateway.
2. Cache read-heavy geospatial responses with short TTLs.
3. Store user reports and POI corrections in PostGIS.
4. Add moderation, confidence scoring and source history before public crowdsourcing.
5. Use native mobile shells only after the PWA interaction model proves retention.
6. Keep marketplace listing, moderation, payment and AI services modular so the core map remains fast.

## Search Pipeline

```mermaid
flowchart LR
  Query["User query"] --> Local["Curated seed index"]
  Query --> Proxy["Edge proxy when configured"]
  Proxy --> OneMap["OneMap Search"]
  Local --> Merge["Deduplicate and rank"]
  OneMap --> Merge
  Merge --> UI["Result list with source signals"]
```

The UI must never wait on live providers before showing useful local results. Live providers enrich the list and raise confidence, but the fallback must remain fast and usable.

## Free-First Provider Choices

- Singapore base map: OneMap tiles with required attribution.
- Regional base map: OpenStreetMap during MVP.
- Search seed: curated local POIs, then OneMap proxy for Singapore.
- Transport: LTA DataMall behind the same edge proxy.
- Malaysia transit: data.gov.my / GTFS-style sources should be integrated through the provider gateway once coverage and licence fit are validated.
- Hosting: Vercel/Netlify plus Cloudflare Workers.

## User Modes

LokaLane now has four product modes:

- Visitor mode: attractions, airport, hotels, MRT-friendly routes and cross-border day trips.
- Local commute: repeat SG journeys, bus arrivals, MRT crowding, train alerts and work/school destinations.
- Driver mode: traffic, parking, EV charging and incidents.
- Public transport: MRT, bus, cross-border public transport and service quality.

Mode changes are product state, not just styling. Each mode changes default view, mobility mode, country filter, visible layers and search placeholder.
