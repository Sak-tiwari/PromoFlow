# Ajio fixtures

Built from markup read on the live Ajio bag page (guest session, one NEONOMAD polo t-shirt, 17-18 Nov 2026), not whole-page saves:
only the coupon area and the price rows, copied from what the page returned. Class names and ids are the real ones.

Observed live:
- The coupon box is inline on the bag page (no pop-up): `#couponCodeInput` + `.apply-button`, and a list of applicable coupons (`.voucher-list-item`).
- Ticking a listed coupon's radio does NOT change the total. Pressing Apply does (Order Total ₹319.00 -> ₹199.80 with NEW30).
- An empty or invalid code shows `.voucher-error` ("Please enter a valid coupon code").
- When applied, the input is replaced by an applied card; `.ic-delete[aria-label^="Remove coupon"]` removes it at once (no confirm) and the total returns to ₹319.00.
- Order Total is `#orderTotal .price-value`.

Not yet observed: typing a real code into the box (the typing step was not exercised live), the payment page path (`/payment` is a guess), bank offers.
