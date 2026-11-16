# Promo-Flow v2: plan and build brief (Myntra, Ajio, Nykaa)

Written 16 Nov 2026. This file is for a coding model (for example Claude Sonnet) working inside this repository, and for the project owner who supplies page captures and runs the live checks.

**How to use it.** Give the model one milestone per session. Kickoff prompt:

> Read `docs/V2_BUILD_BRIEF.md` fully, then read the files listed under "Read first". Implement milestone **M1** only. Follow every rule in "Rules that always apply". When the milestone's "Done when" list is satisfied, stop and report what you built, what you tested, and what you could not verify.

Replace `M1` with the next milestone each time. Do not skip ahead: M6 cannot be done without the captures from M1.

---

## 1. Where v1 stands

Working and tested (45 automated tests, plus one real-Chromium run on the demo store):

- A Manifest V3 extension. The user clicks the icon, presses "Find best savings", and a content script is injected into the active tab.
- The engine finds a **visible promo box on the same page**, types one known code at a time, reads the payable total after each, removes the code, and re-applies the best one.
- Bank/payment offers on the same page are parsed from text and shown as an **estimate**. They are never applied.
- An Express backend serves ranked codes per domain and accepts opt-in anonymous reports.

Not working on real sites yet. No real site has been tested. The Amazon and Flipkart adapters are unverified guesses.

## 2. Why Myntra, Ajio and Nykaa need more than v1

What is known about the three sites, and how sure we are:

| Site | Known | Source | Unknown until captured |
|---|---|---|---|
| Ajio | "Apply Coupon" is on the Bag page. Coupons are listed with code, discount and minimum purchase. | Ajio coupon FAQ | Panel layout, element names, login wall, whether the panel closes after applying |
| Myntra | The coupon step is at cart/checkout; a code can be typed and applied. | Coupon guide site (generic) | Whether it is a popup with a coupon list (believed yes), element names, login wall |
| Nykaa | One code per order. The coupon reduces the cart first; bank offers then apply to the reduced total at payment. | Coupon guide site | Where the coupon field is, element names, login wall |

Differences from the v1 assumptions, which the design below handles:

1. **The coupon box is behind a click.** It opens as a panel, popup or drawer, and may close again after each apply.
2. **The site lists its own coupons** for the cart. These are real, current codes, which fixes v1's "no real codes" gap.
3. **Coupon and bank offers are on different pages.** Coupon on the bag page, bank offers on the payment page. v1 assumed one page.
4. **Login is usually required** before coupons can be used.
5. **Element names are unknown.** Nobody has looked at these pages for this project. Selectors must come from captures, never from memory.

Honest limits to state in the README when v2 ships:

- These sites may already highlight their best listed coupon. Promo-Flow's gain is from unlisted codes the user has, a measured comparison, and the bank-offer pairing.
- The sites' terms may forbid automated use. Runs stay user-triggered, slow and few (see the rules). This is not legal advice.
- A site redesign breaks its recipe until the recipe is updated.

## 3. Target design

```
popup click
   └─ service worker: ranked known codes (user, backend, seed) + recipe for this host
        └─ content script
             ├─ page kind = bag      → Phase A: coupon search
             │     open coupon panel → harvest listed codes → merge with known codes
             │     → try one at a time (type or select) → read total → remove
             │     → re-apply best → remember result (session storage, 30 min)
             └─ page kind = payment  → Phase B: read-only advice
                   read offer texts + page total → knapsack DP with the remembered coupon
                   → show the best pairing as an estimate. Clicks nothing.
```

Three building blocks are new:

- **Recipe**: a JSON description of one site's coupon flow (where to click, where to read). Data only, never code. Bundled in the extension and also served by the backend, so a fix needs no rebuild.
- **Diagnose capture**: a popup button that copies a sanitized snapshot of the coupon and total areas. This is how recipes get real selectors.
- **Driver**: an interface inside the engine so the generic flow (v1) and the recipe flow share one trial loop.

## 4. Rules that always apply

Follow these in every milestone. If a task seems to need breaking one, stop and report.

