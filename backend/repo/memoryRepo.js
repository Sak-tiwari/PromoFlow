// In-memory repository (default when MONGODB_URI is not set; also used by tests). Same interface as mongoRepo.js.

import { mergeCoupon } from '../harvest/normalize.js';
import { FAIL_OUTCOMES, DEAD_AFTER_CLIENTS, DEAD_WINDOW_MS, DEAD_FOR_MS, SHARE_PROMOTE_CLIENTS } from './rules.js';

export function createMemoryRepo(seed = { stores: [], coupons: [] }) {
  const stores = new Map(seed.stores.map((s) => [s.domain, { ...s }]));
  const coupons = new Map(); // key: domain|code
  for (const c of seed.coupons) {
    coupons.set(`${c.domain}|${c.code}`, { status: 'active', ...c, sources: c.sources ?? [c.source], stats: { tries: 0, successes: 0, ...(c.stats || {}) } });
  }
  const reportKeys = new Set(); // dedupe key: client|domain|code|day
  const reports = []; // { clientId, domain, code, outcome, at }
  const shares = new Map(); // domain|code -> Set(clientId)

  return {
    kind: 'memory',
    async getStore(domain) {
      return stores.get(domain) ?? null;
    },
    /** All coupons for a domain, including dead ones (ranking drops those while they are dead). */
    async listCoupons(domain) {
      return [...coupons.values()].filter((c) => c.domain === domain).map((c) => structuredClone(c));
    },
    /** Returns true if the report was counted, false if it was a duplicate (same client, code and day). */
    async recordReport({ domain, code, outcome, clientId, day, now = Date.now() }) {
      const key = `${clientId}|${domain}|${code}|${day}`;
      if (reportKeys.has(key)) return false;
      reportKeys.add(key);
      reports.push({ clientId, domain, code, outcome, at: now });
      const k = `${domain}|${code}`;
      let c = coupons.get(k);
      if (!c) {
        c = { domain, code, type: 'unknown', value: 0, source: 'crowd', sources: ['crowd'], status: 'active', stats: { tries: 0, successes: 0 } };
        coupons.set(k, c);
      }
      c.stats.tries += 1;
      if (outcome === 'applied') {
        c.stats.successes += 1;
        c.lastSuccessAt = now;
        c.status = 'active';
        c.deadUntil = null;
      } else if (FAIL_OUTCOMES.has(outcome)) {
        c.lastFailAt = now;
        const since = Math.max(now - DEAD_WINDOW_MS, c.lastSuccessAt ?? 0);
        const failers = new Set(reports.filter((r) => r.domain === domain && r.code === code && FAIL_OUTCOMES.has(r.outcome) && r.at > since).map((r) => r.clientId));
        if (failers.size >= DEAD_AFTER_CLIENTS) { c.status = 'dead'; c.deadUntil = now + DEAD_FOR_MS; }
      }
      return true;
    },
    /** Upserts harvested coupons (already normalized). Returns { inserted, updated }. */
    async upsertHarvested(list) {
      let inserted = 0;
      let updated = 0;
      for (const inc of list) {
        const k = `${inc.domain}|${inc.code}`;
        const prev = coupons.get(k);
        coupons.set(k, mergeCoupon(prev, inc));
        prev ? updated++ : inserted++;
      }
      return { inserted, updated };
    },
    /**
     * Opt-in share of a code that worked for this client. Counted once per client.
     * The code is served to others once SHARE_PROMOTE_CLIENTS different clients shared it.
     */
    async recordShare({ domain, code, clientId, now = Date.now() }) {
      const k = `${domain}|${code}`;
      const set = shares.get(k) ?? new Set();
      if (set.has(clientId)) return { counted: false, promoted: coupons.get(k)?.sources?.includes('shared') ?? false };
      set.add(clientId);
      shares.set(k, set);
      const promoted = set.size >= SHARE_PROMOTE_CLIENTS;
      if (promoted) {
        coupons.set(k, mergeCoupon(coupons.get(k), { domain, code, source: 'shared', sources: ['shared'], description: '', expiresAt: null, minSpend: null, firstOrderOnly: false, firstSeen: now, lastSeen: now }));
        coupons.get(k).lastSuccessAt = Math.max(coupons.get(k).lastSuccessAt ?? 0, now);
      }
      return { counted: true, promoted };
    },
    async close() {},
  };
}
