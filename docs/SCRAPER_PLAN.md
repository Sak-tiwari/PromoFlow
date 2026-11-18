# Coupon web scraper (planned, not built yet)

**Status:** design only. Nothing here runs today. It is the next source for the v3 harvester, so new codes arrive
without anyone copy-pasting them from coupon sites (as was done by hand for the first 34 Ajio and Myntra codes).

## Goal

Collect public coupon codes for the supported stores (Myntra, Ajio, later Nykaa) on a schedule, clean them, and hand
them to the existing harvester. The extension then **measures** each code on the real cart, so a bad scraped code costs one
wasted try and nothing more. The scraper never decides that a code works; only real trials and success reports do.

## Where it fits

```
coupon pages (public) --> scraper source (new, type "scrape") --> harvester: normalize -> dedupe -> merge -> upsert
                                                              --> ranking: reliability x freshness x fit --> API --> extension
```

It is a new `type: "scrape"` entry in `backend/harvest/sources.json`, next to `jsonFeed` and `file`. It reuses
`normalize.js` (code cleaning, expiry, minimum spend), so no new storage or ranking code is needed.

## How it would work

1. **Source list.** Each source is a config entry: page URL(s), the store domain it covers, and CSS selectors for the
   code, the description and (if shown) the minimum spend and expiry. Adding a site is configuration, like recipes.
2. **Fetch.** Plain HTTP GET of public pages, with a clear User-Agent, one request per page, and a delay between
   requests. Pages that need JavaScript to show codes are handled by a headless browser only if the plain fetch fails.
3. **Extract.** Pull `{ code, store, description, minSpend, expiresAt, sourceUrl }`. Accept a code only if it matches
   `^[A-Z0-9_-]{3,32}$`. Drop dollar-priced or other-country offers, "Get code" buttons with no visible code, and anything
   marked expired.
4. **Tag.** Every scraped code carries `source: "<site> (third-party, unverified)"` and the page it came from.
5. **Merge.** Duplicates across sites become one code with several sources (a code seen on more sites ranks a little higher).
6. **Freshness.** Codes not seen again on the next scrape age out through the existing 7-day half-life. A code that
   3 different users fail within 24 hours is marked dead for 3 days (existing rule).
7. **Schedule.** Run `npm run harvest` from a free scheduler (GitHub Actions cron or a local task), a few times a day at most.

## Rules it must follow

- Read `robots.txt` and the site's terms before adding any site; skip a site that forbids scraping.
- Public pages only. No login, no CAPTCHA solving, no scraping the shops themselves, and no personal data.
- Low rate: one page per site per run, a delay of several seconds between requests, and stop on 403 or 429 responses.
- Codes are short facts, not creative text: store the code, discount and conditions, never copied descriptions or page text in bulk.
- A human reviews a new source before it is switched on (`"enabled": true`).

## Risks

| Risk | Handling |
|---|---|
| Coupon sites are full of stale and fake codes | The extension only keeps a code if the real total drops; failures lower its rank |
| A site changes its layout | Per-source selectors fail loudly (zero codes found raises a warning); fix the config, not the code |
| Terms of the coupon sites | Check per source; this is not legal advice |
| Anti-bot blocking | Stop and back off; never bypass it |

## Build steps (when approved)

1. `backend/harvest/sources/scrape.js`: fetch + selector extraction, with fixtures of saved pages so tests run offline.
2. Validation of every extracted field through `normalize.js`.
3. Unit tests: selectors on fixtures, bad-code rejection, dedupe across two sources, and "zero codes found" warning.
4. Config entries for the first two sources, disabled until reviewed.
5. A scheduled run, and a short report of how many codes were added, merged and dropped per run.
