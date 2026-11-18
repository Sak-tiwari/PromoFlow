// Checks the draft Ajio recipe against markup copied from the live bag page (see tests/fixtures/ajio/NOTES.md).
// This proves the recipe finds the right parts of those pages. It does NOT prove the live flow works end to end.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { validateRecipe, pageKind } from '../src/adapters/recipe.js';
import { recipeDriver } from '../src/content/drivers.js';

const dir = path.resolve(__dirname, 'fixtures/ajio');
const draft = JSON.parse(fs.readFileSync(path.join(dir, 'recipe.draft.json'), 'utf8'));
const shipped = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../backend/data/recipes/ajio.json'), 'utf8'));
const load = (n) => new JSDOM(fs.readFileSync(path.join(dir, `${n}.html`), 'utf8')).window.document;
const driver = (n) => recipeDriver(load(n), validateRecipe(draft).recipe, { sleep: async () => {} });

describe('draft Ajio recipe on live-copied markup', () => {
  it('is valid, not marked verified, and matches the shipped recipe', () => {
    const r = validateRecipe(draft);
    expect(r.errors).toEqual([]);
    expect(r.recipe.verified).toBe(false);
    expect(pageKind(r.recipe, '/cart')).toBe('bag');
    expect(shipped).toEqual(draft);
  });
  it('reads the total before (₹319) and after a coupon (₹199.80)', () => {
    expect(driver('bag').readTotal()).toBe(31900);
    expect(driver('coupon_applied').readTotal()).toBe(19980);
  });
  it('knows when a coupon is applied, and which one', () => {
    expect(driver('bag').isApplied()).toBe(false);
    expect(driver('coupon_applied').isApplied()).toBe(true);
    expect(driver('coupon_applied').appliedText()).toMatch(/NEW30/);
  });
  it('lists the site coupon', () => {
    expect(driver('bag').listCodes()).toEqual([{ code: 'NEW30', eligible: true }]);
  });
  it('reads the error message', () => {
    expect(driver('coupon_error').readMessage()).toMatch(/valid coupon code/i);
  });
  it('removes an applied coupon with one click', async () => {
    const doc = load('coupon_applied');
    let clicked = 0;
    doc.querySelector('.ic-delete').addEventListener('click', () => clicked++);
    await recipeDriver(doc, validateRecipe(draft).recipe, { sleep: async () => {} }).remove();
    expect(clicked).toBe(1);
  });
});

import { JSDOM as _J } from 'jsdom';
describe('ajio listed pick', () => {
  it('ticks the listed radio and presses Apply', async () => {
    const { recipeDriver } = await import('../src/content/drivers.js');
    const { validateRecipe } = await import('../src/adapters/recipe.js');
    const fs = await import('node:fs');
    const html = fs.readFileSync('tests/fixtures/ajio/bag.html', 'utf8');
    const dom = new _J(html);
    const doc = dom.window.document;
    const raw = JSON.parse(fs.readFileSync('backend/data/recipes/ajio.json', 'utf8'));
    const v = validateRecipe(raw);
    const rec = v.recipe || v.value || raw;
    const log = [];
    doc.querySelector('input.offer-radio').addEventListener('click', () => log.push('radio'));
    doc.querySelector('.apply-button').addEventListener('click', () => log.push('apply'));
    const d = recipeDriver(doc, rec, { sleep: async () => {} });
    await d.apply('NEW30');
    expect(log).toEqual(['radio', 'apply']);
  });
});
