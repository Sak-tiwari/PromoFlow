// MongoDB repository (used when MONGODB_URI is set). Same interface as memoryRepo.js.
// NOTE: written against the official driver but not run in the build sandbox (no MongoDB available there).
// Run `npm run backend` against a real MongoDB and hit /health and the coupons endpoint to verify.

import { MongoClient } from 'mongodb';

export async function createMongoRepo(uri, dbName = 'promoflow') {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);
  const stores = db.collection('stores');
  const coupons = db.collection('coupons');
  const reports = db.collection('reports');

  await stores.createIndex({ domain: 1 }, { unique: true });
  await coupons.createIndex({ domain: 1, code: 1 }, { unique: true });
  // One counted report per client, code and day; reports expire after 90 days.
  await reports.createIndex({ clientId: 1, domain: 1, code: 1, day: 1 }, { unique: true });
  await reports.createIndex({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

  return {
    kind: 'mongo',
    async getStore(domain) {
      return stores.findOne({ domain }, { projection: { _id: 0 } });
    },
    async listCoupons(domain) {
      return coupons.find({ domain, status: { $ne: 'dead' } }, { projection: { _id: 0 } }).toArray();
    },
    async recordReport({ domain, code, outcome, clientId, day }) {
      try {
        await reports.insertOne({ clientId, domain, code, day, outcome, createdAt: new Date() });
      } catch (e) {
        if (e?.code === 11000) return false; // duplicate report
        throw e;
      }
      await coupons.updateOne(
        { domain, code },
        {
          $inc: { 'stats.tries': 1, 'stats.successes': outcome === 'applied' ? 1 : 0 },
          $setOnInsert: { type: 'unknown', value: 0, source: 'crowd' },
        },
        { upsert: true },
      );
      return true;
    },
    async close() {
      await client.close();
    },
  };
}
