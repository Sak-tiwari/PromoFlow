// Loads site recipes from backend/data/recipes/*.json. Every file is validated with the SAME validator the extension uses;
// invalid files are logged and skipped, so a broken recipe is never served.
import fs from 'node:fs';
import path from 'node:path';
import { validateRecipe } from '../src/adapters/recipe.js';

/** Returns { byHost: Map<host, recipe>, recipes: recipe[], skipped: [{ file, errors }] }. */
export function loadRecipes(dir, log = (m) => console.warn(JSON.stringify(m))) {
  const byHost = new Map();
  const recipes = [];
  const skipped = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { files = []; }
  for (const file of files) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); }
    catch (e) { skipped.push({ file, errors: [`not valid JSON: ${e.message}`] }); log({ level: 'warn', msg: 'recipe skipped', file }); continue; }
    const v = validateRecipe(raw);
    if (!v.ok) { skipped.push({ file, errors: v.errors }); log({ level: 'warn', msg: 'recipe skipped', file, errors: v.errors }); continue; }
    recipes.push(v.recipe);
    for (const host of v.recipe.hosts) {
      const prev = byHost.get(host);
      if (!prev || v.recipe.version > prev.version) byHost.set(host, v.recipe);
    }
  }
  return { byHost, recipes, skipped };
}
