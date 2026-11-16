import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adviseOnPayment } from '../src/content/paymentAdvice.js';
import { validateRecipe } from '../src/adapters/recipe.js';
import { makeLast, freshLast, lastKey, LAST_MAX_AGE_MS } from '../src/lib/lastResult.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const recipe = validateRecipe(JSON.parse(fs.readFileSync(path.join(root, 'backend/data/recipes/demo-modal.json'), 'utf8'))).recipe;
const NOW = 1_700_000_000_000;

async function loadPayment(session = null) {
  const dom = await JSDOM.fromFile(path.join(root, 'demo/store/payment.html'), {
    url: 'http://localhost:4000/payment.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) { if (session) w.sessionStorage.setItem('demo:coupon', JSON.stringify(session)); },
  });
  await new Promise((r) => (dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r)));
  return dom;
}
const last = (over = {}) => ({ host: 'localhost', code: 'SAVE10', baseline: 334600, payable: 319600, at: NOW - 60_000, ...over });

describe('adviseOnPayment', () => {
  it('without a stored coupon: picks the best INSTANT offer by estimated saving and ignores cashback', async () => {
    const doc = (await loadPayment()).window.document;
    const r = adviseOnPayment({ doc, recipe, last: null, now: NOW });
    expect(r.status).toBe('ok');
    expect(r.total).toBe(334600);
    expect(r.coupon).toBeNull();
    // HDFC 10% capped at ₹300 beats ICICI flat ₹150; Axis 5% cashback (up to ₹750) is NOT estimated.
    expect(r.offer).toMatchObject({ issuer: 'HDFC', estimatedSaving: 30000 });
    expect(r.estimatedPayable).toBe(304600);
  });

  it('with a fresh stored coupon the page shows: reports the coupon and applies the offer on the page total', async () => {
    const doc = (await loadPayment({ code: 'SAVE10', discount: 15000 })).window.document;
    const r = adviseOnPayment({ doc, recipe, last: last(), now: NOW });
    expect(r.total).toBe(319600);
    expect(r.coupon).toEqual({ code: 'SAVE10', saving: 15000 });
    expect(r.pageDiffers).toBe(false);
    expect(r.offer.estimatedSaving).toBe(30000);
    expect(r.estimatedPayable).toBe(289600);
  });

  it('trusts the page when it differs from the stored result', async () => {
    const doc = (await loadPayment({ code: 'SAVE10', discount: 15000 })).window.document;
    const r = adviseOnPayment({ doc, recipe, last: last({ payable: 300000 }), now: NOW });
    expect(r.total).toBe(319600);
    expect(r.coupon.saving).toBe(15000); // from the page total, not the stored payable
    expect(r.pageDiffers).toBe(true);
  });

  it('ignores a stored coupon the page does not reflect, a stale one, and one for another host', async () => {
    const doc = (await loadPayment()).window.document; // page total is the full price
    expect(adviseOnPayment({ doc, recipe, last: last(), now: NOW }).coupon).toBeNull();
    const doc2 = (await loadPayment({ code: 'SAVE10', discount: 15000 })).window.document;
    expect(adviseOnPayment({ doc: doc2, recipe, last: last({ at: NOW - LAST_MAX_AGE_MS - 1 }), now: NOW }).coupon).toBeNull();
    expect(adviseOnPayment({ doc: doc2, recipe, last: last({ host: 'other.example' }), now: NOW }).coupon).toBeNull();
  });

  it('reports no_total and no offer gracefully', async () => {
    const empty = new JSDOM('<body><p>hello</p></body>', { url: 'http://localhost:4000/payment.html' }).window.document;
    expect(adviseOnPayment({ doc: empty, recipe, now: NOW }).status).toBe('no_total');
    const noOffers = new JSDOM('<body><span data-total>₹1,000.00</span></body>', { url: 'http://localhost:4000/payment.html' }).window.document;
    const r = adviseOnPayment({ doc: noOffers, recipe, now: NOW });
    expect(r.offer).toBeNull();
    expect(r.estimatedPayable).toBe(100000);
  });

  it('never clicks, focuses, types into or changes any input on the payment page', async () => {
    const dom = await loadPayment({ code: 'SAVE10', discount: 15000 });
    const { window } = dom;
    const doc = window.document;
    const events = [];
    const card = doc.getElementById('card-number');
    for (const t of ['click', 'focus', 'input', 'change', 'keydown', 'keyup', 'beforeinput']) card.addEventListener(t, () => events.push(t), true);
    const calls = [];
    for (const m of ['click', 'focus', 'select', 'setRangeText']) {
      for (const proto of [window.HTMLElement.prototype, window.HTMLInputElement.prototype]) {
        const orig = proto[m];
        if (Object.prototype.hasOwnProperty.call(proto, m) && typeof orig === 'function') proto[m] = function (...a) { calls.push(`${this.tagName}.${m}`); return orig.apply(this, a); };
      }
    }
    const mutations = [];
    new window.MutationObserver((l) => mutations.push(...l)).observe(doc.body, { attributes: true, childList: true, subtree: true, characterData: true });

    const valueBefore = card.value;
    const attrsBefore = card.outerHTML;
    adviseOnPayment({ doc, recipe, last: last(), now: NOW });
    await new Promise((r) => setTimeout(r, 20));

    expect(events).toEqual([]);
    expect(calls).toEqual([]);
    expect(mutations).toEqual([]);
    expect(card.value).toBe(valueBefore);
    expect(card.outerHTML).toBe(attrsBefore);
  });
});

describe('lastResult', () => {
  it('validates what content scripts send', () => {
    expect(makeLast({ host: 'Shop.Example', code: 'save10', baseline: 100, payable: 90 }, NOW)).toEqual({ host: 'shop.example', code: 'SAVE10', baseline: 100, payable: 90, at: NOW });
    for (const bad of [
      { host: 'bad host', code: 'A1', baseline: 1, payable: 1 }, { host: 'a.example', code: 'no good', baseline: 1, payable: 1 },
      { host: 'a.example', code: 'A1', baseline: 1.5, payable: 1 }, { host: 'a.example', code: 'A1', baseline: 1, payable: '1' },
      { host: 'a.example', code: 'A1', baseline: -1, payable: 1 }, null,
    ]) expect(makeLast(bad, NOW)).toBeNull();
  });
  it('freshLast: 30 minutes, same host only', () => {
    const e = makeLast({ host: 'a.example', code: 'A1', baseline: 2, payable: 1 }, NOW);
    expect(freshLast(e, 'a.example', NOW + LAST_MAX_AGE_MS)).toBe(e);
    expect(freshLast(e, 'a.example', NOW + LAST_MAX_AGE_MS + 1)).toBeNull();
    expect(freshLast(e, 'b.example', NOW)).toBeNull();
    expect(freshLast(e, 'a.example', NOW - 1)).toBeNull();
    expect(freshLast(null, 'a.example', NOW)).toBeNull();
    expect(lastKey('a.example')).toBe('pf:last:a.example');
  });
});
