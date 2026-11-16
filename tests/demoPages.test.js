import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoServer } from '../demo/serve.mjs';
import { validateRecipe, locate, locateAll } from '../src/adapters/recipe.js';
import { readTotalPaise, looksLikeCaptcha } from '../src/content/domDetector.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const recipeJson = JSON.parse(fs.readFileSync(path.join(root, 'backend/data/recipes/demo-modal.json'), 'utf8'));
const { ok, errors, recipe } = validateRecipe(recipeJson);

async function load(file, query = '', session = null) {
  const dom = await JSDOM.fromFile(path.join(root, 'demo/store', file), {
    url: `http://localhost:4000/${file}${query}`, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) { if (session) w.sessionStorage.setItem('demo:coupon', JSON.stringify(session)); },
  });
  await new Promise((r) => (dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r)));
  return dom;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('demo recipe', () => {
  it('validates', () => {
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
    expect(recipe.verified).toBe(false);
  });

  it('resolves on the bag page: open button, total, and (after opening) the popup parts', async () => {
    const { window } = await load('modal.html');
    const doc = window.document;
    expect(locate(doc, recipe.coupon.open).id).toBe('open-coupons');
    expect(readTotalPaise(doc, { selectors: ['[data-total]'] })).toBe(334600);
    expect(locate(doc, recipe.coupon.input)).toBeNull(); // popup closed
    locate(doc, recipe.coupon.open).click();
    expect(locate(doc, recipe.coupon.panel)).not.toBeNull();
    expect(locate(doc, recipe.coupon.input).name).toBe('coupon');
    expect(locate(doc, recipe.coupon.apply).id).toBe('check');
    expect(locateAll(doc, recipe.coupon.listed.item).map((e) => e.getAttribute('data-coupon'))).toEqual(['SAVE10', 'FLAT100', 'BAG200', 'BIG500']);
  });
});

describe('modal.html behaviour', () => {
  it('apply by typing: total drops, popup closes by itself, chip shows, session is kept for the payment page', async () => {
    const { window } = await load('modal.html');
    const d = window.document;
    d.getElementById('open-coupons').click();
    d.getElementById('c-input').value = 'BAG200';
    d.getElementById('check').click();
    await wait(200);
    expect(d.querySelector('[role=alert]').textContent).toBe('Coupon applied');
    expect(readTotalPaise(d, { selectors: ['[data-total]'] })).toBe(334600 - 20000);
    expect(d.getElementById('coupon-dialog').hidden).toBe(false);
    await wait(400);
    expect(d.getElementById('coupon-dialog').hidden).toBe(true);
    expect(locate(d, recipe.coupon.applied)).not.toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem('demo:coupon')).code).toBe('BAG200');
    locate(d, recipe.coupon.remove).click();
    await wait(200);
    expect(readTotalPaise(d, { selectors: ['[data-total]'] })).toBe(334600);
    expect(window.sessionStorage.getItem('demo:coupon')).toBeNull();
  });

  it('selecting a listed coupon fills the input; the disabled one cannot be picked', async () => {
    const { window } = await load('modal.html');
    const d = window.document;
    d.getElementById('open-coupons').click();
    d.querySelector('[data-coupon=SAVE10] input').click();
    expect(d.getElementById('c-input').value).toBe('SAVE10');
    expect(d.querySelector('[data-coupon=BIG500] input').disabled).toBe(true);
    expect(d.querySelector('[data-coupon=BIG500]').textContent.toLowerCase()).toContain('not applicable');
  });

  it('rejects invalid, expired and under-minimum codes with distinct messages', async () => {
    const { window } = await load('modal.html');
    const d = window.document;
    d.getElementById('open-coupons').click();
    const tryCode = async (c) => { d.getElementById('c-input').value = c; d.getElementById('check').click(); await wait(200); return d.querySelector('[role=alert]').textContent; };
    expect(await tryCode('NOPE')).toMatch(/invalid/i);
    expect(await tryCode('OLD20')).toMatch(/expired/i);
    expect(await tryCode('BIG500')).toMatch(/minimum/i);
  });

  it('?loggedout=1 shows the login wall and does not apply anything', async () => {
    const { window } = await load('modal.html', '?loggedout=1');
    const d = window.document;
    expect(locate(d, recipe.loginWall)).not.toBeNull(); // visible even before opening the popup
    d.getElementById('open-coupons').click();
    expect(d.getElementById('c-input').disabled).toBe(true);
    d.getElementById('check').click();
    await wait(200);
    expect(readTotalPaise(d, { selectors: ['[data-total]'] })).toBe(334600);
  });

  it('?captcha=1 shows a captcha block after the third apply', async () => {
    const { window } = await load('modal.html', '?captcha=1');
    const d = window.document;
    d.getElementById('open-coupons').click();
    for (const c of ['NOPE1', 'NOPE2']) { d.getElementById('c-input').value = c; d.getElementById('check').click(); await wait(200); }
    expect(looksLikeCaptcha(d)).toBe(false);
    d.getElementById('c-input').value = 'NOPE3'; d.getElementById('check').click(); await wait(200);
    expect(looksLikeCaptcha(d)).toBe(true);
  });
});

describe('payment.html', () => {
  it('shows the full total without a coupon, and the reduced total with the stored coupon', async () => {
    const a = await load('payment.html');
    expect(readTotalPaise(a.window.document, { selectors: ['[data-total]'] })).toBe(334600);
    const b = await load('payment.html', '', { code: 'SAVE10', discount: 15000 });
    expect(readTotalPaise(b.window.document, { selectors: ['[data-total]'] })).toBe(319600);
    expect(b.window.document.querySelectorAll('#offers p')).toHaveLength(3);
    expect(b.window.document.getElementById('card-number')).not.toBeNull();
  });
});

describe('demo server', () => {
  it('serves pages with a query string and rejects traversal', async () => {
    const s = createDemoServer();
    expect((await request(s).get('/modal.html?loggedout=1')).status).toBe(200);
    expect((await request(s).get('/payment.html')).status).toBe(200);
    expect((await request(s).get('/')).status).toBe(200);
    expect((await request(s).get('/nope.html')).status).toBe(404);
    expect((await request(s).get('/..%2f..%2fpackage.json')).status).toBe(404);
  });
});