1. **Never invent selectors, element names, URLs or coupon codes for a real site.** A real site's recipe may only use what appears in a capture under `tests/fixtures/<site>/`. If the capture is missing, stop and ask for it.
2. **User-triggered only.** No content scripts in the manifest, no `host_permissions`, no background page visits. Permissions stay `activeTab`, `scripting`, `storage`, `alarms`.
3. **Only known codes are tried**: user-entered, site-listed, backend, or seed. Never generate, mutate or guess codes.
4. **One coupon at a time.** At most two things in a result: one coupon and one bank/payment offer.
5. **Savings come only from totals read off the page.** Bank-offer figures are always labelled as estimates.
6. **Payment pages are read-only.** Never click, type into, or read the value of any input on a payment page. Never read card, UPI, address, phone or email fields anywhere.
7. **Pacing on recipe sites**: at most 6 tries per run, 1500 ms plus 0–1000 ms random delay between tries. Stop at once on a CAPTCHA, a login wall, or a "too many attempts" style message.
8. **Money is integer paise.** No floats. Use `src/lib/money.js`.
9. **Plain JavaScript (ES modules).** No TypeScript, no new runtime dependencies, no frameworks. Dev dependencies need a stated reason.
10. **Do not weaken or delete existing tests.** All 45 must keep passing. Add tests for everything new.
11. **Do not set `verified: true` on a recipe.** Only the project owner does that after a live run.
12. **No affiliate links or tags, ever.**
13. **Telemetry stays opt-in and minimal**: domain, code, outcome, random client id. From v2, never report codes the user typed in themselves (they may be personal). Report only codes whose origin is `server`, `seed` or `listed`.
14. **Recipes from the server are untrusted input.** Validate them (M2). Text matching is case-insensitive substring only: do not compile regular expressions from recipe data.
15. **No automated tests against live sites.** Tests run on the demo pages and on saved fixtures.
16. Commit after each milestone with a clear message. Run `npm test` and `npm run build` before committing.

## 5. Read first

| File | What it holds |
|---|---|
| `README.md`, `docs/PLAN.md` | Product, constraints, v1 status |
| `src/content/applyEngine.js` | `runSearch({doc, adapter, overrides, candidates, signal, onProgress, cfg})`, `classify`, `setNativeValue`, `OUTCOME`. Result statuses: `ok`, `no_promo_field`, `blocked_captcha`, `no_total`, `no_codes` |
| `src/content/domDetector.js` | `findPromoField`, `findApplyButton`, `findPromoToggle`, `readTotalPaise`, `readPromoMessage`, `readOfferTexts`, `looksLikeCaptcha`, `findRemoveControl`, `isVisible` |
| `src/adapters/index.js` | `makeAdapter`, `generic`, `amazon`, `flipkart`, `pickAdapter(hostname)`, `normalizeHost`. Adapter methods: `matches`, `isCheckout`, `findField`, `readTotal`, `readOffers`, `findToggle` |
| `src/content/contentScript.js` | Messages `PF_PING`, `PF_START`, `PF_STOP`; sends `PF_REPORT` |
| `src/background/serviceWorker.js` | Handles `PF_RUN`, `PF_REPORT`; storage keys `apiBase`, `telemetry`, `userCodes`, `lang`, `clientId`, `cache`, `overrides` |
| `src/background/candidates.js` | `buildCandidates({server, seed, user}, k)`, `TtlCache` |
| `src/algorithms/Knapsack.js` | `bestCombination({baseline, layers})`, `applyOption` |
| `src/lib/offerParser.js` | `parseOffer(text)`, `estimateSaving(offer, payable)` |
| `src/ui/overlay.js`, `src/popup/*`, `src/i18n/*` | Shadow-DOM panel, popup, strings in `en hi mr ta te` |
| `backend/app.js` | `GET /api/v1/coupons/:domain`, `POST /api/v1/coupons/report`, `GET /api/v1/stores/:domain/config`, `GET /health` |
| `demo/store/index.html`, `tests/*.test.js` | The v1 demo checkout and the test style to follow |

