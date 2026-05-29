# API Application Pack

This document is the working submission pack for official data access. Keep credentials and passwords out of the client app and out of Git.

## LTA DataMall

Official page: https://datamall.lta.gov.sg/content/datamall/en/request-for-api.html

### Recommended Form Choices

- Purpose of usage: `Mobile APP`, `Website/Portal`
- Company name: `LokaLane` if no registered entity exists yet
- Mailing list: optional
- API key storage: server-side Cloudflare Worker only

### Description

LokaLane is a free Singapore-first, Malaysia-ready local navigation and public transport map application for commuters, visitors, drivers, and cross-border users. We plan to use LTA DataMall APIs for public transport and mobility features including bus arrivals, bus stops/routes, carpark availability, train service alerts, station crowd density, EV chargers, traffic incidents, and expressway travel-time signals.

The app will show source attribution, timestamps, and user-friendly freshness indicators so users understand when data is official, live, cached, or estimated. API keys will be stored only in a server-side Cloudflare Worker/API gateway and will not be exposed in the mobile app or PWA client.

### Required Before Submit

- Applicant legal name
- Contact phone number
- Email address
- Captcha / verification code
- Acceptance of LTA terms

## OneMap

Official registration page: https://www.onemap.gov.sg/apidocs/register

Official authentication page: https://www.onemap.gov.sg/apidocs/authentication

### Recommended Form Choices

- User group: `Others` until a registered company exists
- Application type: `Mobile Application`
- How did you learn about OneMap: `Google Search`
- Company: `LokaLane`

### Proposed Use

OneMap currently enforces a 300-character limit on this field. Use this short version:

Personal research for LokaLane, a free SG local map prototype for mobile/web. Evaluating OneMap for address search, official map context, geocoding and place discovery. Credentials stay server-side.

### Required Before Submit

- First name
- Last name
- Email address
- Agreement to OneMap privacy statement, open data policy, and API terms
- Any verification challenge shown by the registration page

## Secret Handling

Production secrets should be created only in the deployment environment:

- `ONEMAP_EMAIL`
- `ONEMAP_PASSWORD`
- `LTA_ACCOUNT_KEY`

Never add these values to `.env.local` in Git, screenshots, issue descriptions, or client-side Vite variables.
