// Checks the DRAFT Myntra recipe against pages saved from the real site (tests/fixtures/myntra/*.html).
// This proves the recipe finds the right parts of those saved pages. It does NOT prove the live flow works.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { validateRecipe, pageKind, locate } from '../src/adapters/recipe.js';
import { recipeDriver } from '../src/content/drivers.js';

const dir = path.resolve(__dirname, 'fixtures/myntra');
const draft = JSON.parse(fs.readFileSync(path.join(dir, 'recipe.draft.json'), 'utf8'));
const shipped = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../backend/data/recipes/myntra.json'), 'utf8'));
const load = (name) => new JSDOM(fs.readFileSync(path.join(dir, `${name}.html`), 'utf8')).window.document;
const driver = (name) => recipeDriver(load(name), validateRecipe(draft).recipe, { sleep: async () => {} });

describe('draft Myntra recipe on saved pages', () => {
  it('is a valid recipe, not marked verified', () => {
    const r = validateRecipe(draft);
    expect(r.errors).toEqual([]);
    expect(r.recipe.verified).toBe(false);
    expect(pageKind(r.recipe, '/checkout/cart')).toBe('bag');
    expect(pageKind(r.recipe, '/checkout/payment')).toBe('payment');
  });

  it('reads the total on the bag page (₹1,172) and after a coupon (₹872)', () => {
    expect(driver('bag').readTotal()).toBe(117200);
    expect(driver('coupon_applied').readTotal()).toBe(87200);
  });

  it('recognises the applied state only when a coupon is applied', () => {
    expect(driver('bag').isApplied()).toBe(false);
    expect(driver('coupon_applied').isApplied()).toBe(true);
    expect(driver('coupon_applied').appliedText()).toMatch(/1 coupon applied/i);
  });

  it('lists the site coupons and marks the one that needs more spend as ineligible', () => {
    expect(driver('coupon_panel_open').listCodes()).toEqual([
      { code: 'MYNTRASAVE', eligible: true },
      { code: 'MYNTRA300', eligible: false },
    ]);
  });

  it('reads the wrong-code message', () => {
    expect(driver('coupon_error').readMessage()).toBe('Coupon code is not valid');
  });

  it('finds the coupon panel only when it is open', () => {
    expect(driver('bag').panelOpen()).toBe(false);
    expect(driver('coupon_panel_open').panelOpen()).toBe(true);
  });

  it('reads the payment total and the bank offers (read-only)', () => {
    const d = driver('payment');
    expect(d.readTotal()).toBe(114900);
    const offers = d.readOffers().join(' | ');
    expect(offers).toMatch(/10% Instant Discount/i);
    expect(offers).toMatch(/YES Credit Card/i);
  });

  it('has no Remove button: removing means EDIT, untick the applied coupon, press APPLY', () => {
    expect(draft.coupon.remove).toBeUndefined();
    const checked = driver('coupon_edit_checked');
    expect(checked.panelOpen()).toBe(true);
    expect(checked.isApplied()).toBe(true);
  });

  it('finds the untick target and the confirm button in the EDIT popup, and no target once unticked', () => {
    const r = validateRecipe(draft).recipe;
    const checked = load('coupon_edit_checked');
    expect(locate(checked, r.coupon.deselect)?.textContent).toBe('MYNTRASAVE');
    expect(locate(checked, r.coupon.confirm)?.textContent).toMatch(/apply/i);
    expect(locate(load('coupon_edit_unchecked'), r.coupon.deselect)).toBeNull();
  });

  it('remove() unticks the applied coupon, then presses APPLY', async () => {
    const doc = load('coupon_edit_checked');
    const clicks = [];
    doc.querySelector('.coupon-base-labelChecked').addEventListener('click', () => clicks.push('untick'));
    doc.querySelector('#applyCoupon').addEventListener('click', () => clicks.push('apply'));
    const d = recipeDriver(doc, validateRecipe(draft).recipe, { sleep: async () => {} });
    expect(await d.remove()).toBe(true);
    expect(clicks).toEqual(['untick', 'apply']);
  });

  it('the recipe shipped with the extension is the draft (kept in step), and is still unverified', () => {
    expect(shipped).toEqual(draft);
    expect(shipped.verified).toBe(false);
  });
});