Commands: `npm install`, `npm test`, `npm run build` (writes `dist/`), `npm run backend` (port 3000), `npm run demo` (port 4000).

`runSearch` is called from exactly two places: `contentScript.js` and `tests/applyEngine.test.js`. If graphify is installed, `graphify update .` rebuilds the code graph in `graphify-out/`, and `graphify affected "runSearch"` shows what a change touches.

---

## 6. Milestones

Order matters. Rough size is in brackets.

### M1. Diagnose capture (small)

Goal: one click gives the project owner a safe snapshot of a real page, so recipes can be written from facts.

1. Create `src/content/capture.js` exporting `captureSnapshot(doc, { state })`. It returns `{ host, path, state, capturedAt, html }`.
   - `path` is `location.pathname` only. Drop the query string and hash.
   - Find "anchor" elements whose own short text or attributes mention: coupon, promo, voucher, offer, apply, remove, total, payable, amount, bank, login, sign in. Use the word lists in `domDetector.js` as a base.
   - For each anchor, climb up to 4 ancestors and take that subtree. Merge overlapping subtrees. Cap the whole output at 200 KB; if larger, drop the deepest subtrees first.
   - **Sanitize the clone before serializing:**
     - Remove `script`, `style`, `svg`, `img`, `picture`, `video`, `iframe`, `noscript`, `link`, `meta`.
     - Remove every `value` attribute and clear the text of `textarea`.
     - Keep only these attributes: `id`, `class`, `name`, `type`, `role`, `placeholder`, `for`, `href` (path only), `disabled`, `checked`, any `aria-*`, any `data-*` whose value is under 60 characters.
     - Replace text that looks like an email, a phone number (10 or more digits), or a 6-digit PIN code with `[removed]`.
     - Drop whole subtrees whose text or attributes mention address, pincode, deliver to, profile, account name, saved card, UPI ID.
     - Truncate any single text node to 120 characters.
   - Keep rupee amounts and coupon codes: they are needed.
2. Popup: add a "Diagnose this page" section with a dropdown for the page state and a button. States: `bag`, `coupon_panel_open`, `coupon_applied`, `coupon_error`, `payment`. The button injects the content script, requests the snapshot (`PF_CAPTURE` message), and copies it to the clipboard as an HTML document that starts with a comment holding host, path, state and time. Also offer it as a file download named `<host>-<state>.html`.
3. Show a one-line notice in the popup: the snapshot is copied locally and sent nowhere.
4. Add the new strings to all five language files. Mark Hindi, Marathi, Tamil and Telugu as machine-drafted in the commit message.
5. Tests (`tests/capture.test.js`, jsdom): on a page seeded with an email, a phone number, an address block, an input with a value, and a script, the snapshot contains none of them; it keeps the coupon code and the total; it respects the size cap.

Done when: tests pass; `npm run build` works; on the demo store the button produces a snapshot you can open as HTML and it contains the promo box and the total.

**Owner task after M1 (not for the model).** On each of Myntra, Ajio and Nykaa, on desktop Chrome, logged in, with one item in the bag, capture all five states and save them as `tests/fixtures/<site>/<state>.html`. For `coupon_error`, type a made-up code such as `PFTEST123` once. Also note in `tests/fixtures/<site>/NOTES.md`: does the panel close after applying, is the bag total updated without a reload, and what the page looks like when logged out.

### M2. Recipe format and validation (small)

1. Create `src/adapters/recipe.js` with `validateRecipe(obj)` returning `{ ok, errors, recipe }`, and `locate(root, locator)` and `locateAll(root, locator)`.
2. A **locator** is `{ css?: string, text?: string[], tag?: string[] }`. `css` is tried first inside a `try/catch`. `text` matches visible elements whose trimmed text contains any of the strings, case-insensitive, preferring the shortest matching element. `tag` narrows text matches (for example `["button","a"]`). Results must pass `isVisible`.
3. Recipe shape (all locators optional unless marked required):

