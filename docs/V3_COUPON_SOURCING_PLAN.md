# V3 plan: find fresh coupons from the web, rank them, try the best, compare

Status: plan only. Nothing here is built yet.

## 1. Goal

Today Promo-Flow tries (a) codes the shopper adds, (b) codes the site lists in its own coupon panel, and (c) a small seed list. On Myntra that means only MYNTRASAVE. V3 adds a **backend harvester** that collects recent codes from outside sources, keeps them fresh, ranks them, and serves the best few to the extension, which then tries them and compares the measured totals as it already does.

## 2. Facts that shape the design

1. **The extension can only try a few codes per run.** The cap is 6 tries with a 1.5 s gap plus jitter, to avoid tripping store limits or flagging the account. A list of 200 web codes is useless unless the right 6 come first. **Ranking matters more than volume.**
2. **Many "coupons" on the web are not codes.** Coupon sites list deals ("no code needed", "up to 70% off"), expired codes, and codes tied to one account or first order (MYNTRA300-style). Expect a low hit rate on Myntra and design for it.
3. **Where codes come from is a legal question, not only a technical one.**
   - Coupon aggregator sites (GrabOn, CouponDunia and similar) usually forbid scraping in their terms. Their terms have not been checked, so treat them as **off-limits** until checked and permitted.
   - Affiliate networks in India (Cuelinks, vCommission, INRDeals, LinkMyDeals and others) offer publisher APIs or feeds. Some include coupon codes with expiry dates. Joining is usually free but needs approval, and their terms may require their tracking links. That would conflict with our current "no affiliate links" rule, so read the terms before signing up.
   - Bank and card network offer pages (for example Visa's Myntra offers page) describe **bank offers, not coupon codes**. They feed the existing bank-offer advice, not the coupon list.
4. **Freshness has no single source of truth.** "Most recent" means the newest of: when a source first listed the code, when it was last seen, its stated expiry, and when a Promo-Flow user last saw it work.

## 3. Sources, in order of preference

| # | Source | What it gives | Status |
|---|---|---|---|
| S1 | The site's own coupon list | Codes valid for this cart | Built (recipes) |
| S2 | Shopper's own codes | Codes the user has | Built |
| S3 | Affiliate network feed (one network to start) | Code, store, expiry, description | Needs publisher signup and a terms check |
| S4 | Opt-in community sharing: a "share this code" button | Codes other users saw work | New. Off by default, explicit consent (DPDP) |
| S5 | Public datasets or repos with a licence that allows reuse | Older codes, mostly stale | Use only as a low-score fallback |
| S6 | Coupon aggregator sites | Many codes | Do not use unless their terms allow it, in writing |
| S7 | Bank, card and UPI offer pages | Bank offers | Goes to bank-offer advice, not coupons |

## 4. Architecture

```
            ┌──────────── backend (Node/Express + MongoDB) ────────────┐
 S3 feed ──►│ harvester job (cron, every 6 h)                         │
 S4 share ─►│   → normalize → de-duplicate → validate → upsert        │
 S5 data ──►│ coupons: {domain, code, source, firstSeen, lastSeen,    │
            │           expiresAt, minSpend, desc, tries, successes,  │
            │           lastSuccessAt, lastFailAt, status}            │
            │ scorer → GET /api/v1/coupons/:domain?k=12 (ranked)       │
            └──────────────────────────────────────────────────────────┘
                               │
 extension: user codes → site-listed eligible codes → top harvested codes → try ≤ 6 → knapsack → overlay
                               │
            opt-in outcome reports (existing POST /coupons/report) → updates tries and successes
```

### 4.1 Harvester (new: `backend/harvest/`)
- One **adapter per source**: `fetch()` returns raw items, `toCoupon(item)` maps one item.
- **Normalize:** uppercase the code; keep only `[A-Z0-9_-]{3,32}`; map hosts (`myntra.com`, `www.myntra.com` → `myntra.com`); parse expiry, minimum spend and "first order only".
- **Reject:** items with no code (deals), already expired, or "first order"/"new user" when the shopper is not new (keep these but mark them).
- **De-duplicate** on (domain, code). Keep every source the code came from, the earliest `firstSeen` and the latest `lastSeen`.
- **Run:** a free scheduled job (GitHub Actions cron, or `node-cron` in the backend). Respect each source's rate limits; cache raw responses; never run from the extension.

### 4.2 Scorer (`backend/ranking.js`, extended)
`score = reliability × freshness × fit`, all between 0 and 1:
- **reliability** = Wilson lower bound of successes/tries (already built). With no reports, a per-source prior (feed 0.30, community 0.40, dataset 0.05).
- **freshness** = `0.5 ^ (days since max(lastSuccessAt, lastSeen) / 7)`. Half-life 7 days, so a code last seen two weeks ago scores a quarter.
- **fit** = 0 if expired, or if a known minimum spend is above the cart total (the extension sends a rounded cart band, never the exact total). Otherwise 1, or 0.5 if marked "first order".
- **Hard drop:** 3 failures from different clients in 24 h and no success since, so the status becomes `dead` for 3 days.
- Server returns the top 12 by score. The extension's MaxHeap keeps working as is.

### 4.3 Extension changes
- Merge order stays: user codes → site-listed eligible codes → harvested codes by score. The 6-try cap stays.
- New **"Try 6 more"** button after a run, only on a user click and only after a 30 s cooldown. It sends the codes already tried so the server skips them.
- Overlay table: every code tried with its **measured** saving, its **source** ("site", "shared", "feed") and **age** ("seen 2 days ago"). The knapsack pick is unchanged, and bank offers stay estimates.
- Telemetry rule unchanged: never report a code the user typed. Report harvested and listed codes only, opt-in.

### 4.4 Community sharing (S4)
- After a code **measurably** lowers the total, offer "Share this code with other Promo-Flow users?" It is off by default and asks every time unless the user picks "always".
- Send only domain, code and outcome: no cart contents, no account data.
- Abuse limits: per-client rate limit; a code needs 2 distinct clients before it is served widely.

## 5. Milestones

| ID | Work | Done when |
|---|---|---|
| H1 | Schema fields + migration; memory repo support | Backend tests cover the new fields |
| H2 | Normalizer + de-duplication + rejection rules | Unit tests on fixture feeds (good, deal-only, expired, duplicate, bad domain) |
| H3 | Scorer (reliability × freshness × fit, dead status) | Table-driven tests incl. ordering cases |
| H4 | First source adapter (S3 or S5), run by a scheduled job | Runs against a saved sample response in tests; live run documented |
| H5 | API: `k`, `exclude`, cart band; extension "Try 6 more" | Extension tests + demo store run in Chromium |
| H6 | Overlay: source and age columns | Snapshot test of the overlay |
| H7 | Opt-in sharing (S4) | Consent off by default; tests for no-consent / consent / rate limit |
| H8 | Live check on Myntra with the owner | Checklist passes; hit rate recorded honestly |

Tests never call live sources: every adapter is tested against saved sample responses in `tests/fixtures/feeds/`.

## 6. Decisions for the owner before H4

1. **Which first source?** Sign up for one affiliate network as a publisher (may need a website), or start with a reusable public dataset (stale, but no signup).
2. **Affiliate links:** if the feed's terms require tracking links, either accept them (and disclose them clearly in the extension and store listing), or skip that feed.
3. **Community sharing (S4):** build it now or later.
4. **Hosting for the scheduled job:** GitHub Actions cron (free) writing to MongoDB Atlas free tier, or the laptop backend only during demos.

## 7. Expectations

- Hit rate on Myntra will stay low: most working Myntra coupons are the ones Myntra itself lists for the account, and those are already read. Web codes add value mainly on stores that honour public codes.
- Savings remain **measured page totals only**. A harvested code is only a candidate until the store accepts it.
- Not legal advice: check each source's terms before using it.
