# Store Submission Pack

This is the app-store working pack for the first Android and iOS submissions. The current app is a PWA prototype; store review requires a native wrapper/build before final submission.

## Product Identity

- App name: `LokaLane`
- Short description: `A clean local map for Singapore commutes, public transport, driving, and cross-border trips.`
- Category: `Maps & Navigation`
- Primary market: Singapore
- Secondary market: Malaysia
- Price: Free
- Monetization: respectful sponsored placements and future AdMob native ads outside active navigation

## Long Description

LokaLane is a free Singapore-first local map built for daily commutes, public transport, driving, visitor discovery, and Singapore-Malaysia cross-border trips.

The app combines a clean map interface with mode-based navigation for visitors, local commuters, drivers, and public transport users. It is designed to show useful official and community-backed mobility information without cluttering the map or interrupting active navigation.

Key features:

- Singapore and Malaysia-ready map experience
- Visitor, local commute, driver, and public transport modes
- Search for places, transport nodes, checkpoints, parking, and landmarks
- Public transport panel for MRT, bus, cross-border, and KTM-style journeys
- Traffic, bus, parking, EV, and community report overlays
- Saved places for home, work, school, and frequent cross-border destinations
- Clean sponsored surfaces that stay out of active navigation

LokaLane is currently built around free-first official and open data sources, with server-side API protection for OneMap and LTA DataMall integrations.

## Review Positioning

### What The App Does

LokaLane helps users find places, understand nearby mobility context, save frequent destinations, and plan local public transport or driving journeys in Singapore and Malaysia.

### What The App Does Not Claim Yet

- It does not claim production-grade turn-by-turn routing until official routing and QA are complete.
- It does not claim emergency service accuracy.
- It does not publish unverified community reports as official data.
- It does not expose API credentials in the client.

## Data Safety Draft

Final answers depend on implemented native SDKs and analytics. For the first build, keep the data footprint minimal.

- Location: used for map centering and nearby results; do not store precise location history in the MVP.
- User-generated content: incident and correction reports; add moderation before public publishing.
- App activity: optional analytics only after consent and privacy policy updates.
- Advertising ID: only if AdMob is enabled in a native build.
- Account data: no account system in the MVP unless later added.

## Required Assets

- Android App Bundle (`.aab`)
- iOS archive uploaded through Xcode / Transporter
- App icon at all platform sizes
- Phone screenshots
- Tablet screenshots if tablet support is enabled
- Privacy policy URL
- Support URL
- Content rating questionnaire
- Data safety / privacy nutrition answers
- AdMob app ID if ads are enabled
- Demo account only if a gated login is introduced

## Store Readiness Gates

1. Create a native wrapper with Capacitor or React Native.
2. Add production privacy and support URLs.
3. Verify app starts without dev server.
4. Confirm map attribution is visible.
5. Confirm no API keys are shipped in the app bundle.
6. Confirm location permission copy is specific and honest.
7. Confirm ads are hidden during active navigation.
8. Run Android release build and iOS release archive.
9. Fill store metadata and review questionnaires.
10. Submit after account owner completes payment, identity, agreements, tax, and 2FA steps.

## Suggested Review Notes

LokaLane is a free local navigation and public transport map for Singapore and Malaysia users. No login is required for core use. Location permission is used to center the map and show nearby mobility context. Official provider credentials are kept server-side behind an API gateway. Sponsored content is clearly labelled and not shown during active navigation.
