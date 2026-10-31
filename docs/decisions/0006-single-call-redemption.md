# ADR-0006: Single call at payment; reserve/release deferred

Status: Proposed · Date: 2026-10-31

## Context
You chose a single call at payment. The brief described validate → evaluate → reserve → redeem → release → reverse.

## Decision
- **Quote** (dry run, mutates nothing) and **Redeem** (atomic re-evaluate + commit) are the MVP flow.
- Redeem carries `expected_payable`. If a limit was consumed meanwhile and the amount would change, the API returns `409 PRICE_CHANGED` with the new quote. The shopper never pays a surprise amount.
- If payment fails after redeem, the merchant calls **reverse** with `payment_failed`; uses and budget return to the pool.
- **Reserve/release with TTL is deferred.** The schema has room (`status` includes `reserved`), and the worker already has a job slot for expiry.

## Consequences
- Less state and fewer failure modes at launch.
- A short window exists between redeem and payment confirmation where one use is held by a payment that may fail. This is acceptable for a demo; high-volume flash sales may want reserve later.
