# AI-Native Singapore Company Plan

## Operating Thesis

LokaLane should be designed as an AI-native, Singapore-local company from the beginning. The "one-person tech company" idea is useful only if it is treated as an operating discipline: keep the team tiny, automate repeatable work, use agents for leverage, and keep humans accountable for trust, compliance, product taste, user disputes and money movement.

The practical goal is not to run a zero-person company. The practical goal is to let one founder and one Singapore local operator manage a product that would previously require a larger engineering, operations, moderation and support team.

## Company Setup Direction

Use a Singapore private limited company when the product starts collecting meaningful user data, taking paid listings, signing merchant agreements or preparing for app-store launch under a business identity.

Recommended structure:

- Company form: Singapore private company limited by shares.
- Working company name: keep `LokaLane` as the product brand; register a company name only after name availability and trademark checks.
- Local operator: Singapore resident director or equivalent local officer role, subject to eligibility and professional advice.
- Founder role: product, engineering, AI operations, strategy and investor/vendor relationships.
- Corporate service provider: use a licensed Singapore corporate secretary/CSP instead of self-managing compliance.
- Registered office: use a proper Singapore registered office or CSP address; do not expose a home address if avoidable.
- IP ownership: assign code, brand, domain, designs, data schemas and content rights from the individual founder to the company before paid launch or fundraising.
- Bank and finance: business bank account, accounting system, receipt/invoice process and monthly management reporting from day one.

Do not commit family names, personal phone numbers, NRIC/FIN details, residential addresses, Singpass screenshots, bank details or company incorporation documents to the repository.

## ACRA Readiness Checklist

ACRA's current local-company guidance says a company needs at least one company director and one company secretary; the secretary must be appointed within six months after successful registration. At least one director must meet local residency rules, and directors are responsible for company records, filings and acting in the company's best interests.

Before incorporation:

- Reserve company name through ACRA/Bizfile.
- Decide shareholders, directors and share allocation.
- Decide financial year end, company email and registered office.
- Prepare proposed director/shareholder details.
- Prepare constitution or use a professional template.
- Prepare initial share capital and class of shares.
- Decide who signs consent to act as director and who will be company secretary.

After incorporation:

- Appoint company secretary within the required timeline.
- Set up company registers and controller/nominee registers where applicable.
- Open business bank account.
- Set up accounting, tax calendar and document retention.
- Register Corppass and manage access tightly.
- Put IP assignment, founder agreement and contractor assignment templates in place.

This is an operating checklist, not legal advice. Final structure should be confirmed with a Singapore corporate secretary, accountant or lawyer.

## Local Trust Positioning

The company should feel local before it feels big.

User-facing trust signals:

- Singapore business identity once incorporated.
- Clear privacy policy, support email and local contact path.
- OneMap, LTA and other official data attribution where required.
- Transparent `Sponsored`, `Featured`, `Official`, `Community` and `AI-assisted` labels.
- English-first interface with Chinese and Malay support where it improves actual local usage.
- No aggressive ad density, no dark patterns, no fake scarcity and no hidden paid ranking.

Categories should follow Singapore/JB daily intent:

- Visitor: attractions, hawker/food, malls, hotels, airport, public transport, safe late-night return routes.
- Local commute: HDB, condos, buildings, bus/MRT, parking, clinic, school, supermarket and saved routines.
- Cross-border: Woodlands/Tuas, JB malls, petrol, parking, KTM, checkpoint status and route planning.
- Marketplace later: food offers, room rental leads, moving-out second-hand goods, services, events and supply/demand posts.

## AI Operating System

AI should run the back office and assist product quality. It should not silently make high-impact decisions.

### Human-Owned Decisions

- App-store submissions.
- OneMap/LTA/API account management.
- Paid listing pricing and refund policy.
- User bans, marketplace removals and appeal outcomes.
- Rental, scam, safety or legal-risk cases.
- Data deletion and PDPA requests.
- Public incident response.
- Final release approval.

### AI-Agent Workflows

- Product research: competitor scans, category gaps, store-review mining and feature prioritization drafts.
- Engineering: issue triage, code generation, tests, regression checks and documentation updates.
- Data quality: duplicate POI detection, stale listing detection, geocoding mismatch flags and confidence scoring.
- Marketplace moderation: spam/scam triage, prohibited-content flags, duplicate listing checks and image quality review.
- Support: draft replies, classify tickets, summarize user complaints and propose refund/escalation paths.
- Localization: English, Simplified Chinese and Malay copy variants with human review.
- Growth: SEO landing drafts, merchant outreach drafts, local category pages and analytics summaries.
- Compliance: monthly checklist reminders for PDPA, app-store policies, vendor keys, backups and financial records.

### Agent Guardrails

- No secrets in prompts or client code.
- No AI system can approve payment movement, user bans or high-risk rental posts without review.
- All AI moderation decisions need reason codes and audit logs.
- Users must know when AI is used for recommendations, listing cleanup or moderation support.
- Keep a manual fallback for search, listing review and customer support.

## Technical Architecture For A Tiny Team

Optimize for speed, low cost and operational simplicity.

Default stack:

