# Promo Flow

A multi-tenant promo code and discount engine for Indian online merchants, offered as SaaS.
A merchant's checkout calls the Promo Flow API with a cart. Promo Flow validates the code, picks the best
allowed combination (at most one coupon plus one payment/bank offer), computes GST-aware amounts, records the
redemption and enforces limits and budgets.

Built as a college project: it must **work**, **cost 0 INR to run**, and **scale by adding instances** without
a redesign. It must not be heavier than that needs.

## Status

**M0: Discovery & design.** Documentation only, no application code yet. Waiting for approval before M1.

## Read in this order

| Doc | What it covers |
|---|---|
| [docs/scope-and-milestones.md](docs/scope-and-milestones.md) | How each of your answers was applied, what is in the MVP and what is deferred, milestone plan |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Modules, request flows, tenancy, concurrency, caching, scale path, zero-cost deployment |
| [docs/money-and-tax.md](docs/money-and-tax.md) | Integer money, GST-inclusive pricing, who funds a discount, rounding, worked example |
| [docs/data-model.md](docs/data-model.md) | Entity-relationship diagram (Mermaid) and key constraints |
| [docs/api/openapi.yaml](docs/api/openapi.yaml) | Draft OpenAPI 3.1 spec for the redemption API |
| [docs/compliance-india.md](docs/compliance-india.md) | DPDP, CERT-In, GST, RBI card rules, dark-pattern rules and the design response to each |
| [docs/risks.md](docs/risks.md) | Risk register with mitigations |
| [docs/decisions/](docs/decisions/) | One short ADR per significant decision (all "Proposed" until approved) |

## Planned stack (details in ADR-0001)

TypeScript on Node 22, Fastify, PostgreSQL (the only datastore), Kysely, pg-boss queue, React + Vite dashboard,
i18next (English, Hindi, Marathi, Tamil, Telugu), Vitest + fast-check + Testcontainers + Playwright + k6.

## Planned layout

```
promo-flow/
├── apps/
│   ├── api/          # Fastify modular monolith (modules: tenancy, auth, promotions, codes, redemptions, ...)
│   ├── worker/       # pg-boss jobs: code generation, import/export, webhooks, rollups
│   └── dashboard/    # React + Vite merchant dashboard
├── packages/
│   ├── rules-engine/ # pure library: conditions, benefits, stacking, tax. No framework, no DB
│   ├── money/        # integer money, rounding, allocation
│   └── sdk/          # TypeScript client generated from OpenAPI
├── db/migrations/    # reversible SQL migrations
├── infra/            # docker-compose.yml (Postgres, Mailpit)
├── loadtests/        # k6 scripts
└── docs/
```
