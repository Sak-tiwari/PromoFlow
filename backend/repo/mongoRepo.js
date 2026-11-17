// MongoDB repository (used when MONGODB_URI is set). Same interface as memoryRepo.js.
// NOTE: written against the official driver but not run in the build sandbox (no MongoDB available there).
// Run `npm run backend` against a real MongoDB and hit /health and the coupons endpoint to verify.

import { MongoClient } from 'mongodb';
import { mergeCoupon } from '../harvest/normalize.js';
import { FAIL_OUTCOMES, DEAD_AFTER_CLIENTS, DEAD_WINDOW_MS, DEAD_FOR_MS, SHARE_PROMOTE_CLIENTS } from './rules.js';

export async function createMongoRepo(uri, dbName = 'promoflow') {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);
  const stores = db.collection('stores');
  const coupons = db.collection('coupons');
  const reports = db.collection('reports');
  const shares = db.collection('shares');

  await stores.createIndex({ domain: 1 }, { unique: true });
  await coupons.createIndex({ domain: 1, code: 1 }, { unique: true });
  // One counted report per client, code and day; reports expire after 90 days.
  await reports.createIndex({ clientId: 1, domain: 1, code: 1, day: 1 }, { unique: true });
  await reports.createIndex({ domain: 1, code: 1, createdAt: 1 });
  await reports.createIndex({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });
  await shares.createIndex({ domain: 1, code: 1, clientId: 1 }, { unique: true });
  await shares.createIndex({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

  const strip = { projection: { _id: 0 } };

  return {
    kind: 'mongo',
    async getStore(domain) {
      return stores.findOne({ domain }, strip);
    },
    async listCoupons(domain) {
      return coupons.find({ domain }, strip).toArray();
    },
    async recordReport({ domain, code, outcome, clientId, day, now = Date.now() }) {
      try {
        await reports.insertOne({ clientId, domain, code, day, outcome, createdAt: new Date(now) });
      } catch (e) {
        if (e?.code === 11000) return false; // duplicate report
        throw e;
      }
      const ok = outcome === 'applied';
      const set = ok ? { lastSuccessAt: now, status: 'active', deadUntil: null } : FAIL_OUTCOMES.has(outcome) ? { lastFailAt: now } : {};
      const after = await coupons.findOneAndUpdate(
        { domain, code },
        {
          $inc: { 'stats.tries': 1, 'stats.successes': ok ? 1 : 0 },
          ...(Object.keys(set).length ? { $set: set } : {}),
          $setOnInsert: { type: 'unknown', value: 0, source: 'crowd', sources: ['crowd'], ...(ok ? {} : { status: 'active' }) },
        },
        { upsert: true, returnDocument: 'after', projection: { _id: 0 } },
      );
      if (!ok && FAIL_OUTCOMES.has(outcome)) {
        const since = Math.max(now - DEAD_WINDOW_MS, after?.lastSuccessAt ?? 0);
        const failers = await reports.distinct('clientId', { domain, code, outcome: { $in: [...FAIL_OUTCOMES] }, createdAt: { $gt: new Date(since) } });
        if (failers.length >= DEAD_AFTER_CLIENTS) await coupons.updateOne({ domain, code }, { $set: { status: 'dead', deadUntil: now + DEAD_FOR_MS } });
      }
      return true;
    },
    async upsertHarvested(list) {
      let inserted = 0;
      let updated = 0;
      for (const inc of list) {
        const prev = await coupons.findOne({ domain: inc.domain, code: inc.code }, strip);
        await coupons.replaceOne({ domain: inc.domain, code: inc.code }, mergeCoupon(prev, inc), { upsert: true });
        prev ? updated++ : inserted++;
      }
      return { inserted, updated };
    },
    async recordShare({ domain, code, clientId, now = Date.now() }) {
      try {
        await shares.insertOne({ domain, code, clientId, createdAt: new Date(now) });
      } catch (e) {
        if (e?.code !== 11000) throw e;
        const c = await coupons.findOne({ domain, code }, strip);
        return { counted: false, promoted: !!c?.sources?.includes('shared') };
      }
      const n = (await shares.distinct('clientId', { domain, code })).length;
      const promoted = n >= SHARE_PROMOTE_CLIENTS;
      if (promoted) {
        const prev = await coupons.findOne({ domain, code }, strip);
        const merged = mergeCoupon(prev, { domain, code, source: 'shared', sources: ['shared'], description: '', expiresAt: null, minSpend: null, firstOrderOnly: false, firstSeen: now, lastSeen: now });
        merged.lastSuccessAt = Math.max(merged.lastSuccessAt ?? 0, now);
        await coupons.replaceOne({ domain, code }, merged, { upsert: true });
      }
      return { counted: true, promoted };
    },
    async close() {
      await client.close();
    },
  };
}
