import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { recipeDriver } from '../src/content/drivers.js';
import { validateRecipe } from '../src/adapters/recipe.js';

const recipe = {
  id: 'testshop', version: 1, hosts: ['x.test'], verified: false,
  pages: { bag: { pathPrefixes: ['/cart'] } },
  coupon: { input: { css: '#in' }, apply: { css: '#check' }, applyConfirm: { css: '#go' } },
  total: { css: '#t' },
};

describe('applyConfirm (Myntra: CHECK ticks the code, APPLY commits it)', () => {
  it('validator keeps applyConfirm', () => {
    const r = validateRecipe(recipe);
    expect(r.errors ?? []).toEqual([]);
    expect((r.recipe ?? r.value ?? r).coupon.applyConfirm).toBeTruthy();
  });
  it('clicks APPLY after CHECK', async () => {
    const dom = new JSDOM('<input id="in"><button id="check"></button><button id="go"></button><div id="t">₹1,149</div>');
    const doc = dom.window.document;
    const log = [];
    doc.getElementById('check').addEventListener('click', () => log.push('check'));
    doc.getElementById('go').addEventListener('click', () => log.push('go'));
    await recipeDriver(doc, recipe, { sleep: async () => {}, pollMs: 1 }).apply('SAVE10');
    expect(log).toEqual(['check', 'go']);
  });
});
