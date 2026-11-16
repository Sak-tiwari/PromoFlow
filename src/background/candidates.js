// Candidate selection and TTL cache. Pure functions so they can be unit-tested outside the browser.
// Only KNOWN codes are ever tried (server list, bundled seed, user-added). Nothing is generated or guessed.

import { Trie, normalizeCode } from '../algorithms/Trie.js';
import { MaxHeap, MinHeap } from '../algorithms/Heap.js';

const CODE_RE = /^[A-Z0-9_-]{3,32}$/;

/**
 * Merge code sources and return the top-K codes to try, best first.
 * sources: { server: [{code, score?, stats?}], seed: [{code, stats?}], user: [code] }
 */
export function buildCandidates({ server = [], seed = [], user = [] }, k = 10) {
  const trie = new Trie();
  const byCode = new Map();
  const add = (item, origin) => {
    const code = normalizeCode(item.code);
    if (!code || !CODE_RE.test(code)) return;
    const prev = byCode.get(code);
    byCode.set(code, { code, origin: prev?.origin ?? origin, score: item.score ?? prev?.score, stats: item.stats ?? prev?.stats });
    if (item.stats && item.stats.tries >= 0) trie.recordCounts(code, item.stats.tries, Math.min(item.stats.successes ?? 0, item.stats.tries));
  };
  seed.forEach((c) => add(c, 'seed'));
  server.forEach((c) => add(c, 'server'));
  user.forEach((c) => add({ code: c }, 'user'));
  for (const c of user) {
    const code = normalizeCode(c);
    if (code && byCode.has(code)) byCode.get(code).origin = 'user';
  }

  const scored = [...byCode.values()].map((c) => {
    const base = c.score ?? trie.prior(c.code);
    // The user's own codes are tried early: they are the most likely to be valid for this person.
    return { ...c, rank: base + (c.origin === 'user' ? 1 : 0) };
  });
  const heap = new MaxHeap((c) => c.rank, scored);
  const out = [];
  while (out.length < k && heap.size > 0) out.push(heap.pop());
  return out;
}

/**
 * TTL cache with a MinHeap on expiry time. Entries: { key, value, expiresAt }.
 * serialize()/restore() let the service worker persist the cache in chrome.storage and rebuild the heap on wake.
 */
export class TtlCache {
  constructor(ttlMs = 6 * 3600_000, now = () => Date.now()) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.map = new Map();
    this.heap = new MinHeap((e) => e.expiresAt);
  }

  set(key, value) {
    const e = { key, value, expiresAt: this.now() + this.ttlMs };
    this.map.set(key, e);
    this.heap.push(e);
  }

  /** Drop everything expired. Heap entries that were overwritten are stale and skipped. */
  sweep() {
    const t = this.now();
    while (this.heap.size > 0 && this.heap.peek().expiresAt <= t) {
      const e = this.heap.pop();
      if (this.map.get(e.key) === e) this.map.delete(e.key);
    }
  }

  get(key) {
    this.sweep();
    return this.map.get(key)?.value;
  }

  get size() {
    this.sweep();
    return this.map.size;
  }

  serialize() {
    return [...this.map.values()];
  }

  static restore(entries, ttlMs, now) {
    const c = new TtlCache(ttlMs, now);
    for (const e of entries || []) {
      if (!e || typeof e.key !== 'string' || typeof e.expiresAt !== 'number') continue;
      c.map.set(e.key, e);
      c.heap.push(e);
    }
    c.sweep();
    return c;
  }
}

const USER_ORIGIN = 'user';

/**
 * Merges the codes we already know with the codes the site itself lists for this cart.
 *   known:  [{ code, origin }]  (origin: user | server | seed | known)
 *   listed: [{ code, eligible }]  (from the site's own coupon list)
 * Order: user codes, then eligible listed codes, then everything else. De-duplicated, the first origin wins,
 * capped at `cap`. Codes the site lists as NOT applicable are never tried; they come back in `skipped`.
 */
export function mergeCandidates({ known = [], listed = [] } = {}, cap = 10) {
  const knownNorm = known
    .map((k) => (typeof k === 'string' ? { code: k, origin: 'known' } : k))
    .map((k) => ({ code: normalizeCode(k?.code), origin: k?.origin || 'known' }))
    .filter((k) => k.code.length > 0);
  const listedNorm = listed
    .map((l) => ({ code: normalizeCode(l?.code), eligible: l?.eligible !== false }))
    .filter((l) => CODE_RE.test(l.code));

  const skipped = [...new Set(listedNorm.filter((l) => !l.eligible).map((l) => l.code))];
  const skip = new Set(skipped);

  const ordered = [
    ...knownNorm.filter((k) => k.origin === USER_ORIGIN),
    ...listedNorm.filter((l) => l.eligible).map((l) => ({ code: l.code, origin: 'listed' })),
    ...knownNorm.filter((k) => k.origin !== USER_ORIGIN),
  ];
  const seen = new Set();
  const list = [];
  for (const c of ordered) {
    if (seen.has(c.code) || skip.has(c.code)) continue;
    seen.add(c.code);
    list.push(c);
    if (list.length >= cap) break;
  }
  return { list, skipped };
}
