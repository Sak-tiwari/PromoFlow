import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createMemoryRepo } from './repo/memoryRepo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const seed = JSON.parse(fs.readFileSync(path.join(here, 'data/seed.json'), 'utf8'));

let repo;
if (process.env.MONGODB_URI) {
  const { createMongoRepo } = await import('./repo/mongoRepo.js');
  repo = await createMongoRepo(process.env.MONGODB_URI, process.env.MONGODB_DB || 'promoflow');
  if (process.argv.includes('--seed')) {
    const db = (await import('mongodb')).MongoClient;
    const c = await new db(process.env.MONGODB_URI).connect();
    const d = c.db(process.env.MONGODB_DB || 'promoflow');
    for (const s of seed.stores) await d.collection('stores').updateOne({ domain: s.domain }, { $set: s }, { upsert: true });
    for (const k of seed.coupons) await d.collection('coupons').updateOne({ domain: k.domain, code: k.code }, { $setOnInsert: k }, { upsert: true });
    await c.close();
    console.log('Seeded MongoDB');
  }
} else {
  repo = createMemoryRepo(seed);
  console.log('MONGODB_URI not set: using the in-memory repository (data resets on restart).');
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
createApp({ repo, allowedOrigins }).listen(port, () => console.log(`Promo-Flow API on http://localhost:${port} (${repo.kind})`));
