# Business Architecture

## Strategic Thesis

LokaLane should evolve from a map app into a local intent network. The map is the trust surface: users open it because they need to go somewhere, then discover useful local information around that place and route.

The long-term business is not only advertising. It is a controlled local information market where businesses and users pay when information creates measurable intent: a visit, route start, inquiry, booking lead, listing exposure, or saved offer.

## Product Layers

1. Mobility trust layer: OneMap, LTA, OSM, curated POIs, traffic, parking, transit, cross-border routing.
2. Discovery layer: attractions, food, deals, events, services, rentals, second-hand goods, jobs/gigs later.
3. Transaction-intent layer: call, chat, save, route, inquiry, reserve, lead handoff.
4. Monetization layer: sponsored discovery, listing fee, lead fee, verified merchant tools, premium user utility.
5. Intelligence layer: AI-assisted search, moderation, translation, recommendation, scam detection, and listing quality scoring.

## Revenue Model

### Phase 1: Trust And Retention

- Free map, official search, transit, parking and visitor discovery.
- No paid marketplace yet.
- Native sponsored cards only in non-navigation surfaces.
- Goal: prove repeat usage, search depth, saved places, and route starts.

### Phase 2: Information Fee Pilot

Information fees should start as paid exposure, not transaction escrow.

- Featured local listing: fixed fee for temporary exposure in a category and geography.
- Urgent post fee: faster review and higher placement for time-sensitive supply/demand posts.
- Verified merchant profile: monthly fee for better profile, analytics and offer publishing.
- Lead fee for high-intent categories such as rental viewing requests, moving services, clinics, lessons and repairs.

Guardrail: Ranking must remain useful. Paid placement can lift visibility only within relevant intent and must be labelled `Sponsored` or `Featured`.

### Phase 3: Local Marketplace

Categories:

- Eat and play: food deals, attractions, events, leisure packages.
- Rentals: room rental, whole unit, short-term stay leads, co-living, viewing requests.
- Second-hand: furniture, electronics, baby items, bikes, moving-out sales.
- Services: movers, cleaners, repairs, tuition, beauty, pet services.
- Supply/demand posts: looking for room, looking for buyer, carpool-style interest, community requests.

Start with browse and inquiry. Do not start with payments, escrow or delivery.

### Phase 4: B2B Tools

- Merchant dashboard.
- Local campaign planner by MRT station, mall, checkpoint, neighbourhood and route.
- Listing analytics: impressions, saves, calls, route starts, inquiries.
- Bulk listing import for property agents, food courts, events and malls.
- Privacy-preserving trend reports.

## Pricing Direction

Start simple:

- Free listing: limited duration, slower review, normal ranking.
- Featured post: SGD 3 to 15 depending on category, duration and geography.
- Merchant monthly: SGD 29 to 99 for verified profile and analytics.
- Lead fee: SGD 1 to 20 depending on category value.
- B2B campaign: custom later.

Do not optimize pricing before category liquidity exists. First measure whether users search, save, contact and route.

## Platform Payment Boundary

For native apps, paid access to digital app functionality such as featured listings, boosts, subscriptions or listing tools generally needs Google Play Billing on Android and Apple in-app purchase on iOS unless a specific policy exception applies.

Payments for physical goods or real-world services consumed outside the app can use external payment methods, but the first marketplace version should avoid in-app escrow and keep the app focused on discovery and inquiry.

Practical path:

- PWA/web: Stripe, PayNow or card payment for paid posting can be explored first.
- Native Android/iOS: use store billing for digital listing fees, boosts and subscriptions.
- Physical transactions between users: leave payment outside LokaLane initially.

## User Experience Principles

- Map remains primary; marketplace content appears only when relevant to current mode, place, query or route.
- No marketplace clutter during navigation.
- Sponsored and paid posts must be labelled and visually calmer than core map signals.
- Default view must stay fast: load map and search first, marketplace cards second.
- Anonymous browsing should work; posting requires account and verification.
- Chat should be optional and controlled; phone number exposure should be protected.

## Trust And Safety

Any user-posted marketplace requires:

- Terms acceptance before posting.
- Category-specific posting rules.
- Required report content button on every listing.
- Block/mute user function when messaging exists.
- Manual review queue for first-time posters, rentals, high-risk categories and paid boosts.
- Automated checks for spam, scams, duplicate listings, prohibited goods, harassment and personal data leakage.
- Takedown workflow with audit trail.

High-risk categories to avoid at launch:

- Financial products and loans.
- Medical claims and supplements.
- Gambling, adult content, weapons and controlled goods.
- Jobs requiring licensing or cross-border employment claims.

## Metrics

Core map:

- Search success rate.
- First useful result time.
- Route starts.
- Saved places.
- Repeat sessions per week.

Marketplace:

- Listing approval rate.
- Search-to-contact rate.
- Contact-to-route-start rate.
- Paid listing renewal rate.
- Reports per 1,000 listings.
- Time to remove abusive listing.

Unit economics:

- Provider cost per active user.
- Moderation cost per approved listing.
- Revenue per 1,000 local-intent sessions.
- Paid listing conversion by category.

