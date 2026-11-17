# Myntra captures (desktop Chrome, captured 2026-11-17)

Files: bag, coupon_panel_open, coupon_applied, coupon_error, payment. Product id and prices only; no personal data found on review.
`recipe.draft.json` is a DRAFT built only from these files. It is NOT enabled: not in `backend/data/recipes/` and not bundled.

## What the pages show
- Bag path `/checkout/cart`, payment path `/checkout/payment`.
- Coupon box: `.coupons-base-content`, one button (APPLY before, EDIT after a coupon is applied). Applied label: `.coupons-base-applied` ("1 Coupon applied").
- Coupon popup: `.couponsModal-base-modalContainer` with input `#coupon-input-field`, CHECK button `.couponsForm-base-applyButton`, bottom APPLY `#applyCoupon`.
- Listed coupons: `.coupon-base-validCouponContainer`; code in `.coupon-base-labelChecked` / `.coupon-base-labelUnchecked`. A coupon that needs more spend carries "Shop for Rs. N more to apply."
- Wrong code message: "Coupon code is not valid" (`.couponsForm-base-errorMessage`).
- Total: `.priceDetail-base-total .priceDetail-base-value` (₹1,172 before, ₹872 with MYNTRASAVE; payment page shows ₹1,149 with COD, platform fee ₹0).
- Bank offers on payment: `.bankOffersV2-base-container`, one offer per `.bankOffersV2-base-offerBody` (heading + message in separate elements; the carousel repeats offers).
- Class names with `css-` prefixes are generated and are NOT used.

## Still unknown (needed before this can run on the live site)
1. **How to remove an applied coupon.** After applying, the box shows EDIT. We have no capture of what EDIT opens. Without a remove step the engine cannot restore the cart between tries.
2. Does the popup close by itself after CHECK or APPLY succeeds? (`panelClosesOnApply` is set to false as a guess.)
3. Does typing a code and pressing CHECK apply it directly, or only select it so that the bottom APPLY must be pressed too?
4. Does the total update without a reload?
5. Logged in or out: the bag capture shows "Login to get upto ₹300 OFF on first order", yet a coupon could be applied. Does coupon use work for a logged-out shopper, and does the wording change when logged in?
6. MYNTRASAVE appears already ticked in the popup. Is it pre-selected by Myntra?
