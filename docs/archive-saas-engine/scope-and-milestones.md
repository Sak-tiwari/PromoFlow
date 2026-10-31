# Scope and milestones

## 1. How your answers were applied

| Your answer | How the design uses it |
|---|---|
| Compute tax-aware discounts | GST is part of the engine. Cart lines carry a GST rate; prices are GST-inclusive by default. Every result includes a per-line tax breakup (CGST/SGST or IGST). Each promotion says who **funds** the discount (merchant or third party such as a bank), which decides whether it reduces taxable value. See [money-and-tax.md](money-and-tax.md). |
| Single call at payment | The core call is `POST /v1/redemptions`, made when the shopper pays. It re-evaluates the cart and commits atomically. A dry-run `POST /v1/quotes` exists for showing prices earlier. Reserve/release is **designed but deferred** (ADR-0006). If payment fails after redeem, the merchant calls reverse with reason `payment_failed`. |
| Merchant does not send tags; Promo Flow checks from datasets and tries the coupons | Interpreted as: (a) customer facts such as order count and first-order status come from **Promo Flow's own redemption ledger**, not from merchant-sent tags; (b) when no code is supplied, the engine **tries all eligible auto-apply and "discoverable" coupons** and picks the best. Private or targeted codes are never auto-tried. See ADR-0007. **Please confirm this reading.** |
| One coupon at a time, or check for a bundled bank offer | Two slots: **coupon** (at most one) and **payment** (at most one). The engine searches the pairs and returns the best valid combination. |
| Max 2 per cart: a coupon plus a bank/payment offer (usually the website's own) | Same as above. Auto-apply merchant deals count in the coupon slot, so the total can never exceed 2. Payment offers are created by the merchant in Promo Flow and can be marked merchant-funded or bank-funded. |
| Shoppers from India only | Currency fixed to INR (the field stays, so it is extensible). GST only. Data stays in an India region if hosted. |
| Compliance: research and follow Indian limits | See [compliance-india.md](compliance-india.md). Not legal advice. |
| Self-hosted auth is fine | Self-hosted TypeScript auth library (Better Auth candidate, confirmed by a spike in M1). SSO is out of scope for now. |
| Try for a dedicated database | The data layer has a **tenant router**: by default all tenants share one Postgres with row-level security; a tenant can be pointed at its own database through configuration. At 0 INR we run one shared DB plus one demo tenant on a second Postgres container. See ADR-0003. |
| Team is you and me; budget 0 INR | Everything runs in Docker Compose on a laptop. No paid service anywhere. Postgres is the only datastore (no Redis). See ADR-0002 and ADR-0009. |
| English, Hindi, Marathi, Tamil, Telugu in the frontend | i18next with five locale files, self-hosted Noto fonts, and merchant-authored shopper messages stored per locale. See ADR-0008. |
| Scalable and working, but not too heavy | Modular monolith, one datastore, no Kubernetes, no microservices. Scale path in [ARCHITECTURE.md](ARCHITECTURE.md#9-scale-path). |

## 2. MVP versus deferred

Nothing below is dropped silently. Each deferred item has a design hook so it can be added later.

| Area | In the MVP | Deferred (design hook already in place) |
|---|---|---|
| Auth | Email + password, magic link, email verification, reset, invitations | MFA, Google login, SAML SSO (auth is behind an interface) |
| Roles | Owner, Admin, Marketer, Analyst, Support, Developer as a permission table | Custom roles |
| Benefits | All 9 types in the brief | none |
| Stacking | Coupon slot + payment slot, best-combination search | More slots (policy field exists) |
| Redemption | Quote, redeem (single call), reverse (full and partial), idempotency | Reserve/release with TTL |
| Codes | Shared, unique batches (tested to 1M; design streams to 10M), auto-apply, CSV import/export | Referral/personal codes (model exists, feature later) |
| Limits | Total, per customer, per period, budget, thresholds at 50/80/100% | none |
| Concurrency | Atomic conditional updates; sharded counters if the load test needs them | Redis Lua |
| Dashboard | All pages in the brief, five languages | none |
| Analytics | Events, hourly/daily rollups, CSV export | Warehouse export |
| Webhooks | HMAC-signed, retries, delivery log, auto-disable | none |
| Fraud | Rate limits, lockouts, leak detection, signal recording | Scoring |
| Billing, platform admin UI, segments sync, Shopify/WooCommerce apps, A/B tests | Not built | Data model hooks only (plans/entitlements interface; admin via CLI scripts) |

## 3. Milestones (each needs your approval before the next starts)

| Milestone | Output | Approx. effort (me writing, you reviewing/running) |
|---|---|---|
| **M0 (this)** | These docs | done, awaiting approval |
| **M1 Foundation** | Monorepo, Docker Compose, CI, config, logging, auth, orgs/stores, RBAC, API keys, audit log, tenant router + RLS with cross-tenant tests | 1 to 2 weeks |
| **M2 Rules engine** | `packages/money` and `packages/rules-engine` with property tests and golden cart fixtures, including GST | 1 to 2 weeks |
| **M3 Promotions & codes** | CRUD, versions, lifecycle, code generation/import/export jobs | 1 to 2 weeks |
| **M4 Redemption API** | Quote, redeem, reverse, idempotency, rate limits, counters, test mode, concurrency and load tests | 1 to 2 weeks |
| **M5 Dashboard** | All pages, rule builder, simulator, five languages | 2 to 3 weeks |
| **M6 Events/webhooks/analytics/notifications** | As in the brief | 1 to 2 weeks |
| **M7 Hardening** | Fraud controls, perf tuning, security review, SDK, docs | 1 to 2 weeks |

The effort column is a rough guess, not a commitment. It depends on your timeline, which I don't know yet.
If the semester deadline is tight, the cut order I'd propose is: M6 notifications, then the visual rule builder
(use a JSON editor with validation), then the 1M-code batch test.

## 4. Questions I still need answered

1. **Datasets / "try the coupons":** is my reading right (own ledger for customer facts, auto-try of discoverable coupons)? Or do you want Promo Flow to also pull coupon codes from outside datasets, as in the earlier browser-extension idea? The second would be a different product.
2. **Dedicated database:** is "shared DB by default, per-tenant DB routable, one demo tenant on its own DB" enough for the project?
3. **GST:** OK to assume GST-inclusive prices and a merchant-funded default for payment offers? The third-party-funded treatment is debated (see money-and-tax.md), so I made it a per-promotion setting.
4. **Translations:** I will draft Hindi, Marathi, Tamil and Telugu. Native speakers should review them before any real use. Can you get them reviewed, or is machine-drafted fine for the demo?
5. **Timeline:** how many weeks until the project is due?
