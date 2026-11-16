# Promo-Flow (browser extension): implementation plan v2

> **Update 16 Nov 2026.** The current plan for Myntra, Ajio and Nykaa, and the milestone-by-milestone build, is
> [V2_BUILD_BRIEF.md](V2_BUILD_BRIEF.md). This v2 plan below is the original product plan. The Amazon and Flipkart adapters in
> `src/adapters/index.js` are **unverified legacy**: they were written from memory and have never been run on the live sites. They
> become recipes only if fixtures are supplied (see `tests/fixtures/README.md`).

Status: **Proposed.** Builds on your original `promo_flow_implementation_plan.txt` and the first plan I wrote, and applies
your later answers. Nothing here is built yet.

## 1. Product

A Chrome/Edge (Manifest V3) extension for **Indian shoppers**. When the shopper opens the payment/checkout step and
clicks Promo-Flow, it:

1. gets candidate coupon codes for that store from the backend (seeded from datasets, feeds and users' success reports);
2. tries them **one at a time** on the page and reads the real total after each;
3. also reads the **bank / payment offers** the site shows;
4. picks the best allowed combination, **at most 2: one coupon plus one payment offer**, and shows the saving.

The backend is small: a coupon/offer database with success statistics, and anonymous opt-in reporting. There are no
merchants, tenants or API keys. The earlier SaaS design is in [archive-saas-engine/](archive-saas-engine/) and is not the product.

## 2. Your answers applied

| Your answer | Applied how |
|---|---|
| Tax-aware | Ranking and the final choice use the **final payable amount including GST and fees as the site shows it**, not the pre-tax subtotal. The extension never recomputes tax; it reads the page's total after each attempt (open question 2) |
| Single call at payment | A run happens only on the payment/checkout step and only after the shopper clicks. No background auto-apply |
| No tags; check datasets and try the coupons | The extension has no customer tags. Candidates come from the backend database; whether a code works for this shopper is found by **trying it** |
| One coupon at a time, or check if a bank offer can be bundled | Strictly sequential attempts; stop at the first clearly best result or after the attempt cap. Then read bank offers and test the best combination |
| Max 2 per cart (coupon + bank/payment offer, the latter usually the site's own) | Two slots: `coupon` and `payment_offer`. Bank offers are mostly **read and advised**; applying one happens only where the site lets the extension select it without touching payment fields |
| India only | INR; Indian sites first; Indian digit grouping (₹1,23,456.00); India-region hosting preferred |
| Compliance as per India's limits | Section 7 |
| Self-hosted is fine; dedicated database | Own backend. Database: **MongoDB Atlas free cluster (a dedicated 512 MB cluster) or a local MongoDB**, as in your original plan |
| 0 INR, college project, scalable but not heavy | Section 8 |
| Frontend languages: English, Hindi, Marathi, Tamil, Telugu | Popup and overlay via `chrome.i18n` (`_locales/{en,hi,mr,ta,te}`) |
| Translation: machine-drafted is fine | I draft; text stays in one place so it can be reviewed later |

## 3. What stays from the original plan

Everything in your document stands: Trie, hash map/set, MaxHeap, MinHeap, 0/1 knapsack DP, MV3 structure, Express + MongoDB,
the two endpoints, the 12-day roadmap (stretched to 14 for the Amazon/Flipkart adapters). The changes are:

- **Knapsack becomes a grouped (multiple-choice) selection** over two slots. With at most one coupon and one payment offer,
  the search space is small (coupons × offers), so the DP is exact and fast; it is still used where a site allows several
  item-level or shipping discounts.
- **Tax-aware objective:** maximize `savings = baseline_payable − observed_payable`, measured from the page. Estimated values are only used to
  *order* attempts (MaxHeap), never to claim a saving.
- Add `MinHeap.js` to the folder tree (your tree omits it).
- Keep JavaScript (ES6+), not TypeScript, as your plan specifies.

## 4. Platforms

| Tier | Sites | Approach | Honest status |
|---|---|---|---|
| 1 | Amazon.in, Flipkart | Dedicated adapters. Amazon: clip-coupon finder, promo-code tester at the payment step, bank-offer advisor. Flipkart: offer parser/ranker (sale → one bank offer → SuperCoins/exchange) plus a coupon box where present | Amazon's terms prohibit automated access, so runs are user-triggered, low-volume and inside the shopper's own session. Live checkouts can't be tested from my sandbox, so adapters are built on saved pages plus a selector recorder, and you verify on the real sites |
| 2 | Domino's and Zomato web checkouts | Config-only if they fit the generic engine, else a small adapter | **Not researched yet.** Food apps are mostly app-based, and an extension can't touch the mobile app. I'll check their web checkouts before promising anything |
| 3 | Shopify, WooCommerce, Magento, BigCommerce stores | Generic engine with platform presets (as in the first plan) | Testable here with local test stores |

No plan can promise "all platforms". The design goal is that adding a site is a config change, not a rewrite.

## 5. Data and backend

- **Datasets** (details from my earlier research): Kindred Merchant Deals Dataset (brands and domains, about 4M offers, **no code column**, last data commit May 2025, so mostly expired) is used to seed `Stores` and learn code-format patterns. Whale Coupons (public JSON feed) is a live source still to be checked for Indian coverage and terms. Keyed feeds (LinkMyDeals, CouponAPI.org, Sovrn) are optional. Domino's, Zomato, Amazon and Flipkart have few or no shareable public codes, so for them the real "data" is what the page shows plus crowd reports.
- **Avoid:** scraping Honey, RetailMeNot, Capital One Shopping, Karma or CouponFollow (terms-of-service risk). Never harvest welcome, employee or influencer codes.
- **Collections:** `Stores` (domain, adapter, selector config, policy), `Coupons` (domain + normalized code unique, source, type/value, min spend, expiry, stats with Wilson lower bound and time decay), `Analytics` (anonymous outcome events, 90-day TTL).
- **Endpoints:** your two (`GET /api/v1/coupons/:domain`, `POST /api/v1/coupons/report`) plus `GET /api/v1/stores/:domain/config` and `/health`.
- **Abuse controls:** schema validation, rate limits, Mongo operator sanitising, CORS locked to the extension id, a code's rank moves only after reports from several distinct clients.

## 6. Extension internals (summary)

- **Run flow:** click → `inspect()` → candidates (cache/API via service worker) → dedupe (Set/Map) → Trie validation + prior → score → MaxHeap top-K (about 10) → rate-limited loop (500 ms + jitter, hard cap, abort button, stop at any CAPTCHA) → bank-offer read → best combination → report.
- **Success** means the observed total fell and no error text appeared. A false "success" is the worst bug, so outcomes are classified (`applied`, `invalid`, `expired`, `min_spend_not_met`, `not_applicable`).
- **MV3:** the service worker is ephemeral, so no state lives in globals. The ranking is a pure function. The TTL MinHeap is persisted and rebuilt on wake via `chrome.alarms`.
- **DOM:** React/Vue-safe input setting, three ways to read totals (MutationObserver, message text, the page's own cart responses via a MAIN-world script), SPA route changes, shadow DOM, collapsed promo sections.
- **Permissions:** `activeTab`, `scripting`, `storage`, `alarms`, plus host permissions only for the named adapters. No `declarativeNetRequest`.
- **Never** touches card or payment fields, and never auto-runs.

## 7. Compliance (extension-specific)

Not legal advice; the detailed Indian-law research is in [archive-saas-engine/compliance-india.md](archive-saas-engine/compliance-india.md) and still applies where noted.

| Area | Design response |
|---|---|
| **Chrome Web Store policy** (earlier research) | Affiliate codes only after a user action, and no affiliate link when no coupon is found. We use **no affiliate links at all** |
| **Site terms** (Amazon forbids robots/automatic devices) | User-triggered, low-volume, in the shopper's own session; attempt cap; no automated testing against Amazon |
| **DPDP Act and Rules 2025** | Telemetry is **opt-in, anonymous and minimal** (domain, code, outcome class, savings bucket). No names, emails, addresses or order details. A privacy notice in the extension, a way to opt out, and deletion of any identifiers on request |
| **RBI card rules** | The extension never reads or stores card details. It reads only offer text and totals |
| **Dark patterns / consumer protection** | "Savings found" must be real: shown only from observed totals, never estimates. No fake urgency in the UI |
| **CERT-In** | Applies to the backend if hosted: logs without personal data, kept 180 days in India |

## 8. Zero-cost hosting

Local Node + local or Atlas-free MongoDB for the demo; the extension is loaded unpacked (no Web Store fee). Verify any free-tier
terms (Atlas, hosting) at deployment time, since they change.

## 9. Roadmap (14 days, as in the first plan)

| Phase | Days | Built | Done when |
|---|---|---|---|
| 0 Foundations + data | 0 | Repo, lint and tests, MongoDB, Kindred brands → `Stores`, check the Whale feed | `npm test` runs; `Stores` has Amazon.in, Flipkart and a few hundred domains |
| 1 Core algorithms | 1–3 | Trie with counters, MaxHeap, MinHeap, 2-slot grouped knapsack, paise money util | Property tests against brute force; benchmarks |
| 2 Engine + adapters | 4–8 | Apply engine, totals observer, generic presets, Amazon and Flipkart adapters, selector recorder | Fixture tests pass; WooCommerce test store works; manual checklist on Amazon/Flipkart (you) |
| 3 Service worker + storage | 9–10 | Cache, ranking feed, TTL MinHeap with alarms, resumable runs | Killing the worker mid-run resumes |
| 4 Backend + analytics | 11–12 | Express endpoints, Mongo schemas, ingestion, feedback loop, abuse controls | API tests pass; reports re-rank codes |
| 5 UI + QA | 13–14 | Overlay and popup in five languages, consent screen, platform QA, README, report | Platform matrix signed off |

## 10. Questions before I start Phase 0

1. **Timeline:** how many weeks until it's due? That decides what gets cut first.
2. **Tax-aware:** is "decide on the final payable amount including GST as the site shows it" what you meant? Or did you want the extension to compute GST itself?
3. **Database:** is MongoDB (Atlas free cluster or local) fine as the "dedicated database", as in your original plan?
4. **Domino's and Zomato:** shall I research whether their web checkouts can work before committing, and treat them as optional?

If you say "go with your defaults", I'll use: Atlas free or local Mongo, final-payable objective, Domino's/Zomato researched as optional, and start Phase 0 and 1.
