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
- Respectful sponsored slot model that stays outside active navigation.
- Cloudflare Worker-style OneMap proxy sample so API credentials stay server-side.

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

The app is designed to call a server-side proxy at `VITE_LOKALANE_API_BASE`. Do not put OneMap credentials in Vite client code.

```bash
cp .env.example .env.local
```

Set `ONEMAP_EMAIL` and `ONEMAP_PASSWORD` only in the server/worker runtime.

## Documentation

- [Project brief](docs/project-brief.md)
- [Architecture](docs/architecture.md)
- [Data governance](docs/data-governance.md)
- [Monetization](docs/monetization.md)
- [Roadmap](docs/roadmap.md)
