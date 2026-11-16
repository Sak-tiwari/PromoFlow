import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSearch, OUTCOME } from '../src/content/applyEngine.js';
import { generic } from '../src/adapters/index.js';
import { validateRecipe } from '../src/adapters/recipe.js';
import { mergeCandidates } from '../src/background/candidates.js';
import { shouldReport } from '../src/lib/telemetry.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const recipe = validateRecipe(JSON.parse(fs.readFileSync(path.join(root, 'backend/data/recipes/demo-modal.json'), 'utf8'))).recipe;
const fast = { delayMs: 5, jitterMs: 0, settleMs: 1500, pollMs: 10, stableMs: 20, minWaitMs: 150 };
const TOTAL = 334600;

async function load(query = '', session = null) {
  const dom = await JSDOM.fromFile(path.join(root, 'demo/store/modal.html'), {
    url: `http://localhost:4000/modal.html${query}`, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) { if (session) w.sessionStorage.setItem('demo:coupon', JSON.stringify(session)); },
  });
  await new Promise((r) => (dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r)));
  return dom;
}
const totalOf = (doc) => doc.getElementById('total').textContent;
const run = (doc, candidates, extra = {}) => runSearch({ doc, adapter: generic, recipe, candidates, cfg: fast, ...extra });

describe('mergeCandidates', () => {
  it('orders user, then eligible listed, then known; dedupes keeping the first origin; skips ineligible; caps', () => {
    const { list, skipped } = mergeCandidates({
      known: [{ code: 'SEED1', origin: 'seed' }, { code: 'save10', origin: 'server' }, { code: 'big500', origin: 'seed' }, { code: 'MINE', origin: 'user' }],
      listed: [{ code: 'SAVE10', eligible: true }, { code: 'BAG200', eligible: true }, { code: 'BIG500', eligible: false }],
    }, 10);
    expect(list).toEqual([
      { code: 'MINE', origin: 'user' }, { code: 'SAVE10', origin: 'listed' }, { code: 'BAG200', origin: 'listed' }, { code: 'SEED1', origin: 'seed' },
    ]);
    expect(skipped).toEqual(['BIG500']);
    expect(mergeCandidates({ known: Array.from({ length: 20 }, (_, i) => ({ code: `CODE${i}`, origin: 'seed' })) }, 6).list).toHaveLength(6);
  });
  it('accepts plain strings and tolerates junk', () => {
    expect(mergeCandidates({ known: ['a1', ' ', null], listed: [{ code: '!!' }] }, 5).list).toEqual([{ code: 'A1', origin: 'known' }]);
  });
});

describe('telemetry gate', () => {
  it('shares only server, seed and listed origins', () => {
    expect(['user', 'server', 'seed', 'listed', 'preapplied', 'known'].filter(shouldReport)).toEqual(['server', 'seed', 'listed']);
  });
});

