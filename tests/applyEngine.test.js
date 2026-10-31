import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSearch, classify, OUTCOME } from '../src/content/applyEngine.js';
import { generic, pickAdapter } from '../src/adapters/index.js';
import { findPromoField, findPromoToggle, readTotalPaise, readOfferTexts, looksLikeCaptcha } from '../src/content/domDetector.js';

const storePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../demo/store/index.html');
const fast = { delayMs: 5, jitterMs: 0, settleMs: 1500, pollMs: 10, stableMs: 20, minWaitMs: 150 };

async function loadStore() {
  const dom = await JSDOM.fromFile(storePath, { runScripts: 'dangerously', pretendToBeVisual: true });
  await new Promise((r) => (dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r)));
  return dom;
}

describe('adapter selection', () => {
  it('picks site adapters by host and falls back to generic', () => {
    expect(pickAdapter('www.amazon.in').id).toBe('amazon');
    expect(pickAdapter('amazon.com').id).toBe('amazon');
    expect(pickAdapter('www.flipkart.com').id).toBe('flipkart');
    expect(pickAdapter('localhost').id).toBe('generic');
    expect(pickAdapter('notamazon.in').id).toBe('generic');
  });
});

describe('classify', () => {
  it('uses the observed total first, then message text', () => {
    expect(classify({ before: 1000, after: 900, message: 'Invalid' })).toBe(OUTCOME.APPLIED);
    expect(classify({ before: 1000, after: 1000, message: 'This coupon has expired' })).toBe(OUTCOME.EXPIRED);
    expect(classify({ before: 1000, after: 1000, message: 'Minimum order value ₹500 required' })).toBe(OUTCOME.MIN_SPEND);
    expect(classify({ before: 1000, after: 1000, message: 'Invalid coupon code' })).toBe(OUTCOME.INVALID);
    expect(classify({ before: 1000, after: 1000, message: 'This coupon is not applicable on your cart' })).toBe(OUTCOME.NOT_APPLICABLE);
    expect(classify({ before: 1000, after: 1000, message: 'hello' })).toBe(OUTCOME.NO_EFFECT);
  });
});

describe('DOM detector on the demo store', () => {
  let doc;
  beforeEach(async () => { doc = (await loadStore()).window.document; });

  it('finds a collapsed promo box via its toggle, then the input and Apply button', () => {
    expect(findPromoField(doc)).toBeNull(); // hidden until toggled
    findPromoToggle(doc).click();
    const f = findPromoField(doc);
    expect(f.input.id).toBe('promo-input');
    expect(f.button.id).toBe('promo-apply');
  });
  it('reads the final payable total, not the subtotal', () => {
    expect(readTotalPaise(doc)).toBe(334600);
  });
  it('finds bank offers and does not flag a captcha', () => {
    expect(readOfferTexts(doc)).toHaveLength(3);
    expect(looksLikeCaptcha(doc)).toBe(false);
  });
});

describe('runSearch end to end on the demo store (jsdom)', () => {
  it('tries codes one at a time, classifies each, restores the cart, and applies the best', async () => {
    const dom = await loadStore();
    const doc = dom.window.document;
    const seen = [];
    const out = await runSearch({
      doc, adapter: generic,
      candidates: ['welcome50', 'SAVE10', 'FLAT100', 'BIG500', 'OLD20', 'NOPE'],
      cfg: fast,
      onProgress: (e) => e.phase === 'trying' && seen.push(e.code),
    });
    expect(seen).toEqual(['WELCOME50', 'SAVE10', 'FLAT100', 'BIG500', 'OLD20', 'NOPE']);
    expect(out.status).toBe('ok');
    expect(out.baseline).toBe(334600);
    const byCode = Object.fromEntries(out.results.map((r) => [r.code, r.outcome]));
    expect(byCode).toEqual({
      WELCOME50: OUTCOME.APPLIED, SAVE10: OUTCOME.APPLIED, FLAT100: OUTCOME.APPLIED,
      BIG500: OUTCOME.MIN_SPEND, OLD20: OUTCOME.EXPIRED, NOPE: OUTCOME.INVALID,
    });
    // SAVE10 = 10% of 3,297 capped at 150 -> best measured coupon.
    expect(out.coupon).toMatchObject({ code: 'SAVE10', saving: 15000, payable: 319600 });
    // HDFC 10% up to 300 beats ICICI flat 150; the Axis cashback is ignored.
    expect(out.offer).toMatchObject({ issuer: 'HDFC', estimatedSaving: 30000 });
    expect(out.estimatedPayable).toBe(289600);
    // The page really shows the best coupon at the end.
    expect(out.finalApplied).toBe(true);
    expect(doc.getElementById('total').textContent).toBe('₹3,196.00');
    expect(doc.getElementById('applied-code').textContent).toBe('SAVE10');
  });

  it('honors the attempt cap', async () => {
    const doc = (await loadStore()).window.document;
    const out = await runSearch({ doc, adapter: generic, candidates: ['A1', 'B2', 'C3', 'D4'], cfg: { ...fast, maxAttempts: 2 } });
    expect(out.results).toHaveLength(2);
  });

  it('stops when aborted', async () => {
    const doc = (await loadStore()).window.document;
    const ctl = new AbortController();
    const out = await runSearch({
      doc, adapter: generic, candidates: ['SAVE10', 'FLAT100', 'WELCOME50'], signal: ctl.signal, cfg: fast,
      onProgress: (e) => e.phase === 'result' && ctl.abort(),
    });
    expect(out.stopped).toBe('aborted');
    expect(out.results).toHaveLength(1);
  });

  it('stops immediately on a captcha and reports no code attempts', async () => {
    const dom = await loadStore();
    const doc = dom.window.document;
    const d = doc.createElement('div');
    d.className = 'g-recaptcha';
    doc.body.appendChild(d);
    const out = await runSearch({ doc, adapter: generic, candidates: ['SAVE10'], cfg: fast });
    expect(out.status).toBe('blocked_captcha');
  });

  it('reports a clear status when there is no promo box or no codes', async () => {
    const dom = new JSDOM('<body><p>Nothing here</p></body>');
    expect((await runSearch({ doc: dom.window.document, adapter: generic, candidates: ['X1'], cfg: fast })).status).toBe('no_promo_field');
    const doc = (await loadStore()).window.document;
    expect((await runSearch({ doc, adapter: generic, candidates: [], cfg: fast })).status).toBe('no_codes');
  });
});
