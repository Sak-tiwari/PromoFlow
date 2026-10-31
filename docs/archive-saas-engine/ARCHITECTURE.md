# Architecture

Status: **Proposed (M0)**. Decisions behind each choice are in [decisions/](decisions/).

## 1. Goals and constraints

- Multi-tenant SaaS promo engine for Indian merchants. Shoppers are in India; INR and GST only.
- Hot path: `quote` and `redeem`. Design target from the brief: ~100 merchants at launch, 10,000 merchants and
  5,000+ validate requests per second by adding instances. p95 < 50 ms, p99 < 150 ms server-side.
- Budget: **0 INR**. Team: two people. A college project, so it must stay small enough to finish.
- These targets are **design targets, not measured results.** The M4 load test is what proves or disproves them.

## 2. System context

```
 Merchant checkout / server ──(REST, secret key)──┐
 Browser widget  ──(publishable key, quotes only)─┤
                                                  ▼
                               ┌────────────────────────────┐        ┌───────────────┐
 Merchant team ──(browser)──▶  │  apps/api (Fastify)         │◀──────▶│  PostgreSQL   │
   apps/dashboard (React)      │  modular monolith, stateless│        │  (only store) │
                               └──────────┬─────────────────┘        └──────▲────────┘
                                          │ outbox rows                     │
                                          ▼                                 │
                               ┌────────────────────────────┐              │
                               │ apps/worker (pg-boss jobs)  │──────────────┘
                               │ codegen, import/export,     │──▶ webhooks, email (SMTP/Mailpit)
                               │ webhooks, rollups, expiry   │
                               └────────────────────────────┘
```

API servers hold no state between requests, so they scale out horizontally. Workers scale separately.

## 3. Modules (modular monolith)

Each module under `apps/api/src/modules/<name>` exposes one public `index.ts` and keeps everything else private.
`dependency-cruiser` runs in CI and fails the build if a module imports another module's internals or reads its tables.

| Module | Owns |
|---|---|
| `tenancy` | organizations, stores, memberships, invitations, tenant router, RBAC |
| `auth` | users, sessions, password/magic link, API keys |
| `promotions` | promotions, versions, lifecycle, templates |
| `codes` | codes, batches, import/export |
| `redemptions` | quote/redeem/reverse, counters, budget ledger, idempotency, customers |
| `analytics` | events, rollups, exports |
| `webhooks` | endpoints, deliveries, signing |
| `notifications` | in-app and email notifications |
| `audit` | append-only audit log |
| `billing`, `admin` | stubs only (deferred): an entitlement interface and CLI scripts |

`packages/rules-engine` and `packages/money` are standalone and import nothing from the apps. Business logic lives in
module services, never in route handlers or React components.

## 4. Request flows

### 4.1 Quote (dry run, changes nothing)

1. Authenticate the key (hashed lookup, cached briefly) → store and tenant. Publishable keys may call only this endpoint.
2. Load the store's **compiled rule set** from the in-process LRU (key: `store_id + rules_version`).
3. Normalize the cart (`money`): validate, compute line gross and taxable values.
4. Load customer facts from the ledger (one indexed read) if a customer id was sent.
5. Candidates: the supplied code, plus automatic promotions, plus discoverable coupons if no code was supplied,
   plus payment offers matching the payment info (or all of them if payment is not known yet).
6. Evaluate conditions (pure). Each promotion is `eligible` or `rejected` with reason codes and near-miss nudges.
7. Combination search: (coupon-slot candidates ∪ none) × (payment-slot candidates ∪ none). At most one per slot, so
   the space is small and the search is exact. Pick the largest total discount; ties go to higher priority, then
   lower promotion id, so the result is deterministic.
8. Tax breakup per [money-and-tax.md](money-and-tax.md). Return applied, rejected (with nudges), totals, tax, and
   `payment_offer_options` (what each payment method would save) for checkouts that pick the payment method later.

### 4.2 Redeem (single call at payment)

Same pipeline, then inside **one database transaction**:

1. Insert the idempotency record (unique on store + key). A repeat returns the stored response.
2. Take counters atomically: `UPDATE usage_counters SET used = used + 1 WHERE … AND used < limit` for each limit,
   and for the budget `… WHERE remaining >= amount`. No read-then-write.
3. If any step fails because a limit was just consumed, roll back, re-run the pipeline once without that
   promotion and compare with `expected_payable`. If the amount changed, return `409 PRICE_CHANGED` and let the
   checkout re-display. The shopper never silently pays a different amount.
4. Insert redemption + per-line allocations + budget ledger rows + events + outbox rows. Commit.

If payment fails afterwards, the merchant calls **reverse** (`payment_failed`) and the uses return to the pool.

### 4.3 Reverse

Full or partial (by line and quantity or amount). Partial refunds use the stored line allocations, proportionally.
Output includes credit-note data (see money-and-tax.md). Counters and budget are restored in the same transaction.

## 5. Tenancy and the dedicated-database option

- Every tenant-owned row carries `organization_id`.
- **Row-level security** policies check `organization_id = current_setting('app.org_id')::uuid`. The app sets it with
  `SET LOCAL` at the start of every transaction (safe with transaction-pooling connection poolers). The app's DB role has no `BYPASSRLS`.
- The data-access layer refuses to run a query without a tenant context.
- **Tenant router:** `resolveDb(organizationId)` returns a connection pool. By default every tenant maps to the shared
  pool. A tenant row can carry a `db_route` pointing at a dedicated database, with migrations applied to it by the
  same migration runner. At 0 INR we run the shared DB plus one demo tenant on a second Postgres container to prove the path works.