describe('runSearch with a recipe (popup coupon flow)', () => {
  it('harvests the site\'s listed codes, skips the not-applicable one, and finds BAG200 which is not in the known list', async () => {
    const doc = (await load()).window.document;
    const tried = [];
    const out = await run(doc, [{ code: 'WELCOME50', origin: 'seed' }, { code: 'OLD20', origin: 'seed' }, { code: 'BIG500', origin: 'seed' }], {
      onProgress: (e) => e.phase === 'trying' && tried.push(e.code),
    });
    expect(out.status).toBe('ok');
    expect(out.baseline).toBe(TOTAL);
    expect(tried).toEqual(['SAVE10', 'FLAT100', 'BAG200', 'WELCOME50', 'OLD20']); // BIG500 never tried
    expect(out.skipped).toEqual(['BIG500']);
    expect(out.coupon).toMatchObject({ code: 'BAG200', saving: 20000, payable: TOTAL - 20000, origin: 'listed' });
    expect(Object.fromEntries(out.results.map((r) => [r.code, r.outcome]))).toMatchObject({
      SAVE10: OUTCOME.APPLIED, FLAT100: OUTCOME.APPLIED, BAG200: OUTCOME.APPLIED, WELCOME50: OUTCOME.APPLIED, OLD20: OUTCOME.EXPIRED,
    });
    expect(out.finalApplied).toBe(true);
    expect(totalOf(doc)).toBe('₹3,146.00');
    expect(out.offer).toBeNull(); // no bank offers on this page
  });

  it('re-opens the popup before every trial', async () => {
    const dom = await load();
    const doc = dom.window.document;
    let opens = 0;
    const openStateAtCheck = [];
    doc.getElementById('open-coupons').addEventListener('click', () => { opens++; });
    doc.getElementById('check').addEventListener('click', () => openStateAtCheck.push(!doc.getElementById('coupon-dialog').hidden), true);
    await run(doc, []);
    expect(opens).toBeGreaterThanOrEqual(3); // it closed itself after successful applies
    expect(openStateAtCheck.length).toBeGreaterThanOrEqual(4);
    expect(openStateAtCheck.every(Boolean)).toBe(true);
  });

  it('tries the user\'s own code first and labels it with its origin', async () => {
    const doc = (await load()).window.document;
    const tried = [];
    const out = await run(doc, [{ code: 'SEEDED1', origin: 'seed' }, { code: 'MYSECRET', origin: 'user' }], { onProgress: (e) => e.phase === 'trying' && tried.push(e.code) });
    expect(tried[0]).toBe('MYSECRET');
    expect(out.results.find((r) => r.code === 'MYSECRET').origin).toBe('user');
    expect(shouldReport(out.results.find((r) => r.code === 'MYSECRET').origin)).toBe(false);
  });

  it('logged-out page: login_required with zero attempts and an untouched cart', async () => {
    const doc = (await load('?loggedout=1')).window.document;
    const tried = [];
    const out = await run(doc, [{ code: 'SAVE10', origin: 'seed' }], { onProgress: (e) => e.phase === 'trying' && tried.push(e.code) });
    expect(out.status).toBe('login_required');
    expect(tried).toEqual([]);
    expect(totalOf(doc)).toBe('₹3,346.00');
  });

  it('captcha after the third apply: stops, keeps the best so far, and touches nothing more', async () => {
    const doc = (await load('?captcha=1')).window.document;
    const out = await run(doc, [{ code: 'WELCOME50', origin: 'seed' }]);
    expect(out.stopped).toBe('blocked_captcha');
    expect(out.results.map((r) => r.code)).toEqual(['SAVE10', 'FLAT100', 'BAG200']);
    expect(out.coupon).toMatchObject({ code: 'BAG200', saving: 20000 });
    expect(out.finalApplied).toBe(false);          // hands off the page once a challenge appears
    expect(totalOf(doc)).toBe('₹3,346.00');         // the last coupon tried was removed again
  });

  it('a coupon already in the cart is measured and restored when nothing beats it', async () => {
    const dom = await load('', { code: 'BAG200', discount: 20000 });
    const doc = dom.window.document;
    expect(totalOf(doc)).toBe('₹3,146.00');
    const out = await run(doc, []);
    expect(out.baseline).toBe(TOTAL);                // measured without the pre-applied coupon
    expect(out.coupon.code).toBe('BAG200');
    expect(out.finalApplied).toBe(true);
    expect(out.preAppliedLost).toBe(false);
    expect(totalOf(doc)).toBe('₹3,146.00');
  });

  it('flags a pre-applied coupon that could not be identified and was not put back', async () => {
    const dom = await load('', { code: 'ZZTOP5', discount: 25000 });
    const doc = dom.window.document;
    const ctl = new AbortController();
    const out = await run(doc, [], { signal: ctl.signal, onProgress: (e) => e.phase === 'result' && ctl.abort() });
    expect(out.stopped).toBe('aborted');
    expect(out.preAppliedLost).toBe(true);
  });

  it('honours the recipe attempt cap of 6', async () => {
    const doc = (await load()).window.document;
    const known = Array.from({ length: 8 }, (_, i) => ({ code: `NOPE${i}X`, origin: 'seed' }));
    const out = await run(doc, known);
    expect(out.results).toHaveLength(6);
  });

  it('stops on a "too many attempts" message and does not record it as a failed code', async () => {
    const dom = await load();
    const w = dom.window;
    w.eval(`(() => { const orig = message; let n = 0;
      message = (t, c) => (t !== 'Checking…' && ++n === 2 ? orig('Too many attempts. Please try again later.', 'error') : orig(t, c)); })()`);
    const out = await run(w.document, [{ code: 'NOPE1X', origin: 'user' }, { code: 'NOPE2X', origin: 'user' }, { code: 'NOPE3X', origin: 'user' }]);
    expect(out.stopped).toBe('rate_limited');
    expect(out.results.map((r) => r.code)).toEqual(['NOPE1X']);
  });

  it('falls back to the generic detector when the recipe does not match the page path', async () => {
    const dom = await JSDOM.fromFile(path.join(root, 'demo/store/index.html'), { url: 'http://localhost:4000/index.html', runScripts: 'dangerously', pretendToBeVisual: true });
    await new Promise((r) => (dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r)));
    const out = await runSearch({ doc: dom.window.document, adapter: generic, recipe, candidates: ['SAVE10'], cfg: fast });
    expect(out.status).toBe('ok');
    expect(out.coupon.code).toBe('SAVE10');
  });
});
