# Money and tax

This is the most correctness-sensitive part of the system. It lives in `packages/money` (arithmetic) and
`packages/rules-engine` (tax and allocation). Both are pure and have no I/O.

> Not tax advice. The GST treatment of third-party-funded discounts is debated; the default below is a
> conservative reading and is configurable. Have a CA confirm it before real merchants rely on it.

## 1. Money

- All amounts are **integers in paise** (minor units) with an ISO 4217 code (`INR` only for now).
- No floating point anywhere in money code. Percentages are **basis points** (1800 = 18.00%).
- One shared utility does all arithmetic: add, subtract, multiply by basis points with a documented rounding,
  and `allocate()` (largest-remainder) for splitting an amount across lines.
- **Rounding rule:** round half up to the nearest paisa on each computed amount. Remainders from splitting are
  distributed one paisa at a time by largest fractional remainder, ties broken by lowest line index. This makes
  results deterministic and guarantees line allocations sum exactly to the total.
- Invariants (enforced by property tests): a discount never exceeds the amount it applies to; no line or total
  goes negative; allocations sum to the discount; the same input always gives the same output.

## 2. GST model

Inputs per line: `unit_price`, `quantity`, `gst_rate_bp`, optional `hsn_sac`. Inputs per cart:
`prices_include_tax` (default `true`, the normal Indian retail case), `supplier_state_code`,
`place_of_supply_state_code`. If both state codes are equal the supply is intra-state (CGST + SGST, each half);
otherwise inter-state (IGST).

For a tax-inclusive gross amount `G` at rate `r` basis points:

```
taxable = round( G * 10000 / (10000 + r) )
tax     = G - taxable
CGST    = tax / 2 (rounded down)   SGST = tax - CGST     // intra-state
IGST    = tax                                            // inter-state
```

For tax-exclusive carts the engine computes `tax = round(taxable * r / 10000)` and adds it to the payable.
Rounding happens per line; cart totals are the sum of the rounded lines, so an invoice always adds up.
Shipping is treated as its own line with its own rate. Cess is out of scope.

## 3. Who funds the discount

Every promotion version has `funded_by`:

| funded_by | Meaning | Default effect on taxable value |
|---|---|---|
| `merchant` | The merchant gives the discount (coupons, own payment offers) | **Reduces** taxable value, if the discount is known at or before the time of supply and shown on the invoice. This is the Section 15(3)(a) CGST Act case |
| `third_party` | A bank or network funds the discount and reimburses the merchant | **Does not reduce** taxable value by default. The merchant's real consideration is the shopper's payment plus the third party's reimbursement. This follows the reading that a third-party subsidy forms part of the transaction value (Section 15(2)(e)) |

`tax_treatment` can override the default per promotion (`reduces_taxable_value` or `keeps_taxable_value`). The engine
outputs both the **shopper payable** and the **taxable value actually used**, plus the amount expected from the third
party, so a merchant's accountant can see the working.

Reversals (cancel or refund) return **credit-note data** per line (taxable value and tax reversed). This supports the
credit-note route that Section 34 describes for post-supply adjustments. Promo Flow produces data only; the merchant
issues the actual invoice or credit note.

## 4. Worked example (checked by hand)

Intra-state cart, one line, price ₹1,180.00 incl. 18% GST (118000 paise).

| Step | Gross | Taxable | Tax | CGST / SGST | Payable by shopper |
|---|---|---|---|---|---|
| No offers | 1,180.00 | 1,000.00 | 180.00 | 90.00 / 90.00 | 1,180.00 |
| Merchant coupon 10% (₹118.00) | 1,062.00 | 900.00 | 162.00 | 81.00 / 81.00 | 1,062.00 |
| Then bank offer ₹100.00, `third_party` | 1,062.00 | 900.00 | 162.00 | 81.00 / 81.00 | **962.00** (bank reimburses 100.00) |

Check: merchant receives 962.00 from the shopper + 100.00 from the bank = 1,062.00 = 900.00 taxable + 162.00 tax. ✓

## 5. Order of application (fixed and tested)

1. Line-level discounts (product/category/BOGO/bundle/fixed price/free gift)
2. Order-level discounts (percentage/fixed/tiered), allocated to lines in proportion to each line's remaining
   amount, using `allocate()`
3. Shipping discounts

The **coupon-slot** promotion is applied first, then the **payment-slot** offer on the remaining payable (default).
A payment offer may instead be set to `applies_on: pre_discount_total` if the bank's terms say so.

## 6. Discount caps and exclusions

Every benefit supports `max_discount` (paise) and `exclude_already_discounted` (lines flagged by the merchant).
Caps are applied before allocation.
