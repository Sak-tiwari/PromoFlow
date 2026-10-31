# ADR-0004: Integer paise, GST-inclusive pricing, funder-aware tax

Status: Proposed · Date: 2026-10-31

## Context
You asked for tax-aware discounts for India. GST law treats a merchant-funded discount and a third-party-funded one
differently, and the second is debated.

## Decision
- Money is integer paise plus a currency code. Percentages are basis points. One shared utility; no floats.
- Prices are GST-inclusive by default (`prices_include_tax`), with a tax-exclusive mode.
- Each promotion version declares `funded_by` (`merchant` | `third_party`) and `tax_treatment` (`reduces_taxable_value` | `keeps_taxable_value`). Defaults: merchant → reduces; third party → keeps. The default is conservative and overridable.
- Rounding: half up per computed amount; splits via largest-remainder; per-line rounding with totals as sums of lines.
- Reversals produce credit-note data. Promo Flow never issues invoices.

Full rules and a worked example: [../money-and-tax.md](../money-and-tax.md).

## Consequences
Correct-by-construction totals that always add up, and a transparent tax breakup. Needs CA confirmation before real use.