```json
{
  "id": "demo-modal",
  "version": 1,
  "hosts": ["localhost"],
  "verified": false,
  "pages": {
    "bag": { "pathPrefixes": ["/modal.html"] },
    "payment": { "pathPrefixes": ["/payment.html"] }
  },
  "coupon": {
    "open": { "text": ["apply coupon"], "tag": ["button", "a"] },
    "panel": { "css": "[role=dialog]" },
    "input": { "css": "input[name=coupon]" },
    "apply": { "text": ["apply", "check"], "tag": ["button"] },
    "close": { "text": ["close"], "tag": ["button"] },
    "panelClosesOnApply": true,
    "listed": {
      "item": { "css": "[data-coupon]" },
      "code": { "attr": "data-coupon" },
      "select": { "css": "input[type=radio]" },
      "ineligibleText": ["not applicable", "add items worth"]
    },
    "message": { "css": "[role=alert]" },
    "applied": { "text": ["coupon applied"] },
    "remove": { "text": ["remove"], "tag": ["button", "a"] }
  },
  "total": { "css": "[data-total]" },
  "offers": { "container": { "css": "#offers" } },
  "loginWall": { "text": ["login to apply", "sign in to continue"] },
  "limits": { "maxAttempts": 6, "delayMs": 1500, "jitterMs": 1000 }
}
```

   `coupon.listed.code` is one of `{ "attr": "<attribute name>" }` or `{ "css": "<selector inside the item>" }` (text of that element). Extracted codes must match `^[A-Z0-9_-]{3,32}$` after upper-casing, else they are skipped.
4. Validation limits: `id` matches `^[a-z0-9-]{2,40}$`; at most 10 hosts, each a plain hostname; every string at most 200 characters; at most 10 strings per `text` array; `limits.maxAttempts` clamped to 1–6; `delayMs` clamped to at least 1500 for any host other than `localhost`; unknown keys are dropped; `pages.bag` and `coupon.open` or `coupon.input` are required.
5. Tests: valid recipe passes; oversize, wrong types, bad hosts and unknown keys are handled; `locate` by css, by text, with a bad selector, and with hidden elements.

Done when: tests pass. No engine changes yet.

### M3. A demo store that behaves like these sites (small)

Real sites cannot be used in tests, so build pages that copy the pattern.

1. `demo/store/modal.html`: a bag page. Total in an element marked `data-total`. An "Apply Coupon" button opens a dialog (`role=dialog`) with: a list of coupons as radio items (`data-coupon`), one of them marked not applicable; a text input and a "Check" button; an alert area. Applying closes the dialog after about 300 ms, updates the total without a reload, and shows an applied chip with "Remove". Reuse the v1 demo's codes and rules, and add one listed-only code `BAG200` (flat ₹200 off, minimum ₹2,500) that is not in the seed data.
2. `?loggedout=1` shows "Login to apply coupons" in place of the list and disables the input.
3. `?captcha=1` shows a CAPTCHA-like block after the third apply.
4. `demo/store/payment.html`: a payment page with the payable total and three bank-offer lines, plus a card-number input that must never be touched. Read the applied coupon from `sessionStorage` so the total matches the bag.
5. `backend/data/recipes/demo-modal.json`: the recipe for these pages (the example in M2, adjusted to the real markup).
6. Fix `demo/serve.mjs`: it resolves files from the raw `req.url`, so a URL with a query string such as `?loggedout=1` returns 404 today. Strip the query string before resolving the file.

Done when: the pages work by hand in a browser; the recipe validates.

### M4. Engine v2: drivers, panel flow, listed coupons (large)

Keep `runSearch`'s current behaviour for the generic adapter exactly as it is.

1. Create `src/content/drivers.js` with two factories that return the same interface:

   ```
   {
     kind,                      // 'generic' | 'recipe'
     limits,                    // { maxAttempts, delayMs, jitterMs }
     ensureOpen(),              // async → true if the coupon input or list is reachable
     listCodes(),               // → [{ code, eligible }] from the site's own list ([] for generic)
     apply(code),               // async: type or select, then submit
     readTotal(), readMessage(),
     isApplied(), remove(),     // async remove → true when the control was found and clicked
     loginRequired(), captcha()
   }
   ```

   - `genericDriver(doc, adapter, overrides)` wraps today's logic (`adapter.findField`, toggle, `findRemoveControl`, `readPromoMessage`).
   - `recipeDriver(doc, recipe)` uses `locate`. `ensureOpen` clicks `coupon.open` when the panel or input is not visible and waits up to 3 s. `apply(code)`: if the code is in the site's list and `listed.select` exists, click that item's select control, else type with `setNativeValue`; then click `coupon.apply`.
