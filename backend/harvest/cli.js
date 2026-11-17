// npm run harvest            -> runs the enabled sources in backend/harvest/sources.json
// npm run harvest -- --dry   -> fetches and prints the summary, writes nothing
// With MONGODB_URI set, results go to MongoDB. Without it they are merged into backend/data/harvested.json,
// which the in-memory backend loads at start (laptop / demo mode).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harvest } from './run.js';
import { mergeCoupon } from './normalize.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.argv.includes('--config') ? process.argv[process.argv.indexOf('--config') + 1] : path.join(here, 'sources.json');
const dry = process.argv.includes('--dry');
export const HARVESTED_FILE = path.join(here, '../data/harvested.json');

const { sources } = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const enabled = sources.filter((s) => s.enabled);
if (!enabled.length) {
  console.log(`No enabled sources in ${configPath}. Set "enabled": true on a source (see docs/V3_COUPON_SOURCING_PLAN.md).`);
  process.exit(0);
}

let repo = null;
let fileRepo = null;
if (!dry && process.env.MONGODB_URI) {
  const { createMongoRepo } = await import('../repo/mongoRepo.js');
  repo = await createMongoRepo(process.env.MONGODB_URI, process.env.MONGODB_DB || 'promoflow');
} else if (!dry) {
  const prev = fs.existsSync(HARVESTED_FILE) ? JSON.parse(fs.readFileSync(HARVESTED_FILE, 'utf8')) : [];
  const map = new Map(prev.map((c) => [`${c.domain}|${c.code}`, c]));
  fileRepo = {
    async upsertHarvested(list) {
      let inserted = 0; let updated = 0;
      for (const c of list) { const k = `${c.domain}|${c.code}`; map.has(k) ? updated++ : inserted++; map.set(k, mergeCoupon(map.get(k), c)); }
      fs.writeFileSync(HARVESTED_FILE, `${JSON.stringify([...map.values()], null, 1)}\n`);
      return { inserted, updated };
    },
  };
}

const result = await harvest({ sources, repo: repo ?? fileRepo });
for (const l of result.summary) {
  console.log(`${l.name}: fetched ${l.fetched}, kept ${l.kept}${Object.keys(l.rejected).length ? `, rejected ${JSON.stringify(l.rejected)}` : ''}${l.error ? `, ERROR ${l.error}` : ''}`);
}
console.log(dry ? 'Dry run: nothing written.' : `Written: ${result.written.inserted} new, ${result.written.updated} updated (${repo ? 'MongoDB' : HARVESTED_FILE}).`);
await repo?.close();
if (result.summary.some((l) => l.error)) process.exitCode = 1;
