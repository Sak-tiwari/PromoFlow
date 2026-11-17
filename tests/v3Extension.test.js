// V3 extension behaviour: harvested-code metadata, cart-size filter, "Try more", source/age labels, opt-in sharing.
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSearch } from '../src/content/applyEngine.js';
import { generic } from '../src/adapters/index.js';
import { buildCandidates } from '../src/background/candidates.js';
import { createOverlay, sourceTag } from '../src/ui/overlay.js';
import { offerShare } from '../src/content/share.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fast = { delayMs: 5, jitterMs: 0, settleMs: 1500, pollMs: 10, stableMs: 20, minWaitMs: 150, maxAttempts: 3 };
const DAY = 86_400_000;
const NOW = Date.parse('2026-11-17T10:00:00Z');

async function store(file = 'index.html') {
  const dom = await JSDOM.fromFile(path.join(root, 'demo/store', file), { url: `http://localhost:4000/${file}`, runScripts: 'dangerously', pretendToBeVisual: true });
  await new Promise((r) => (dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r)));
  return dom.window.document;
}
const totalOf = (doc) => doc.getElementById('total').textContent;

describe('buildCandidates keeps server metadata', () => {
  it('passes source, dates and minimum spend through, and allows 30 candidates', () => {
    const server = Array.from({ length: 35 }, (_, i) => ({ code: `CODE${i}`, score: 1 - i / 100, source: 'feed', lastSeen: NOW, minSpend: i === 0 ? 99900 : null }));
    const out = buildCandidates({ server }, 30);
    expect(out).toHaveLength(30);
    expect(out[0]).toMatchObject({ code: 'CODE0', origin: 'server', source: 'feed', lastSeen: NOW, minSpend: 99900 });
    expect(out[1]).not.toHaveProperty('minSpend');
  });
});

describe('runSearch: cart-size filter, exclude and "Try more" bookkeeping (demo store, ₹3,346 cart)', () => {
  it('skips codes whose stated minimum spend is above the cart and expired codes, without trying them', async () => {
    const doc = await store();
    const tried = [];
    const out = await runSearch({
      doc, adapter: generic, cfg: fast, now: NOW,
      candidates: [
        { code: 'BIG500', origin: 'server', minSpend: 1000000 },
        { code: 'OLD20', origin: 'server', expiresAt: NOW - DAY },
        { code: 'SAVE10', origin: 'server', minSpend: 50000 },
        { code: 'FLAT100', origin: 'server' },
      ],
      onProgress: (e) => e.phase === 'trying' && tried.push(e.code),
    });
    expect(tried).toEqual(['SAVE10', 'FLAT100']);
    expect(out.skippedMinSpend).toEqual(['BIG500']);
    expect(out.coupon.code).toBe('SAVE10');
  });

  it('reports what is left, then a second run skips tried codes and re-measures the coupon left applied', async () => {
    const doc = await store();
    const cands = ['FLAT100', 'NOPE', 'OLD20', 'SAVE10', 'WELCOME50'].map((code) => ({ code, origin: 'server' }));
    const a = await runSearch({ doc, adapter: generic, cfg: fast, now: NOW, candidates: cands });
    expect(a.tried).toEqual(['FLAT100', 'NOPE', 'OLD20']);
    expect(a).toMatchObject({ remaining: 2, cap: 3, finalApplied: true });
    expect(a.coupon.code).toBe('FLAT100');
    expect(totalOf(doc)).toBe('₹3,246.00');

    const tried = [];
    const b = await runSearch({ doc, adapter: generic, cfg: fast, now: NOW, candidates: cands, exclude: a.tried, onProgress: (e) => e.phase === 'trying' && tried.push(e.code) });
    expect(tried).toEqual(['FLAT100', 'SAVE10', 'WELCOME50']); // FLAT100 re-measured as the coupon already applied
    expect(b.coupon.code).toBe('SAVE10'); // better than the first run's pick
    expect(b.remaining).toBe(0);
    expect(totalOf(doc)).toBe('₹3,196.00');
  });
});

describe('"Try more" on the popup-coupon store (recipe): the coupon left applied is found and re-measured', () => {
  it('keeps the first run\'s best coupon when the second run finds nothing better', async () => {
    const fs = await import('node:fs');
    const { validateRecipe } = await import('../src/adapters/recipe.js');
    const recipe = validateRecipe(JSON.parse(fs.readFileSync(path.join(root, 'backend/data/recipes/demo-modal.json'), 'utf8'))).recipe;
    const doc = await store('modal.html');
    const cands = ['NOPE', 'EXTRA1', 'EXTRA2'].map((code) => ({ code, origin: 'server' }));
    const a = await runSearch({ doc, adapter: generic, recipe, cfg: fast, now: NOW, candidates: cands });
    expect(a.coupon.code).toBe('BAG200'); // SAVE10, FLAT100, BAG200 are the site's own list; cap 3 stops there
    const tried = [];
    const b = await runSearch({ doc, adapter: generic, recipe, cfg: fast, now: NOW, candidates: cands, exclude: a.tried, onProgress: (e) => e.phase === 'trying' && tried.push(e.code) });
    expect(tried[0]).toBe('BAG200'); // spotted as already applied (the open panel's bare "Coupon applied" did not hide it)
    expect(b.preAppliedLost).toBe(false);
    expect(b.coupon.code).toBe('BAG200');
    expect(totalOf(doc)).toBe('₹3,146.00');
  });
});