2. Refactor `runSearch` to build a driver (`recipe` param present and its bag page matches → recipe driver, else generic) and run one shared loop:
   - Before the baseline: `loginRequired()` → return `{ status: 'login_required' }`; `captcha()` → `blocked_captcha`; `ensureOpen()` false → `no_promo_field`.
   - If a coupon is already applied, remember its code if readable, remove it, and take the baseline. If nothing beats it, re-apply it at the end.
   - Before **every** trial call `ensureOpen()` again, because the panel may have closed.
   - Settle rule stays: total changed, or a final message appeared. For recipe drivers with `panelClosesOnApply`, the panel closing also counts as "something happened"; then read the total after `stableMs`.
   - After an applied trial: `remove()`, wait for the total to return to the baseline. If it does not return within the settle time, stop with `stopped: 'could_not_restore'` (existing behaviour).
   - Check `captcha()` and `loginRequired()` before each trial; also stop if the message contains "too many" or "try again later" (`stopped: 'rate_limited'`).
3. Candidate merge, as a pure function `mergeCandidates({ known, listed }, cap)` in `src/background/candidates.js`: `known` is the service worker's list with origins. Order: user codes, then eligible listed codes, then server and seed codes. De-duplicate, keep the first origin, cap at `limits.maxAttempts`. Listed codes marked ineligible are skipped and returned separately so the overlay can say so.
4. The service worker now sends `candidates` as `[{ code, origin }]` and the recipe (M5 adds the fetch; for now use the bundled one). Each result entry gains `origin`. `contentScript.js` sends `PF_REPORT` only for origins `server`, `seed` and `listed` (rule 13).
5. Overlay: show the origin of the winning code ("listed by the site", "your code"), and handle the new statuses `login_required` and `rate_limited` with new strings in all five languages.
6. Tests (`tests/engineV2.test.js`, jsdom on `modal.html` with the demo recipe, using the fast timing config from the existing tests):
   - harvests listed codes, skips the ineligible one, and finds that `BAG200` wins although it is not in the known list;
   - re-opens the panel before each trial;
   - a user code is tried first and is never reported;
   - logged-out page → `login_required` with zero attempts;
   - CAPTCHA after the third apply → stops, keeps the best so far;
   - pre-applied coupon is restored when nothing beats it;
   - attempt cap of 6 is honoured;
   - all v1 tests still pass unchanged.

Done when: `npm test` passes, and a manual run of the built extension on `http://localhost:4000/modal.html` ends with `BAG200` applied.

### M5. Recipes from the backend (small)

1. Load every file in `backend/data/recipes/` at start, validate with `validateRecipe` (import it from `src/adapters/recipe.js`), and index by host. Invalid files are logged and skipped.
2. `GET /api/v1/stores/:domain/config` adds `recipe` (or `null`) to its response. For MongoDB, store the recipe on the store document; `--seed` upserts it. The Mongo path is still untested: say so in the report.
3. Extension: bundle the recipe files as a fallback. The service worker asks the backend for the store config, validates the recipe again on the client, caches it in the existing `TtlCache` under `recipe:<host>`, and prefers the higher `version` between server and bundled.
4. Tests (supertest): config returns a valid recipe; a broken recipe file is not served; client-side choice of the higher version.

Done when: tests pass; with the backend stopped the bundled recipe is used; with it running the server copy is used.

### M6. Site recipes for Myntra, Ajio and Nykaa (medium, needs fixtures)

Do one site at a time. **If `tests/fixtures/<site>/` is missing or incomplete, stop and list exactly which states are missing.**

