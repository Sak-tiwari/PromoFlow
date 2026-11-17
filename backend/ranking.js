// Ranking: score = reliability × freshness × fit (each between 0 and 1).
//   reliability: Wilson lower bound of successes/tries, with 4 pseudo-tries at the source's prior rate
//   freshness:   halves every 7 days since the code was last seen or last worked (codes with no dates count as fresh)
//   fit:         0 when expired or dead; 0.5 when "first order only"; else 1
// The cart total is NOT sent to the server: the extension drops codes whose minimum spend is above its cart itself.

import { SOURCE_PRIOR } from './harvest/normalize.js';

const DAY = 86_400_000;
export const HALF_LIFE_DAYS = 7;
const PSEUDO_TRIES = 4;

/** Lower bound of the Wilson score interval (z = 1.28, about 80% one-sided confidence). */
export function wilsonLowerBound(successes, tries, z = 1.28) {
  if (tries <= 0) return 0;
  const p = Math.min(1, Math.max(0, successes / tries));
  const z2 = z * z;
  const denom = 1 + z2 / tries;
  const centre = p + z2 / (2 * tries);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * tries)) / tries);
  return Math.max(0, (centre - margin) / denom);
}

export function reliability(c) {
  const prior = SOURCE_PRIOR[c.source] ?? 0.2;
  const s = c.stats?.successes ?? 0;
  const t = c.stats?.tries ?? 0;
  return wilsonLowerBound(s + PSEUDO_TRIES * prior, t + PSEUDO_TRIES);
}

export function freshness(c, now = Date.now()) {
  const ref = Math.max(c.lastSuccessAt ?? 0, c.lastSeen ?? 0);
  if (!ref) return 1;
  const days = Math.max(0, (now - ref) / DAY);
  return 0.5 ** (days / HALF_LIFE_DAYS);
}

export function isDead(c, now = Date.now()) {
  return c.status === 'dead' && (c.deadUntil == null || c.deadUntil > now);
}

export function fit(c, now = Date.now()) {
  if (c.expiresAt != null && c.expiresAt < now) return 0;
  if (isDead(c, now)) return 0;
  return c.firstOrderOnly ? 0.5 : 1;
}

export function scoreCoupon(c, now = Date.now()) {
  return reliability(c) * freshness(c, now) * fit(c, now);
}

/**
 * Ranks coupons best first. Codes scoring 0 (expired, dead) are dropped, as are codes in `exclude`.
 * Ties break on the code so the order is stable.
 */
export function rankCoupons(coupons, { now = Date.now(), k = Infinity, exclude = [] } = {}) {
  const skip = new Set(exclude.map((x) => String(x).toUpperCase()));
  return coupons
    .filter((c) => !skip.has(c.code))
    .map((c) => ({ ...c, score: Number(scoreCoupon(c, now).toFixed(6)) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
    .slice(0, k);
}
