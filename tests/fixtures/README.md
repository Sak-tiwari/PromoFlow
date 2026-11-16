# Real-site captures (project owner task)

Milestone M6 needs these files and **cannot start without them**. Nothing in a recipe for a real site may be written from memory.

For each of `myntra`, `ajio`, `nykaa`, on desktop Chrome, **logged in, with one item in the bag**:

1. Open the extension popup, go to **Diagnose this page**, choose the page state, and press **Download** (or **Copy snapshot** and paste into a file).
2. Save the files as below. The popup names the downloads `<host>-<state>.html`; rename them to `<state>.html` and put them in the site's folder.

```
tests/fixtures/<site>/bag.html                 the bag / cart page, coupon panel closed
tests/fixtures/<site>/coupon_panel_open.html   after opening the coupon panel (listed coupons visible)
tests/fixtures/<site>/coupon_applied.html      with a coupon applied (apply a listed coupon by hand once)
tests/fixtures/<site>/coupon_error.html        after typing a made-up code such as PFTEST123 once
tests/fixtures/<site>/payment.html             the payment page (bank offers visible)
tests/fixtures/<site>/NOTES.md                 see below
```

`NOTES.md` should answer, in a few lines:

- Does the coupon panel close by itself after a coupon is applied?
- Does the bag total update without a reload?
- What does the page show when you are logged out (the exact wording where coupons would be)?
- What exact wording does the page show for a wrong code?
- Anything that looked unusual (a login popup, a CAPTCHA, a coupon list that needs scrolling, a different layout on mobile).

The snapshots remove emails, phone numbers, PIN codes, address blocks, images, scripts and input values, but **open each file and check it
before committing it**. Delete anything you would not want to publish.
