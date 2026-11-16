import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { captureSnapshot, snapshotToDocument, snapshotFileName, redact } from '../src/content/capture.js';

function page(body, url = 'https://shop.example/bag?token=SECRET123#frag') {
  return new JSDOM(`<!doctype html><body>${body}</body>`, { url }).window.document;
}

const SEEDED = `
<div id="app">
  <script>window.secret = 'SCRIPTSECRET';</script>
  <div class="header"><span>Hello, priya.sharma@example.com</span> <span>Call 9876543210</span></div>
  <section class="address-block"><h3>Deliver to</h3><p>Flat 12, Rose Apartments, Ghaziabad 201001</p></section>
  <section class="coupons">
    <h3>Apply Coupon</h3>
    <input name="coupon" placeholder="Enter coupon code" value="MYPRIVATECODE">
    <button type="button">Apply</button>
    <div data-coupon="SAVE10">SAVE10 - 10% off up to ₹150</div>
  </section>
  <textarea name="note">gift for my mother Sunita</textarea>
  <img src="https://cdn.example/pic.png" alt="product">
  <div class="summary"><span>Total payable (incl. GST)</span> <strong>₹3,346.00</strong></div>
</div>`;

describe('captureSnapshot', () => {
  const doc = page(SEEDED);
  const snap = captureSnapshot(doc, { state: 'bag', now: () => new Date('2026-11-16T10:00:00Z') });

  it('records host, path without query or hash, state and time', () => {
    expect(snap.host).toBe('shop.example');
    expect(snap.path).toBe('/bag');
    expect(snap.state).toBe('bag');
    expect(snap.capturedAt).toBe('2026-11-16T10:00:00.000Z');
  });

  it('contains none of the personal or active content', () => {
    const h = snap.html;
    for (const bad of ['priya.sharma', '9876543210', 'Rose Apartments', '201001', 'Deliver to', 'MYPRIVATECODE', 'SCRIPTSECRET', 'Sunita', 'pic.png', 'SECRET123', '<script', '<img']) {
      expect(h, bad).not.toContain(bad);
    }
    expect(h).not.toMatch(/\svalue=/);
  });

  it('keeps the coupon code, the promo box and the total', () => {
    expect(snap.html).toContain('SAVE10');
    expect(snap.html).toContain('name="coupon"');
    expect(snap.html).toContain('placeholder="Enter coupon code"');
    expect(snap.html).toContain('₹3,346.00');
    expect(snap.html).toContain('Apply');
  });

  it('falls back to bag for an unknown state', () => {
    expect(captureSnapshot(doc, { state: 'nonsense' }).state).toBe('bag');
  });
});

describe('size cap and attribute rules', () => {
  it('respects the cap by taking smaller subtrees, then dropping the deepest', () => {
    const rows = Array.from({ length: 300 }, (_, i) => `<div class="offer-row"><p>Offer ${i}: 10% off with bank card, minimum ₹${1000 + i} order value, terms apply to all</p></div>`).join('');
    const doc = page(`<div id="wrap">${rows}</div><div><span>Total</span><b>₹999.00</b></div>`);
    const cap = 8 * 1024;
    const snap = captureSnapshot(doc, { maxBytes: cap });
    expect(new TextEncoder().encode(snap.html).length).toBeLessThanOrEqual(cap);
    expect(snap.html.length).toBeGreaterThan(0);
  });

  it('keeps only allowed attributes, short data-*, and path-only hrefs', () => {
    const doc = page(`<div class="coupon-box" style="color:red" onclick="steal()" data-id="abc" data-blob="${'x'.repeat(80)}" aria-label="Coupon, mail a@b.co">
      <a href="https://shop.example/help/coupons?session=ZZZ#x" title="tip">Coupon help</a><button type="button" disabled>Apply</button></div>`);
    const h = captureSnapshot(doc).html;
    expect(h).toContain('class="coupon-box"');
    expect(h).toContain('data-id="abc"');
    expect(h).toContain('href="/help/coupons"');
    expect(h).toContain('disabled');
    for (const bad of ['style=', 'onclick', 'data-blob', 'title=', 'session=ZZZ', 'a@b.co']) expect(h, bad).not.toContain(bad);
  });

  it('truncates long text nodes', () => {
    const doc = page(`<div class="coupon-box"><p>${'word '.repeat(80)}</p></div>`);
    const text = captureSnapshot(doc).html.replace(/<[^>]+>/g, '');
    expect(text.length).toBeLessThanOrEqual(125);
  });

  it('does not treat rupee amounts as PIN codes or phone numbers', () => {
    expect(redact('₹100000 and 3,34,600.00 and 560001')).toBe('₹100000 and 3,34,600.00 and [removed]');
    expect(redact('call +91 98765 43210 now')).toContain('[removed]');
  });
});

describe('snapshotToDocument', () => {
  it('starts with a comment holding host, path, state and time, and cannot break out of it', () => {
    const d = snapshotToDocument({ host: 'a.example', path: '/x--> <script>', state: 'bag', capturedAt: 'T', html: '<p>hi</p>' });
    expect(d.startsWith('<!-- Promo-Flow snapshot | host: a.example | path: /x-> <script>')).toBe(true);
    expect(d.split('-->').length).toBe(2);
    expect(snapshotFileName({ host: 'www.my shop.in', state: 'payment' })).toBe('www.myshop.in-payment.html');
  });
});