1. Read the five fixtures and `NOTES.md`. Write `backend/data/recipes/<site>.json` using only attributes and text that appear in them. Prefer stable hooks in this order: `data-*` test ids, `name`, `role` plus text, then text alone. Avoid class names that look generated (hashes, long random strings); if nothing else exists, use text locators.
2. Set `verified: false`. Use hostnames exactly as in the fixture headers.
3. If the coupon panel sits inside a cross-origin iframe or a closed shadow root, the site cannot be supported by this design. Stop and report that.
4. Add `tests/recipes.test.js` cases per site, loading each fixture with jsdom:
   - `bag.html`: `coupon.open` and `total` resolve; the total parses to paise.
   - `coupon_panel_open.html`: `input`, `apply` and at least one listed item resolve; listed codes extract and match the code pattern.
   - `coupon_applied.html`: `applied` and `remove` resolve; total is lower than in `bag.html`.
   - `coupon_error.html`: `classify` on the message gives `invalid`, not `no_effect`. Extend the message patterns in `applyEngine.js` only with wording seen in fixtures.
   - `payment.html`: page kind is `payment`; `readOfferTexts` finds the offer lines; `parseOffer` handles them, or the unparsed lines are listed in the report.
   - Logged-out wording from `NOTES.md` is in `loginWall`.
5. Write `docs/LIVE_CHECKLIST.md`: the manual run for the owner on each site (one item in bag, at most two runs per site per day, what to compare, what to send back if it fails). Fixtures are static, so the live run is the only real proof.

Done when: fixture tests pass for the site; the recipe validates; the checklist exists. The site is **not** "supported" until the owner confirms a live run and sets `verified: true`.

### M7. Bank offers on the payment page (medium)

1. Phase A (bag page) ends by saving `{ host, code, baseline, payable, at }` to `chrome.storage.session` under `pf:last:<host>`. Entries older than 30 minutes are ignored.
2. In `contentScript.js`, decide the page kind from the recipe's `pages`. On a payment page run `adviseOnPayment({ doc, recipe, last })` (new file `src/content/paymentAdvice.js`) and never `runSearch`.
3. `adviseOnPayment` only reads: the page total and the offer texts. It calls `parseOffer`, keeps instant offers, and uses `bestCombination` with one coupon layer (the measured total on this page) and one offer layer. It returns the best offer with its estimated saving. It must not click or type anything.
4. Overlay on a payment page: the coupon result from Phase A if present, the best offer as an estimate, and the standard estimate note. If the page total differs from the stored payable, trust the page.
5. Overlay on a bag page, after Phase A: one line telling the user to click Promo-Flow again on the payment page for bank-offer advice.
6. Tests on `demo/store/payment.html`: picks the right offer; cashback-only offers are not estimated; a test asserts no input on the page received a click, focus or value change (spy on them); stale stored results are ignored.

Done when: tests pass; a manual run on the demo flows from `modal.html` to `payment.html` and shows coupon plus offer.

### M8. Wrap up (small)

1. All new strings exist in the five languages; the key-parity test passes. List the machine-drafted strings in `docs/I18N_REVIEW.md` for human review.
2. Update `README.md`: a "Site support" table with three honest columns (fixture-tested, live-verified by the owner, notes), the new demo pages, and the limits from section 2.
3. Update `docs/PLAN.md` to point to this brief. Mark the Amazon and Flipkart adapters as unverified legacy; move them to recipes only if fixtures are supplied.
4. Final check: `npm test`, `npm run build`, load `dist/` in Chrome, run both demo flows by hand.

---

## 7. What to report after each milestone

- Files added and changed.
- Test count before and after, and the `npm test` summary line.
- What was checked by hand and what was not.
- Anything in this brief that turned out wrong or impossible, with the evidence.
- Open questions for the owner.

Never report a real site as working. The strongest claim a model can make is "the recipe resolves on the saved fixtures".

## 8. Sources for the site notes

- Ajio coupon FAQ: https://www.ajio.com/coupon-faq
- Myntra coupon steps (third-party guide): https://www.couponorg.co.in/how-to/how-to-use-myntra-coupons
- Nykaa coupon and bank-offer order (third-party guide): https://zoutons.com/news/how-to-save-money-on-nykaa
