# Promo-Flow

A browser extension (Chrome/Edge, Manifest V3) for Indian shoppers. At checkout it tries coupon codes one at a time,
reads the site's bank/payment offers, and picks the best allowed combination: **at most one coupon plus one payment offer**.
A small Node.js/Express + MongoDB backend stores coupon candidates and anonymous success statistics.

College project. Zero-cost to run. Designed so more sites are added by configuration.

## Status

Planning. No application code yet. Waiting for answers to the questions at the end of [docs/PLAN.md](docs/PLAN.md).

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
