// In-memory repository (default when MONGODB_URI is not set; also used by tests).
// Same interface as mongoRepo.js.

export function createMemoryRepo(seed = { stores: [], coupons: [] }) {
  const stores = new Map(seed.stores.map((s) => [s.domain, { ...s }]));
  const coupons = new Map(); // key: domain|code
  for (const c of seed.coupons) {
    coupons.set(`${c.domain}|${c.code}`, { stats: { tries: 0, successes: 0 }, ...c, stats: { tries: 0, successes: 0, ...(c.stats || {}) } });
  }
  const reports = new Set(); // dedupe key: client|domain|code|day

  return {
    kind: 'memory',
    async getStore(domain) {
      return stores.get(domain) ?? null;
    },
    async listCoupons(domain) {
      return [...coupons.values()].filter((c) => c.domain === domain && c.status !== 'dead').map((c) => structuredClone(c));
    },
    /** Returns true if the report was counted, false if it was a duplicate (same client, code and day). */
    async recordReport({ domain, code, outcome, clientId, day }) {
      const key = `${clientId}|${domain}|${code}|${day}`;
      if (reports.has(key)) return false;
      reports.add(key);
      const k = `${domain}|${code}`;
      let c = coupons.get(k);
      if (!c) {
        c = { domain, code, type: 'unknown', value: 0, source: 'crowd', stats: { tries: 0, successes: 0 } };
        coupons.set(k, c);
      }
      c.stats.tries += 1;
      if (outcome === 'applied') c.stats.successes += 1;
      return true;
    },
    async close() {},
  };
}
