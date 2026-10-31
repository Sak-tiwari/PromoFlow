# ADR-0007: Customer facts from the ledger; auto-try only discoverable coupons

Status: Proposed · Date: 2026-10-31 · **Needs your confirmation** (see scope doc, question 1)

## Context
Merchants will not send tags or segments. Promo Flow must decide eligibility itself and "try the coupons".

## Decision
- **Customer facts** (order count, first-order status, last order time, lifetime discount) come from the `customer` ledger, updated by every redeem call. The merchant may override `order_count` in the request.
- Merchants are advised to call redeem for every paid order, even with no promotion, so first-order logic is accurate (otherwise Promo Flow only knows orders that used it).
- **Coupon discovery:** when no code is supplied and `discover_codes` is true, the engine evaluates automatic promotions and codes marked `discoverable`. Private, personal and unique-batch codes are **never** auto-tried.
- Discovery is a server-side evaluation over the merchant's own coupons. Promo Flow does **not** scrape or import coupon codes from outside sources.

## Consequences
First-order accuracy depends on merchants calling redeem for all orders. Discovery cannot leak private codes or become a brute-force oracle.
