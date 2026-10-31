# Promo-Flow

A browser extension (Chrome/Edge, Manifest V3) for Indian shoppers. At checkout it tries coupon codes one at a time,
reads the site's bank/payment offers, and picks the best allowed combination: **at most one coupon plus one payment offer**.
A small Node.js/Express + MongoDB backend stores coupon candidates and anonymous success statistics.

College project. Zero-cost to run. Designed so more sites are added by configuration.

## Status (31 Oct 2026)

Working core, built for a 4-day deadline.

**Verified (automated, 45 tests + one real-Chromium run):** money/Indian grouping, Trie, MaxHeap/MinHeap, knapsack DP (checked against brute force), offer parser, the sequential apply engine, backend API, i18n key parity, TTL cache. The packaged extension was loaded in headless Chromium and run against the local demo store: it tried 6 codes, applied the best (SAVE10, saved ₹150.00 measured), and showed the HDFC offer as an estimate.

**Not verified:** Amazon.in and Flipkart adapters (written from memory, no access to live checkouts from the build sandbox; marked experimental in the UI), `backend/repo/mongoRepo.js` (no MongoDB in the sandbox), Domino's/Zomato (optional, not researched).

**Cut from the plan:** selector recorder, Kindred dataset ingestion, Web Store packaging/privacy policy, Hindi/Marathi/Tamil/Telugu human review (machine drafts).

## Run it

```
npm install
npm run build        # creates dist/
npm run backend      # API on :3000 (in-memory data unless MONGODB_URI is set; add --seed to seed Mongo)
npm run demo         # fake checkout on http://localhost:4000
npm test
```
Chrome/Edge: chrome://extensions → Developer mode → Load unpacked → pick `dist/`. Open the demo checkout, click the Promo-Flow icon, press "Find best savings".

## Docs

| Doc | What it covers |
|---|---|
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
