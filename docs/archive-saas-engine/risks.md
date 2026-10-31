# Risk register

Rated by impact × likelihood for this project. The first three are the biggest technical risks.

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| R1 | **Limits and budgets under concurrency**, especially one viral code hammering one counter row | High | Medium | Atomic conditional updates only; sharded counters designed in; concurrency test (N parallel vs limit K, exactly K succeed) and k6 load test in M4 *before* claiming any throughput; budget is a ledger, reconciled by a job |
| R2 | **Money and GST correctness** (rounding, allocation sums, GST treatment of third-party-funded offers) | High | Medium | Integer paise; one money package; property tests for every invariant; golden cart fixtures with hand-checked GST; `funded_by`/`tax_treatment` configurable; CA review before real use |
| R3 | **Tenant isolation and stale caches** (cross-tenant leak; stale rule set gives wrong discounts) | High | Low–Medium | RLS with `SET LOCAL`, no `BYPASSRLS` role, data layer refuses unscoped queries, cache keys include org, store and version, `NOTIFY` invalidation plus TTL, cross-tenant CI tests |
| R4 | **Zero-cost hosting is fragile** (Oracle signup or capacity problems; free DB tiers sleep) | Medium | High | Primary target is local Docker Compose, so the demo never depends on a free cloud; Oracle is optional; Neon only as a demo fallback |
| R5 | **Scope versus a 2-person college timeline** | High | High | Explicit MVP/deferred table, one milestone at a time, a cut order agreed in advance (see scope doc), nothing dropped silently |
| R6 | **Misinterpreting Indian regulation** (dates differ between sources; GST point debated) | Medium | Medium | Document assumptions, keep behaviour configurable, label as not legal advice, get a lawyer/CA before real merchants |
| R7 | **Translation quality** in four Indic languages; rendering of Devanagari/Tamil/Telugu | Medium | Medium | Native-speaker review, self-hosted Noto fonts, a CI check for missing keys, locale-specific tests for text overflow, Latin digits forced for money |
| R8 | **"Try the coupons" turns into code harvesting or leakage** | Medium | Medium | Only codes marked `discoverable` are ever auto-tried; private/targeted codes never; brute-force limits and lockouts on code input; leak detection |
| R9 | **Customer facts incomplete** (first-order status is only as good as the orders Promo Flow sees) | Medium | High | Document it; recommend merchants call redeem (even with no promotion) for every paid order; accept a merchant-supplied `order_count` as an override |
| R10 | **Dependency churn** (very recent major versions of Vitest, Vite, i18next) | Low | Medium | Lockfile, Renovate-style manual upgrades, versions re-verified at M1 start |
| R11 | **Auth library fit** (self-hosted Better Auth) | Medium | Low–Medium | One-day spike in M1 against requirements (multi-org membership, magic link, API keys); fallback is a thin custom implementation with argon2 |
