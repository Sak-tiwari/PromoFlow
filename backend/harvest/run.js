// Runs every enabled source: fetch -> normalize -> de-duplicate -> keep allowed domains -> upsert.
// One failing source never stops the others; each gets its own line in the summary.

import { normalizeBatch, normalizeDomain, KNOWN_SOURCES } from './normalize.js';
import { fetchJsonFeed } from './sources/jsonFeed.js';
import { readFileDataset } from './sources/fileDataset.js';

const ADAPTERS = { jsonFeed: fetchJsonFeed, file: readFileDataset };

export function validateSourceConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') return ['source must be an object'];
  if (!/^[a-z0-9-]{2,40}$/.test(cfg.name || '')) errors.push('name: 2-40 chars, a-z 0-9 -');
  if (!ADAPTERS[cfg.type]) errors.push(`type: one of ${Object.keys(ADAPTERS).join(', ')}`);
  if (!KNOWN_SOURCES.includes(cfg.source) || cfg.source === 'shared' || cfg.source === 'crowd') errors.push('source: feed, dataset or seed');
  if (cfg.domains !== undefined && (!Array.isArray(cfg.domains) || cfg.domains.some((d) => !normalizeDomain(d)))) errors.push('domains: list of hosts');
  return errors;
}

/**
 * sources: config list; repo: has upsertHarvested(list) (omit for a dry run).
 * deps: { fetchImpl, env, readFile, dir } passed to adapters (tests inject saved responses).
 */
export async function harvest({ sources, repo = null, now = Date.now(), deps = {} }) {
  const summary = [];
  const all = [];
  for (const cfg of sources || []) {
    if (!cfg?.enabled) continue;
    const line = { name: cfg?.name ?? '?', fetched: 0, kept: 0, rejected: {}, error: null };
    summary.push(line);
    const errs = validateSourceConfig(cfg);
    if (errs.length) { line.error = `invalid config: ${errs.join('; ')}`; continue; }
    try {
      const raw = await ADAPTERS[cfg.type](cfg, deps);
      line.fetched = raw.length;
      const { coupons, rejected } = normalizeBatch(raw, { source: cfg.source, now });
      line.rejected = rejected;
      const allow = cfg.domains ? new Set(cfg.domains.map(normalizeDomain)) : null;
      const kept = allow ? coupons.filter((c) => allow.has(c.domain)) : coupons;
      if (allow && kept.length < coupons.length) line.rejected.other_domain = coupons.length - kept.length;
      line.kept = kept.length;
      all.push(...kept);
    } catch (e) {
      line.error = String(e?.message || e);
    }
  }
  const written = repo && all.length ? await repo.upsertHarvested(all) : { inserted: 0, updated: 0 };
  return { summary, coupons: all, written };
}