- Frontend: existing Vite/React PWA first; native shell only after retention.
- Edge/API: Cloudflare Workers for provider proxies and lightweight APIs.
- Database: Supabase Postgres/PostGIS for user, listing, merchant, moderation and event data.
- Storage: Cloudflare R2 or Supabase Storage for listing images.
- Auth: managed auth, email OTP or social login; phone verification only when needed.
- Payments: Stripe/PayNow on web/PWA for eligible flows; app-store billing for native digital boosts/subscriptions where required.
- Analytics: privacy-aware product analytics with event minimization.
- Monitoring: Sentry-style error tracking, uptime checks and provider health dashboards.
- CI/CD: GitHub Actions for lint, tests, build, security checks and deploy.

Build order:

1. Keep map and search fast without login.
2. Add an internal admin console before public posting.
3. Add read-only marketplace discovery.
4. Add accounts and saved intent.
5. Add controlled posting with manual review.
6. Add paid information fees on web/PWA.
7. Add native billing only after the model is proven.

## Product Strategy

Do not compete head-on with Google Maps, Waze, Carousell, PropertyGuru or food-delivery apps. Start from a narrower local wedge:

- Singapore building/HDB/condo search that feels better than generic maps.
- Tourist food and attraction discovery that respects public transport.
- Cross-border SG/JB movement where users need live local context.
- Local information posts tied to places, routes and neighbourhood intent.

The marketplace should emerge from map intent, not replace the map. A user should be able to search `310C`, find the building, see transit, save it, then later discover relevant nearby food, rental or second-hand information without the interface becoming noisy.

## Monetization Path

Phase 1: free trust product

- Free search, map, transit and saved places.
- Optional native sponsored cards in non-navigation surfaces.
- No paid marketplace until retention is proven.

Phase 2: local information fees

- Featured post fee for food, event, rental lead and second-hand categories.
- Urgent review fee for time-sensitive posts.
- Verified merchant profile subscription.
- Lead fee for high-intent categories after quality is proven.

Phase 3: B2B local intent tools

- Merchant dashboard.
- Mall/event/property manager map widgets.
- Route-start and save analytics.
- Privacy-preserving local trend reports.

Critical rule: paid content can improve visibility only inside relevant intent. It cannot pollute navigation, hide official search results or look like an organic result.

## Compliance Baseline

Singapore-local operations should assume PDPA obligations from day one.

Minimum product requirements:

- Privacy policy that explains collection, use, disclosure, AI assistance and retention.
- Data protection contact path.
- Consent and purpose limitation for posting, messaging and location features.
- Account deletion and listing deletion flow.
- Retention windows for expired listings, logs and moderation records.
- Data-breach response playbook.
- Vendor register for AI, hosting, analytics, email, payment and storage providers.
- Access control for admin tools and production data.

AI governance should follow a simple internal model:

- Define the AI use case.
- Define user impact.
- Decide the human review level.
- Log inputs/outputs where needed.
- Monitor false positives and user complaints.
- Give users a feedback or appeal path.

## 12-Month Execution Plan

### Month 0-1: Product Proof

- Finish official search, building search, visitor mode and commute mode.
- Track search success, route starts, saves and repeat sessions.
- Keep all provider keys server-side.
- Publish PWA privately for testing.

### Month 2-3: Singapore Company Prep

- Confirm company name and local director/operator role with a CSP.
- Prepare IP assignment, privacy policy, terms, support process and vendor register.
- Set up business email, domain ownership, accounting and bank readiness.
- Decide whether app-store accounts should be personal or company-owned for first launch.

### Month 3-5: Local Trust Alpha

- Add read-only food, attractions, rentals and second-hand discovery.
- Add admin console and data-quality workflow.
- Add public report flow and manual moderation.
- Recruit small Singapore/JB test group.

### Month 5-8: Controlled Marketplace

- Add account, saved listings and controlled posting.
- Launch one category at a time.
- Require review for all first-time posters and all rental posts.
- Add report/block and removal audit logs.

### Month 8-10: Paid Information Fee Pilot

- Start web/PWA paid featured posts only after organic usage exists.
- Keep density capped and labels clear.
- Measure paid renewal, reports per listing and search-to-contact quality.
- Avoid escrow, delivery and deposits.

### Month 10-12: Native And B2B Readiness

- Decide Capacitor or React Native shell.
- Prepare app-store compliance and billing model.
- Launch merchant dashboard v1.
- Package local-intent analytics for small merchants, malls or property operators.

## What Not To Do

- Do not build a generic classifieds app.
- Do not add chat, escrow and payments before moderation works.
- Do not let AI auto-ban users or auto-reject high-risk posts without appeal.
- Do not let sponsored posts cover map controls or navigation.
- Do not pay for expensive map/data providers before retention justifies it.
- Do not use the spouse/local director role as a passive nominee; directors have real duties.

## Source Anchors

- ACRA local company registration: https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/registering-via-bizfile/
- ACRA directors and company secretary requirements: https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/appointing-company-directors-other-key-officers/
- PDPC PDPA overview: https://www.pdpc.gov.sg/overview-of-pdpa/the-legislation/personal-data-protection-act
- Singapore AI governance framework: https://www.pdpc.gov.sg/help-and-resources/2020/01/model-ai-governance-framework
- Anthropic Claude Code agentic workflow reference: https://www.anthropic.com/product/claude-code
- Google Play payments policy: https://support.google.com/googleplay/android-developer/answer/9858738
- Apple App Review Guidelines: https://developer.apple.com/appstore/resources/approval/guidelines.html
