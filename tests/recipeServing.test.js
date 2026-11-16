import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../backend/app.js';
import { createMemoryRepo } from '../backend/repo/memoryRepo.js';
import { loadRecipes } from '../backend/recipes.js';
import { chooseRecipe } from '../src/adapters/recipeSource.js';
import { bundledRecipes, recipeForHost } from '../src/adapters/bundledRecipes.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const recipesDir = path.join(root, 'backend/data/recipes');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'backend/data/seed.json'), 'utf8'));
const demoRaw = () => JSON.parse(fs.readFileSync(path.join(recipesDir, 'demo-modal.json'), 'utf8'));
const quiet = () => {};

describe('loadRecipes', () => {
  it('loads valid recipes and skips broken ones with the reasons', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-recipes-'));
    fs.writeFileSync(path.join(dir, 'good.json'), JSON.stringify(demoRaw()));
    fs.writeFileSync(path.join(dir, 'bad-shape.json'), JSON.stringify({ id: 'x', hosts: ['a.example'] }));
    fs.writeFileSync(path.join(dir, 'bad-json.json'), '{ nope');
    fs.writeFileSync(path.join(dir, 'ignored.txt'), 'hi');
    const r = loadRecipes(dir, quiet);
    expect([...r.byHost.keys()]).toEqual(['localhost']);
    expect(r.skipped.map((s) => s.file).sort()).toEqual(['bad-json.json', 'bad-shape.json']);
    expect(r.skipped.every((s) => s.errors.length > 0)).toBe(true);
  });

  it('a missing directory is not an error', () => {
    expect(loadRecipes(path.join(os.tmpdir(), 'pf-does-not-exist'), quiet).byHost.size).toBe(0);
  });

  it('the repository recipe files are all valid', () => {
    const r = loadRecipes(recipesDir, quiet);
    expect(r.skipped).toEqual([]);
    expect(r.recipes.length).toBeGreaterThan(0);
  });
});

describe('GET /api/v1/stores/:domain/config', () => {
  let recipes;
  beforeEach(() => { recipes = loadRecipes(recipesDir, quiet).byHost; });
  const appWith = (r = recipes, s = seed) => createApp({ repo: createMemoryRepo(structuredClone(s)), recipes: r });

  it('returns the validated recipe with the store config', async () => {
    const r = await request(appWith()).get('/api/v1/stores/localhost/config');
    expect(r.status).toBe(200);
    expect(r.body.adapter).toBe('generic');
    expect(r.body.recipe.id).toBe('demo-modal');
    expect(r.body.recipe.coupon.listed.code).toEqual({ attr: 'data-coupon' });
  });

  it('returns recipe: null for a known store without a recipe, and 404 for an unknown one', async () => {
    const a = await request(appWith()).get('/api/v1/stores/flipkart.com/config');
    expect(a.status).toBe(200);
    expect(a.body.recipe).toBeNull();
    expect((await request(appWith()).get('/api/v1/stores/unknown.example/config')).status).toBe(404);
    expect((await request(appWith()).get('/api/v1/stores/' + encodeURIComponent('bad host!') + '/config')).status).toBe(400);
  });

  it('serves a recipe for a host that has a recipe but no store document', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-r2-'));
    fs.writeFileSync(path.join(dir, 'x.json'), JSON.stringify({ ...demoRaw(), id: 'only-recipe', hosts: ['shop.example'] }));
    const r = await request(appWith(loadRecipes(dir, quiet).byHost)).get('/api/v1/stores/shop.example/config');
    expect(r.status).toBe(200);
    expect(r.body.recipe.id).toBe('only-recipe');
  });

  it('never serves a broken recipe (from a file or from the database)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-r3-'));
    fs.writeFileSync(path.join(dir, 'broken.json'), JSON.stringify({ ...demoRaw(), hosts: ['shop.example'], coupon: 'nope' }));
    const none = await request(appWith(loadRecipes(dir, quiet).byHost)).get('/api/v1/stores/shop.example/config');
    expect(none.status).toBe(404);

    const bad = structuredClone(seed);
    bad.stores.push({ domain: 'db.example', name: 'DB store', adapter: 'generic', recipe: { id: 'x', hosts: ['db.example'], evil: '<script>' } });
    const fromDb = await request(appWith(new Map(), bad)).get('/api/v1/stores/db.example/config');
    expect(fromDb.status).toBe(200);
    expect(fromDb.body.recipe).toBeNull();
    expect(JSON.stringify(fromDb.body)).not.toContain('evil');
  });

  it('prefers a valid recipe stored on the store document, and ignores one for another host', async () => {
    const withDb = structuredClone(seed);
    const dbRecipe = { ...demoRaw(), id: 'from-db', version: 7 };
    withDb.stores.find((s) => s.domain === 'localhost').recipe = dbRecipe;
    expect((await request(appWith(recipes, withDb)).get('/api/v1/stores/localhost/config')).body.recipe.id).toBe('from-db');
    withDb.stores.find((s) => s.domain === 'localhost').recipe = { ...dbRecipe, hosts: ['other.example'] };
    expect((await request(appWith(recipes, withDb)).get('/api/v1/stores/localhost/config')).body.recipe.id).toBe('demo-modal');
  });
});

describe('chooseRecipe (extension side)', () => {
  const v = (version, id = 'demo-modal') => ({ ...demoRaw(), version, id });
  it('uses the higher version; on a tie the server copy', () => {
    expect(chooseRecipe('localhost', v(3, 'srv'), v(2, 'loc')).id).toBe('srv');
    expect(chooseRecipe('localhost', v(1, 'srv'), v(2, 'loc')).id).toBe('loc');
    expect(chooseRecipe('localhost', v(2, 'srv'), v(2, 'loc')).id).toBe('srv');
  });
  it('falls back to the bundled recipe when the server has none or sends garbage', () => {
    expect(chooseRecipe('localhost', null, v(1, 'loc')).id).toBe('loc');
    expect(chooseRecipe('localhost', { id: 'x' }, v(1, 'loc')).id).toBe('loc');
    expect(chooseRecipe('localhost', v(9, 'srv'), null).id).toBe('srv');
    expect(chooseRecipe('localhost', null, null)).toBeNull();
  });
  it('rejects a recipe that does not list the host', () => {
    expect(chooseRecipe('evil.example', v(9, 'srv'), null)).toBeNull();
    expect(chooseRecipe('www.localhost', v(1), null)).not.toBeNull();
  });
});

describe('bundled recipes', () => {
  it('include every recipe file in backend/data/recipes (add new files to bundledRecipes.js)', () => {
    const ids = fs.readdirSync(recipesDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(recipesDir, f), 'utf8')).id).sort();
    expect(bundledRecipes.map((r) => r.id).sort()).toEqual(ids);
    expect(recipeForHost('www.localhost').id).toBe('demo-modal');
    expect(recipeForHost('nope.example')).toBeNull();
  });
});
