# ADR-0005: Two slots: one coupon, one payment offer

Status: Proposed · Date: 2026-10-31

## Context
Your rule: at most 2 promotions per cart, one coupon (if applicable) and one bank/payment offer, usually provided by the website.

## Decision
- Each promotion has a `slot`: `coupon` or `payment`. Automatic (no-code) merchant deals use the coupon slot.
- Store policy: `max_promotions = 2`, one per slot. The engine does an **exact search** over (coupon candidates ∪ none) × (payment candidates ∪ none) and picks the largest total discount. Ties break by priority, then lower promotion id, so results are deterministic.
- Application order: coupon first, then the payment offer on the remaining payable (default); a payment offer may use `applies_on: pre_discount_total` if its terms say so.
- Payment offers match on `method`, `issuer`, `network`, `card_type` only, never BIN or card number (RBI).
- When the payment method is not known yet, the quote returns `payment_offer_options` showing what each method would save.
- `NOT_COMBINABLE` is returned when a promotion is marked exclusive and cannot share the cart.

## Consequences
The combination search is tiny (the product of two small sets), so the "capped search" in the brief is trivial and fast. More slots can be enabled later through the policy field.
