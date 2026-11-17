// Recipes shipped inside the extension (the fallback when the backend is unreachable).
// Add one import per recipe file in backend/data/recipes/. Every recipe is validated before use.
import { validateRecipe } from './recipe.js';
import demoModal from '../../backend/data/recipes/demo-modal.json';
import myntra from '../../backend/data/recipes/myntra.json';

const RAW = [demoModal, myntra];

export const bundledRecipes = RAW.map((r) => validateRecipe(r)).filter((v) => v.ok).map((v) => v.recipe);

/** The recipe for a host from a list, or null. */
export function recipeForHost(host, list = bundledRecipes) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  return list.find((r) => r.hosts.includes(h)) ?? null;
}
