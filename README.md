# LokaLane

LokaLane is a Singapore-first, Malaysia-ready local navigation map for commuters, drivers and cross-border users. The product strategy is simple: keep the map clean, make local data more trustworthy, and monetize only in moments that do not harm navigation.

## Why This Name

`Loka` feels local and location-native across Southeast Asia. `Lane` makes the product immediately understandable as a route, commute and navigation app. The name is short, ownable and easy to read in English, Chinese and Malay contexts.

## MVP Scope

- Clean Waze-inspired map UI without noisy controls.
- Singapore official map mode using OneMap tiles.
- Regional SG/MY map mode using OpenStreetMap for early free coverage.
- Curated SG/MY seed POIs for checkpoints, malls, transport, parking and landmarks.
- Data-source abstraction for OneMap, LTA DataMall, OSM, curated records and community reports.
- Hybrid search: local seed results are instant, OneMap results enrich the list when the edge proxy is configured.
- Local correction queue for wrong pins, closures, missing details and duplicates.
- Product-level app flows: Map, Commute, Saved, and Report tabs.
- Simulated active navigation state with guidance banner and ad suppression.
- Map overlays for traffic, buses, parking, EV chargers, and community reports.
- Saved places workflow for frequent destinations and checkpoint shortcuts.
- Community incident reporting workflow for jams, accidents, closures, hazards, and police presence.
- Respectful sponsored slot model that stays outside active navigation.
- Cloudflare Worker-style provider proxy sample so OneMap and LTA credentials stay server-side.

## Free-First Stack

- Frontend: Vite, React, TypeScript.
- Map: Leaflet with OneMap and OpenStreetMap tile layers.
- State: Zustand.
- Icons: lucide-react.
- Tests: Vitest.
- Hosting path: Vercel/Netlify free tier for the PWA.
- API path: Cloudflare Workers free tier for the OneMap proxy.
- Future database: Supabase free tier with PostGIS when user reports and POI moderation start.

## Local Development

```bash
npm install
npm run dev
```

Run checks:

```bash
npm run lint
npm run test
npm run build
```

## OneMap Integration

The app is designed to call a server-side proxy at `VITE_LOKALANE_API_BASE`. Do not put OneMap or LTA credentials in Vite client code.

```bash
cp .env.example .env.local
```

Set `ONEMAP_EMAIL`, `ONEMAP_PASSWORD`, and `LTA_ACCOUNT_KEY` only in the server/worker runtime.

Worker routes:

- `GET /health`
- `GET /onemap/search?q=orchard`
- `GET /lta/carparks`
- `GET /lta/bus-arrivals?busStopCode=01012`
- `GET /lta/train-alerts`
- `GET /lta/station-crowd?trainLine=NSL`

## Documentation

- [Project brief](docs/project-brief.md)
- [Architecture](docs/architecture.md)
- [Data governance](docs/data-governance.md)
- [Monetization](docs/monetization.md)
- [API application pack](docs/api-application-pack.md)
- [Store submission pack](docs/store-submission-pack.md)
- [Roadmap](docs/roadmap.md)
