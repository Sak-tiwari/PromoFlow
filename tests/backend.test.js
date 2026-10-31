import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../backend/app.js';
import { createMemoryRepo } from '../backend/repo/memoryRepo.js';
import { wilsonLowerBound, rankCoupons } from '../backend/ranking.js';

const seed = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../backend/data/seed.json'), 'utf8'));
const CLIENT = 'client-aaaa-0001';

describe('ranking', () => {
  it('prefers proven codes over unproven and penalizes tiny samples', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
    expect(wilsonLowerBound(10, 10)).toBeGreaterThan(wilsonLowerBound(1, 1));
    const r = rankCoupons([
      { code: 'NEWONE', stats: { tries: 0, successes: 0 } },
      { code: 'GOOD', stats: { tries: 40, successes: 36 } },
      { code: 'DEAD', stats: { tries: 25, successes: 0 } },
    ]);
    expect(r.map((c) => c.code)).toEqual(['GOOD', 'NEWONE', 'DEAD']);
  });
});

describe('API', () => {
  let app;
  beforeEach(() => { app = createApp({ repo: createMemoryRepo(structuredClone(seed)) }); });

  it('health', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok', repo: 'memory' });
  });

  it('returns coupons for a domain ranked by success, normalizing www', async () => {
    const r = await request(app).get('/api/v1/coupons/www.localhost');
    expect(r.status).toBe(200);
    expect(r.body.domain).toBe('localhost');
    expect(r.body.coupons[0].code).toBe('SAVE10');
    expect(r.body.coupons.at(-1).score).toBeLessThan(r.body.coupons[0].score);
    expect(r.body.coupons[0]).not.toHaveProperty('domain');
  });

  it('returns an empty list (not an error) for a site with no codes', async () => {
    const r = await request(app).get('/api/v1/coupons/amazon.in');
    expect(r.status).toBe(200);
    expect(r.body.coupons).toEqual([]);
  });

  it('rejects malformed domains', async () => {
    expect((await request(app).get('/api/v1/coupons/' + encodeURIComponent('bad domain!'))).status).toBe(400);
  });

  it('counts a report once per client, code and day, and re-ranks', async () => {
    const body = { domain: 'localhost', code: 'old20', outcome: 'applied', clientId: CLIENT };
    const a = await request(app).post('/api/v1/coupons/report').send(body);
    expect(a.status).toBe(202);
    expect(a.body.counted).toBe(true);
    const b = await request(app).post('/api/v1/coupons/report').send(body);
    expect(b.body.counted).toBe(false); // duplicate the same day
    const list = (await request(app).get('/api/v1/coupons/localhost')).body.coupons;
    const old = list.find((c) => c.code === 'OLD20');
    expect(old.stats).toEqual({ tries: 26, successes: 1 });
  });

  it('creates a crowd-sourced coupon from a report for an unknown code', async () => {
    await request(app).post('/api/v1/coupons/report').send({ domain: 'flipkart.com', code: 'NEWCODE', outcome: 'applied', clientId: CLIENT });
    const list = (await request(app).get('/api/v1/coupons/flipkart.com')).body.coupons;
    expect(list[0]).toMatchObject({ code: 'NEWCODE', source: 'crowd', stats: { tries: 1, successes: 1 } });
  });

  it('validates reports', async () => {
    const bad = [
      { domain: 'localhost', code: 'x', outcome: 'applied', clientId: CLIENT },
      { domain: 'localhost', code: 'GOODCODE', outcome: 'hacked', clientId: CLIENT },
      { domain: 'localhost', code: 'GOODCODE', outcome: 'applied', clientId: 'short' },
    ];
    for (const b of bad) expect((await request(app).post('/api/v1/coupons/report').send(b)).status).toBe(400);
    // A Mongo-operator object in a string field must be rejected, not passed to the database.
    const op = await request(app).post('/api/v1/coupons/report').send({ domain: { $ne: '' }, code: 'GOODCODE', outcome: 'applied', clientId: CLIENT });
    expect(op.status).toBe(400);
  });

  it('store config and 404', async () => {
    expect((await request(app).get('/api/v1/stores/flipkart.com/config')).body.adapter).toBe('flipkart');
    expect((await request(app).get('/api/v1/stores/unknown.example/config')).status).toBe(404);
  });

  it('sets CORS for extension origins only', async () => {
    const ok = await request(app).get('/health').set('Origin', 'chrome-extension://abcdefghijklmnop');
    expect(ok.headers['access-control-allow-origin']).toBe('chrome-extension://abcdefghijklmnop');
    const no = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(no.headers['access-control-allow-origin']).toBeUndefined();
  });
});