describe('overlay: source and age labels, Try more, share prompt', () => {
  const doc = () => new JSDOM('<!doctype html><html><body></body></html>').window.document;
  it('labels where a code came from and how recent it is', () => {
    expect(sourceTag('en', 'listed', {}, NOW)).toBe('site');
    expect(sourceTag('en', 'user', { lastSeen: NOW - 3 * DAY }, NOW)).toBe('yours');
    expect(sourceTag('en', 'server', { source: 'feed', lastSeen: NOW - 2 * DAY }, NOW)).toBe('feed · 2d ago');
    expect(sourceTag('en', 'server', { source: 'shared', lastSuccessAt: NOW - 1000 }, NOW)).toBe('shared · today');
    expect(sourceTag('en', 'seed', {}, NOW)).toBe('known');
    expect(sourceTag('hi', 'server', { source: 'feed', lastSeen: NOW - 2 * DAY }, NOW)).toBe('फ़ीड · 2 दिन पहले');
  });

  it('shows each tried code with its tag', () => {
    const d = doc();
    const ui = createOverlay(d, 'en', { onStop() {} });
    ui.result({ code: 'MYNTRA15', outcome: 'invalid', origin: 'server', meta: { source: 'feed', lastSeen: Date.now() } });
    const root = d.querySelector('[data-promoflow]').shadowRoot;
    expect(root.querySelector('li').textContent).toMatch(/^MYNTRA15feed · today✕$/);
  });

  it('"Try more" waits for the cooldown, then runs once', () => {
    const d = doc();
    const ui = createOverlay(d, 'en', { onStop() {} });
    let t = 0;
    const timers = [];
    const onClick = vi.fn();
    const b = ui.tryMore({ n: 6, cooldownMs: 30_000, onClick, now: () => t, setTimer: (f) => timers.push(f) });
    expect(b.disabled).toBe(true);
    expect(b.textContent).toBe('Try more in 30s');
    b.click();
    expect(onClick).not.toHaveBeenCalled();
    t = 30_000; timers.shift()();
    expect(b.disabled).toBe(false);
    expect(b.textContent).toBe('Try 6 more');
    b.click(); b.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('opt-in sharing', () => {
  const okSummary = { coupon: { code: 'MYCODE1', origin: 'user', saving: 15000 }, finalApplied: true };
  const fakeUi = () => ({ prompts: [], notes: [], sharePrompt(p) { this.prompts.push(p); }, note(n) { this.notes.push(n); } });

  it('asks first by default and sends nothing until the shopper says yes', async () => {
    const ui = fakeUi();
    const sent = [];
    expect(offerShare(ui, okSummary, { host: 'ajio.com', lang: 'en', shareMode: 'ask', send: async (m) => { sent.push(m); return { ok: true }; } })).toBe(true);
    expect(sent).toEqual([]);
    ui.prompts[0].onAnswer('no');
    expect(sent).toEqual([]);
    ui.prompts[0].onAnswer('yes');
    expect(sent).toEqual([{ type: 'PF_SHARE', domain: 'ajio.com', code: 'MYCODE1' }]);
  });

  it('"always" remembers the choice; "never" and non-user or unmeasured codes are never shared', async () => {
    const sent = [];
    const send = async (m) => { sent.push(m); return { ok: true }; };
    const ui = fakeUi();
    offerShare(ui, okSummary, { host: 'ajio.com', lang: 'en', shareMode: 'ask', send });
    ui.prompts[0].onAnswer('always');
    expect(sent.map((m) => m.type).sort()).toEqual(['PF_SET_SHARE_MODE', 'PF_SHARE']);
    for (const [s, mode] of [
      [okSummary, 'never'],
      [{ ...okSummary, coupon: { ...okSummary.coupon, origin: 'listed' } }, 'always'],
      [{ ...okSummary, finalApplied: false }, 'always'],
      [{ ...okSummary, coupon: { ...okSummary.coupon, saving: 0 } }, 'always'],
      [{ coupon: null }, 'always'],
    ]) expect(offerShare(fakeUi(), s, { host: 'ajio.com', lang: 'en', shareMode: mode, send })).toBe(false);
  });
});
