# Compliance: India

> **Not legal advice.** This is a research summary from public sources on 31 Oct 2026, written so the design can
> respect the main rules. Sources sometimes disagree on exact dates (for example 13 vs 14 November 2025 for the DPDP
> Rules). Confirm anything you rely on with a lawyer or CA before real merchants or real shoppers use the system.
> A college demo with synthetic data has far lighter exposure than a live service.

## 1. Roles

Merchants decide why and how shoppers' data is used, so they are the **Data Fiduciary**. Promo Flow processes data for
them, so it is a **Data Processor**. Under the DPDP framework the fiduciary is responsible for its processors and
passes duties on by contract, so merchant contracts (a Data Processing Agreement) matter more than code here.

## 2. Rules and the design response

| Rule | What the sources say | Design response |
|---|---|---|
| **DPDP Act 2023 and DPDP Rules 2025** | Rules notified 13 Nov 2025 (gazette 14 Nov), phased over 18 months. Institutional parts started immediately; consent-manager provisions around Nov 2026; the core duties (notice, consent, security, breach reporting, erasure) around May 2027 | **Minimize personal data:** only an external customer id and an HMAC of the email (so normalized-email limits work without storing the address). No names, phones or addresses. Per-customer erasure endpoint (hard delete or anonymize the ledger row; aggregates stay) |
| DPDP breach notification | Reported as notifying the Board and affected people, with a 72-hour detailed report | Breach runbook in M7: detection, who decides, 72-hour clock. Data export for affected merchants |
| DPDP retention | One source cites a one-year minimum retention of certain logs under Rule 8(3). Verify | Keep security/access logs ≥ 1 year (without personal data) |
| DPDP processor duties | Duties flow through contract | Ship a **DPA template** and a privacy/processing notice in `docs/legal/` (M7). Not signed by anyone in a demo |
| **CERT-In Directions (28 Apr 2022)** | Report listed cyber incidents within **6 hours**; keep ICT logs **180 days within India**; sync clocks to Indian time sources; maintain a point of contact | Structured logs retained ≥ 180 days, stored in India. The log format already excludes personal data, which also avoids a conflict with DPDP minimization. Incident template with a 6-hour clock. NTP configured on hosts |
| **GST (CGST Act ss. 15, 34)** | Discounts known at or before supply and recorded on the invoice are excluded from taxable value (s. 15(3)(a)). Post-supply discount rules were amended in Budget 2026, with ITC-reversal conditions. A third-party subsidy tied to price can form part of transaction value (s. 15(2)(e)). What counts as third-party consideration is still debated | `funded_by` and `tax_treatment` per promotion, defaulting conservatively. Credit-note data on every reversal. Output shows taxable value used. See [money-and-tax.md](money-and-tax.md). Needs CA review |
| **RBI card rules** | Merchants and payment aggregators cannot store card numbers, expiry or CVV. Only the **last four digits, card scheme and issuer name** may be kept for tracking and reconciliation | The payment object accepts `method`, `issuer`, `network`, `card_type`, `last4` only. The API **rejects** payloads where a payment field looks like a card number, and request logging redacts it. Payment offers match on issuer/network/method, never on a BIN prefix. Promo Flow never touches payments and stays out of PCI scope |
| **Dark patterns (CCPA Guidelines, 30 Nov 2023)** | 13 named patterns, binding on platforms, sellers and advertisers; enforcement notices were issued in May 2025; false urgency, basket sneaking and similar are covered | Near-miss nudges and any "ends soon" text must be **true**: `expires_at` comes from the real end time. No fake scarcity counters. Remaining-budget numbers are not exposed to shoppers. A free-gift benefit returns the gift as a labelled line and never raises the payable, so it can't act as basket sneaking. Dashboard copy guidance in the docs for merchants |
| Consent for marketing | Out of scope: Promo Flow does not send messages to shoppers | none |
| Children's data | Heightened duties under DPDP | We collect no age data and no data about children. Terms say the service is for merchants |
| Data localisation | I did not find a general DPDP localisation mandate in the final rules, but CERT-In requires logs in India | Prefer an India region for any hosted deployment. Local Docker for the demo |

## 3. Practical checklist for the college demo

- Use synthetic customers only; never real shopper data.
- Keep `docs/legal/` templates in the repo and mention them in the project report as the compliance deliverable.
- Do not collect real card data, ever.
- If you later onboard real merchants: get the DPA reviewed by a lawyer, register a business entity, add a grievance contact, and re-check the DPDP milestone dates.

## 4. Sources consulted

DPDP Rules 2025 coverage (PIB press release 14 Nov 2025; law-firm summaries from Hogan Lovells, S.S. Rana, King Stubb & Kasiva);
CERT-In Directions 2022 summaries (Linklaters, PSA Legal, Ankura, Treelife); CBIC Circular 212/6/2024-GST and commentary on the
Budget 2026 change to s. 15(3)(b); RBI card-on-file tokenisation FAQs published by banks and Cashfree; CCPA dark-pattern guidelines
and the May 2025 enforcement notices (IndiaLaw LLP, Mondaq, Bar & Bench).
