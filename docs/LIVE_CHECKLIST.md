# Live check: run Promo-Flow on a real site (project owner)

Fixture tests (M6) only prove that a recipe finds the right parts of a *saved* page. A site counts as **supported** only after you have
run this checklist on the live site and, if it passes, set `"verified": true` in that site's recipe (`backend/data/recipes/<site>.json`).

Do this by hand, on your own account and cart. Do not script it, and do not run it in bulk: these sites may restrict automated use.
Do not run it more than **twice per site per day**.

## Before you start

1. `npm run build`, load `dist/` in Chrome (Developer mode, Load unpacked). Start `npm run backend`.
2. Log in to the site. Put **one** item in the bag. Note the total the site shows: `T0`.
3. In the popup, add 1 or 2 coupon codes you really have (optional), and leave "Share anonymous results" off.

## Run

1. Open the bag page. Click the Promo-Flow icon, then **Find best savings**.
2. Watch the panel. It tries at most 6 codes with a pause between each. It must stop by itself.
3. When it finishes, compare with the page:

| Check | Pass when |
|---|---|
| Baseline | "Before" equals `T0` |
| Winner | the coupon the panel names is really applied, and the total the page shows now equals "After" |
| Savings | "You save" equals `T0` minus the page total, to the rupee |
| Clean cart | no other coupon is left applied; remove the coupon by hand and the total returns to `T0` |
| Skipped | codes the site marks "not applicable" are not tried |
| Stops | if a CAPTCHA, login prompt or "try again later" appears, the panel stops and says so |
| Nothing else touched | address, phone, saved cards and quantities are unchanged |

4. Go on to the payment page, click Promo-Flow again. Check that the coupon line and "Total on this page" match the page, that the
   bank offer shown is actually listed on the page, and that it is labelled as an **estimate**. Do not type into any payment field.

## If it fails

Do not retry more than once. Press **Diagnose this page** for each page state involved and send me:

- the snapshots (open them first and delete anything personal),
- which row of the table failed and what the panel said (a screenshot is fine),
- what you expected to see.

If everything passed, set `"verified": true` for that recipe, bump its `version`, and note the date in `tests/fixtures/<site>/NOTES.md`.
