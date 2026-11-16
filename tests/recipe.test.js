import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { validateRecipe, locate, locateAll } from '../src/adapters/recipe.js';

const good = () => ({
  id: 'demo-modal', version: 1, hosts: ['localhost'], verified: false,
  pages: { bag: { pathPrefixes: ['/modal.html'] }, payment: { pathPrefixes: ['/payment.html'] } },
  coupon: {
    open: { text: ['apply coupon'], tag: ['button', 'a'] }, panel: { css: '[role=dialog]' }, input: { css: 'input[name=coupon]' },
    apply: { text: ['apply', 'check'], tag: ['button'] }, close: { text: ['close'], tag: ['button'] }, panelClosesOnApply: true,
    listed: { item: { css: '[data-coupon]' }, code: { attr: 'data-coupon' }, select: { css: 'input[type=radio]' }, ineligibleText: ['not applicable'] },
    message: { css: '[role=alert]' }, applied: { text: ['coupon applied'] }, remove: { text: ['remove'], tag: ['button', 'a'] },
  },
  total: { css: '[data-total]' }, offers: { container: { css: '#offers' } },
  loginWall: { text: ['login to apply'] }, limits: { maxAttempts: 6, delayMs: 1500, jitterMs: 1000 },
});

describe('validateRecipe', () => {
  it('accepts a valid recipe and returns a clean copy', () => {
    const r = validateRecipe(good());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.recipe.coupon.listed.code).toEqual({ attr: 'data-coupon' });
    expect(r.recipe.verified).toBe(false);
  });

  it('drops unknown keys, including code-like ones', () => {
    const g = good();
    g.evil = 'x'; g.coupon.script = 'alert(1)'; g.coupon.open.regex = '.*'; g.pages.bag.extra = 1;
    const { recipe } = validateRecipe(g);
    expect(recipe.evil).toBeUndefined();
    expect(recipe.coupon.script).toBeUndefined();
    expect(recipe.coupon.open.regex).toBeUndefined();
    expect(recipe.pages.bag.extra).toBeUndefined();
  });

  it('rejects wrong types, bad ids and bad hosts', () => {
    for (const mutate of [
      (g) => { g.id = 'Bad ID!'; }, (g) => { g.id = 'a'; }, (g) => { g.version = '1'; }, (g) => { g.version = 0; },
      (g) => { g.hosts = []; }, (g) => { g.hosts = ['not a host']; }, (g) => { g.hosts = ['https://x.com']; }, (g) => { g.hosts = 'x.com'; },
      (g) => { g.hosts = Array.from({ length: 11 }, (_, i) => `h${i}.com`); },
      (g) => { g.verified = 'yes'; }, (g) => { g.coupon.panelClosesOnApply = 'true'; },
      (g) => { g.coupon.open = 'apply coupon'; }, (g) => { g.coupon.open = {}; },
      (g) => { g.pages.bag = { pathPrefixes: ['modal.html'] }; }, (g) => { delete g.pages.bag; },
    ]) {
      const g = good(); mutate(g);
      expect(validateRecipe(g).ok, JSON.stringify(g).slice(0, 80)).toBe(false);
    }
    expect(validateRecipe(null).ok).toBe(false);
    expect(validateRecipe([]).ok).toBe(false);
    expect(validateRecipe('x').ok).toBe(false);
  });

  it('enforces size limits', () => {
    let g = good(); g.coupon.open.text = ['x'.repeat(201)];
    expect(validateRecipe(g).ok).toBe(false);
    g = good(); g.coupon.open.text = Array.from({ length: 11 }, (_, i) => `t${i}`);
    expect(validateRecipe(g).ok).toBe(false);
    g = good(); g.total.css = 'x'.repeat(201);
    expect(validateRecipe(g).ok).toBe(false);
  });

  it('requires pages.bag and coupon.open or coupon.input', () => {
    const g = good(); delete g.coupon.open; delete g.coupon.input;
    expect(validateRecipe(g).ok).toBe(false);
    const h = good(); delete h.coupon.open;
    expect(validateRecipe(h).ok).toBe(true);
  });

  it('clamps limits, and forces a 1500 ms minimum delay off localhost', () => {
    const a = good(); a.limits = { maxAttempts: 50, delayMs: 10, jitterMs: 99999 };
    expect(validateRecipe(a).recipe.limits).toEqual({ maxAttempts: 6, delayMs: 10, jitterMs: 5000 });
    const b = good(); b.hosts = ['shop.example']; b.limits = { maxAttempts: 0, delayMs: 10 };
    expect(validateRecipe(b).recipe.limits).toEqual({ maxAttempts: 1, delayMs: 1500, jitterMs: 1000 });
    const c = good(); c.hosts = ['localhost', 'shop.example']; c.limits = { delayMs: 0 };
    expect(validateRecipe(c).recipe.limits.delayMs).toBe(1500);
  });

  it('validates the listed-coupon block', () => {
    const g = good(); g.coupon.listed.code = { attr: 'bad attr!' };
    expect(validateRecipe(g).ok).toBe(false);
    const h = good(); delete h.coupon.listed.item;
    expect(validateRecipe(h).ok).toBe(false);
    const k = good(); k.coupon.listed.code = { css: '.code' };
    expect(validateRecipe(k).recipe.coupon.listed.code).toEqual({ css: '.code' });
  });
});

describe('locate', () => {
  const doc = new JSDOM(`<body>
    <div id="a"><button class="x">Apply Coupon</button><a href="#" id="link">Apply coupon now, great savings today</a></div>
    <div hidden><button id="hid">Apply Coupon</button></div>
    <div style="display:none"><span id="hid2">secret total</span></div>
    <p data-total>₹3,346.00</p><p data-total>₹1.00</p>
    <ul><li data-coupon="A1">one</li><li data-coupon="B2">two</li></ul>
  </body>`).window.document;

  it('finds by css and skips invalid selectors', () => {
    expect(locate(doc, { css: '[data-total]' }).textContent).toBe('₹3,346.00');
    expect(locate(doc, { css: '!!bad[' })).toBeNull();
    expect(locateAll(doc, { css: '[data-coupon]' })).toHaveLength(2);
  });

  it('falls back from a failing css to text', () => {
    expect(locate(doc, { css: '!!bad[', text: ['apply coupon'] }).className).toBe('x');
  });

  it('finds by text, case-insensitively, preferring the shortest match and honoring tag', () => {
    expect(locate(doc, { text: ['APPLY COUPON'] }).className).toBe('x');
    expect(locate(doc, { text: ['apply coupon'], tag: ['a'] }).id).toBe('link');
    expect(locate(doc, { text: ['apply coupon'], tag: ['span'] })).toBeNull();
  });

  it('ignores hidden elements and treats text as plain text, not a pattern', () => {
    expect(locate(doc, { text: ['secret total'] })).toBeNull();
    expect(locate(doc, { css: '#hid' })).toBeNull();
    expect(locate(doc, { text: ['.*'] })).toBeNull();
    expect(locate(doc, null)).toBeNull();
  });
});
