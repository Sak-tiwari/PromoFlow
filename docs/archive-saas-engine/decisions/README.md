# Architecture decision records

One short record per significant decision. Status is **Proposed** until you approve M0.

| ADR | Decision |
|---|---|
| [0001](0001-stack.md) | TypeScript end to end (Fastify, Kysely, React + Vite, pnpm workspaces) |
| [0002](0002-postgres-only.md) | PostgreSQL is the only datastore; no Redis at launch |
| [0003](0003-tenancy-and-dedicated-db.md) | Shared DB with row-level security, plus a tenant router for dedicated databases |
| [0004](0004-money-and-gst.md) | Integer paise, GST-inclusive pricing, `funded_by` and `tax_treatment` |
| [0005](0005-stacking-two-slots.md) | Two slots: one coupon, one payment offer |
| [0006](0006-single-call-redemption.md) | Single call at payment; reserve/release deferred |
| [0007](0007-customer-facts-and-coupon-discovery.md) | Customer facts from the ledger; auto-try only discoverable coupons |
| [0008](0008-i18n.md) | Five dashboard languages with i18next |
| [0009](0009-zero-cost-hosting.md) | Local-first, zero-cost deployment |
| [0010](0010-observability-and-auth.md) | Light observability; self-hosted auth |
