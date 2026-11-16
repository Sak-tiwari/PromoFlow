# Promo-Flow

A browser extension (Chrome/Edge, Manifest V3) for Indian shoppers. At checkout it tries coupon codes one at a time,
reads the site's bank/payment offers, and picks the best allowed combination: **at most one coupon plus one payment offer**.
A small Node.js/Express + MongoDB backend stores coupon candidates and anonymous success statistics.

College project. Zero-cost to run. Designed so more sites are added by configuration.

## Status (16 Nov 2026): v2 built, real sites not yet verified

Automated tests: 107 passing (`npm test`). Real Chromium was used to run the built extension on the local demo pages.

### Site support (honest table)

| Site | Fixture-tested | Live-verified by owner | Notes |
|---|---|---|---|
| Demo store, popup flow (`localhost:4000/modal.html`, `payment.html`) | Yes, and in real Chromium | n/a (it is ours) | Listed coupons, popup that closes itself, login wall, CAPTCHA stop, rate-limit stop, payment-page advice |
| Demo store, simple box (`localhost:4000/`) | Yes, and in real Chromium | n/a | The v1 flow with a collapsed "Have a promo code?" box |
| Myntra | **No.** Fixtures not captured yet | No | Blocked on M6: needs captures (see `tests/fixtures/README.md`) |
| Ajio | **No.** Fixtures not captured yet | No | Same |
| Nykaa | **No.** Fixtures not captured yet | No | Same |
| Amazon.in | No | No | Adapter written from memory, experimental, unverified. Amazon's terms forbid automated access: only run by hand, rarely |
| Flipkart | No | No | No site-specific rules. Flipkart mostly uses offers you select rather than codes you type, so this approach may barely apply |
| Any other site with a standard visible promo box | Only on our own demo page | No | Generic detector: may work, may not |

A site is **supported** only after the live checklist in [docs/LIVE_CHECKLIST.md](docs/LIVE_CHECKLIST.md) passes.

### What it does and does not do

- You click the icon on the cart or payment page. It never runs by itself, and asks only for `activeTab`, `scripting`, `storage` and `alarms`.
- It tries **known** codes one at a time (your own, the ones the site lists for your cart, shared ones from the backend), reads the real total after each, removes each code again, and leaves the best one applied. It never makes up codes.
- Coupon savings are measured from the page. Bank offers are shown as an **estimate** and are never applied; the payment page is read-only.
- It stops by itself on a CAPTCHA, a login wall, or a "too many attempts" message, and tries at most 6 codes on a recipe site.
- Your own codes are never shared. Anonymous result sharing is off unless you turn it on.
- These sites may already highlight their best listed coupon, so the extra value is from your own codes, a measured comparison, and the bank-offer pairing. A site redesign breaks that site's recipe until it is updated. The sites' terms may forbid automated use. This is not legal advice.
- Hindi, Marathi, Tamil and Telugu text is machine-drafted: see [docs/I18N_REVIEW.md](docs/I18N_REVIEW.md).
- The MongoDB code path (`backend/repo/mongoRepo.js`, and `--seed` with recipes) is written but has not been run against a real MongoDB.

### Built in v2

Diagnose capture (M1), recipe format and validation (M2), demo pages (M3), engine with drivers (M4), recipes served from the backend (M5),
payment-page advice (M7). Still open: **M6** (Myntra, Ajio, Nykaa recipes), which needs the captures described in `tests/fixtures/README.md`.

## Run it

```
npm install
npm run build        # creates dist/
npm run backend      # API on :3000 (in-memory data unless MONGODB_URI is set; add --seed to seed Mongo)
npm run demo         # demo store on http://localhost:4000  (/  and  /modal.html  and  /payment.html)
npm test
```
Chrome/Edge: chrome://extensions, Developer mode, Load unpacked, pick `dist/`. Open http://localhost:4000/modal.html, click the Promo-Flow icon, press "Find best savings".
Demo options: `?loggedout=1` shows a login wall, `?captcha=1` shows a CAPTCHA after the third try.

## Docs

| Doc | What it covers |
|---|---|
| [docs/V2_BUILD_BRIEF.md](docs/V2_BUILD_BRIEF.md) | Next version: plan for Myntra, Ajio and Nykaa, and step-by-step build instructions for a coding model |
| [docs/LIVE_CHECKLIST.md](docs/LIVE_CHECKLIST.md) | The manual check that decides whether a real site counts as supported |
| [docs/I18N_REVIEW.md](docs/I18N_REVIEW.md) | Every translated string, for a native-speaker review |
| [docs/PLAN.md](docs/PLAN.md) | The current plan: product, your answers applied, platforms, data, compliance, roadmap |
| [docs/archive-saas-engine/](docs/archive-saas-engine/) | An earlier merchant-side SaaS design (not the product). Kept for reference: some parts, such as the paise money rules and India compliance research, are reusable |

## Planned layout (from your original plan, plus additions)

```
promo-flow/
├── manifest.json
├── src/
│   ├── algorithms/   Trie.js, MaxHeap.js, MinHeap.js, Knapsack.js
│   ├── adapters/     generic.js, amazon.js, flipkart.js
│   ├── background/   serviceWorker.js
│   ├── content/      domDetector.js, contentScript.js
│   └── ui/           popup.html, popup.js
├── _locales/         en, hi, mr, ta, te
├── backend/          server.js, models/, scripts/ingest/
└── tests/
```
