# Data Governance

## Source Hierarchy

1. Official source with current API: OneMap, LTA DataMall.
2. Open map source with attribution: OpenStreetMap.
3. Curated editorial seed data with documented source.
4. Community reports with confidence scoring and moderation.

## Required Metadata

Every production record should store:

- Source ID.
- Last fetched timestamp.
- Last verified timestamp.
- Confidence score.
- License and attribution requirement.
- Change history.
- Reporter or import job identifier.

## OneMap

Use OneMap for Singapore addresses, official map rendering, reverse geocoding and routing experiments. Search and other authenticated APIs must be called from a server-side proxy, not from client code.

## LTA DataMall

Use LTA for bus arrivals, bus stops, parking availability, traffic incidents, expressway travel time and EV charger feeds. These dynamic feeds should be cached by dataset-specific TTLs to avoid waste and improve latency.

## OpenStreetMap

Use OSM as an MVP regional fallback for Malaysia and non-official coverage. Keep visible attribution and plan for a production tile strategy before high traffic.

## Community Data

Do not publish untrusted reports directly into core navigation. Route-impacting reports need confidence thresholds, duplicate detection, decay logic and manual review for high-risk categories.
