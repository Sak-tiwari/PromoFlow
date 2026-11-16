// Chooses which recipe to use for a host: the one from the backend, or the one bundled in the extension.
import { validateRecipe } from './recipe.js';

const normHost = (h) => String(h || '').toLowerCase().replace(/^www\./, '');

/**
 * Both inputs are untrusted and are validated again here. A recipe is only accepted for hosts it lists.
 * The higher `version` wins; on a tie the server copy is used, so a backend fix needs no extension release.
 */
export function chooseRecipe(host, serverRaw, bundledRaw) {
  const h = normHost(host);
  const accept = (raw) => {
    if (!raw) return null;
    const v = validateRecipe(raw);
    return v.ok && v.recipe.hosts.includes(h) ? v.recipe : null;
  };
  const server = accept(serverRaw);
  const local = accept(bundledRaw);
  if (server && local) return server.version >= local.version ? server : local;
  return server ?? local ?? null;
}