- CI runs cross-tenant tests: attempts to read or write another tenant's rows through every public service must fail.

## 6. Concurrency and the hot-counter problem

- Limits are enforced by **atomic conditional updates** on counter rows (see 4.2).
- **Hot code:** a counter row is updated in one transaction per redemption, so a single viral code serializes on one row.
  The design lets `usage_counters` be **sharded**: the limit K is split into N shard rows (default N = 1), a redemption
  picks a random shard with capacity and falls back to the others. We raise N only if the M4 load test shows contention.
  We make no throughput claim until it is measured.
- Counters for per-customer limits are keyed by `(promotion, customer, period)`, so they spread naturally.
- The concurrency test fires N parallel redemptions against a limit K and asserts exactly K succeed, every run.

## 7. Caching, events and background work

- **Rule-set cache:** compiled once per `(store_id, rules_version)` in an in-process LRU. Publishing a promotion bumps
  `rules_version` and sends Postgres `NOTIFY`; every API instance listens and drops the entry. A short TTL is the fallback if a notification is missed.
- **Transactional outbox:** events and webhooks are written to an `outbox` table in the same transaction as the business
  write. The worker relays them. Nothing is sent for a rolled-back write, and nothing is lost.
- **Queue:** `pg-boss` (jobs stored in Postgres): code generation, import/export, webhook delivery with exponential
  backoff, rollups, notification email, and expiry of anything time-based. No Redis.
- **Active status** is computed from timestamps at read time; the scheduler only emits the `activated`/`ended` events,
  so a late scheduler cannot make a promotion wrongly active.
- **Graceful degradation:** redemption depends only on Postgres. If the worker, email or webhooks are down, redemption still works.

## 8. Cross-cutting concerns

- **API:** REST under `/v1`. The OpenAPI file is generated from the Zod route schemas (`@fastify/swagger`), and CI
  fails if the committed spec differs from the generated one, so spec and code cannot drift. Cursor pagination, one error
  format, `X-Request-Id` on every response, rate limits per key and per store with standard headers, stricter limits on
  quote/redeem to slow code guessing, per-IP and per-customer lockouts.
- **Security:** schema validation at every boundary, parameterized queries only (Kysely), API keys and tokens stored as
  hashes and shown once, secrets from environment variables (`.env.example` documents all), argon2 for passwords.
- **Observability:** `pino` JSON logs with `request_id`, `organization_id`, `store_id`; logs never contain secrets or
  personal data. Prometheus-format `/metrics` (request rate, latency, errors, queue depth, cache hit rate).
  OpenTelemetry tracing and Sentry are **off by default** and switch on with an environment variable.
- **i18n:** API returns codes and `message_key`s, never prose. The dashboard translates (English, Hindi, Marathi, Tamil, Telugu).
  Shopper-facing promotion labels are stored per locale and resolved from `Accept-Language`, falling back to English.
- **Test mode:** a store has `live` and `test` modes with separate keys and separate rows (`mode` column); test data never touches live counters or analytics.
- **Data lifecycle:** timestamps in UTC; stores carry an IANA timezone. Soft delete where history matters; hard erasure
  (customer data) on request. Large append-only tables (`events`, `redemptions`, `audit_log`) are partitioned by month.

## 9. Scale path

| Going from… | To… | What changes (no redesign) |
|---|---|---|
| 1 API instance on a laptop | N instances | Run more containers behind any load balancer. Stateless already |
| One Postgres | Heavier load | Add a connection pooler, then a read replica for dashboard/analytics queries (the data layer already separates read and write handles) |
| Shared DB | Big or regulated tenants | Point `db_route` at a dedicated DB |
| In-process cache | Many instances | Already invalidated via `NOTIFY`; add Redis behind the same cache interface only if invalidation lag matters |
| Hot counters | Viral codes | Raise shard count; optionally move the counter to a Redis script backed by the ledger |
| Dashboard and API together | Separate | Routes are already split by prefix (`/v1/*` hot path, `/console/*` dashboard API); deploy as two services |
| Single worker | More jobs | Run more worker containers; pg-boss coordinates |

## 10. Zero-cost deployment

1. **Primary:** `docker compose up` on a laptop or college lab machine: Postgres 16, a second Postgres for the dedicated-DB demo, Mailpit (local SMTP), API, worker, dashboard.
2. **Optional public demo:** an Oracle Cloud Always Free ARM VM (needs a card for verification; Indian-card rejections and "out of capacity" are commonly reported, so treat it as a bonus). Neon's free plan is a fallback database for demos only: it scales to zero, so cold starts make it unsuitable for load tests.
3. The static dashboard can go on any free static host. Verify current free-tier terms at deploy time; they change.

## 11. Testing strategy

| Layer | Tooling | What it proves |
|---|---|---|
| Engine and money | Vitest, fast-check | Money invariants, determinism, allocation sums, tax checks, golden cart fixtures |
| Concurrency | Vitest + Testcontainers (real Postgres) | N parallel redemptions, limit K, exactly K succeed |
| API | Vitest + Testcontainers | Integration tests and OpenAPI contract tests |
| Tenancy | Same | Cross-tenant read/write attempts fail |
| Dashboard | Playwright | Sign up → create promotion → simulate → redeem via API → see it in analytics |
| Load | k6 | Hot path against the p95/p99 targets; the script fails when missed |
