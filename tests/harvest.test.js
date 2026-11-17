import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { normalizeDomain, parseDate, parseMinSpend, isFirstOrderOnly, normalizeItem, normalizeBatch, mergeCoupon } from '../backend/harvest/normalize.js';
import { getPath, mapItem, fetchJsonFeed } from '../backend/harvest/sources/jsonFeed.js';
import { parseCsv, readFileDataset } from '../backend/harvest/sources/fileDataset.js';
import { harvest, validateSourceConfig } from '../backend/harvest/run.js';
import { createMemoryRepo } from '../backend/repo/memoryRepo.js';
import { scoreCoupon, freshness, reliability, rankCoupons, fit } from '../backend/ranking.js';
import { createApp } from '../backend/app.js';

const FEEDS = path.resolve(__dirname, 'fixtures/feeds');
const DAY = 86_400_000;
const NOW = Date.parse('2026-11-17T10:00:00+05:30');
const feedText = fs.readFileSync(path.join(FEEDS, 'sample-feed.json'), 'utf8');
const fakeFetch = (body, status = 200) => async (url, opts) => ({ ok: status < 400, status, text: async () => body, url, opts });
const FEED_CFG = {
  name: 'test-feed', type: 'jsonFeed', source: 'feed', enabled: true, url: 'https://feed.test/v1', apiKeyEnv: 'K', apiKeyPrefix: 'Token ',
  itemsPath: 'data.offers', fields: { code: 'coupon_code', url: 'merchant_url', expiresAt: 'end_date', description: 'title', startedAt: 'start_date' },
  domains: ['myntra.com', 'ajio.com', 'nykaa.com'],
};

describe('normalize', () => {
  it('cleans domains', () => {
    expect(normalizeDomain('https://www.Myntra.com/checkout/cart?x=1')).toBe('myntra.com');
    expect(normalizeDomain('ajio.com')).toBe('ajio.com');
    expect(normalizeDomain('localhost')).toBe('localhost');
    for (const bad of ['', 'not a url', 'myntra', 'javascript:alert(1)', null]) expect(normalizeDomain(bad)).toBeNull();
  });

  it('parses dates in the formats coupon sources use (end of day, India time)', () => {
    const end30Nov = Date.parse('2026-11-30T23:59:59+05:30');
    expect(parseDate('2026-11-30')).toBe(end30Nov);
    expect(parseDate('30/11/2026')).toBe(end30Nov);
    expect(parseDate('30th November 2026')).toBe(end30Nov);
    expect(parseDate('Nov 30, 2026')).toBe(end30Nov);
    expect(parseDate('2026-11-30T10:00:00Z')).toBe(Date.parse('2026-11-30T10:00:00Z'));
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('soon')).toBeNull();
    expect(parseDate('')).toBeNull();
  });

  it('reads minimum spend in paise and first-order wording', () => {
    expect(parseMinSpend('Flat 15% off on minimum purchase of Rs. 1,499')).toBe(149900);
    expect(parseMinSpend('10% off on min spend of ₹3,000')).toBe(300000);
    expect(parseMinSpend('Rs. 250 off on orders above ₹2,490')).toBe(249000);
    expect(parseMinSpend('Flat 20% off')).toBeNull();
    expect(isFirstOrderOnly('Rs. 200 off on your first order above Rs. 999')).toBe(true);
    expect(isFirstOrderOnly('Valid for new users only')).toBe(true);
    expect(isFirstOrderOnly('Flat 20% off')).toBe(false);
  });

  it('rejects deals without a code, expired codes, bad codes and bad domains', () => {
    const n = (raw) => normalizeItem(raw, { source: 'feed', now: NOW });
    expect(n({ code: '', url: 'myntra.com' }).reason).toBe('no_code');
    expect(n({ code: 'OLD', url: 'ajio.com', expiresAt: '2026-10-01' }).reason).toBe('expired');
    expect(n({ code: 'BAD CODE!!', url: 'ajio.com' }).reason).toBe('bad_code');
    expect(n({ code: 'AJIO300', url: 'not a url' }).reason).toBe('bad_domain');
    expect(normalizeItem({ code: 'X1X', url: 'a.com' }, { source: 'hacker', now: NOW }).reason).toBe('unknown_source');
    const ok = n({ code: ' myntra15 ', url: 'https://www.myntra.com/', description: 'min purchase of Rs. 1,499', startedAt: '2026-11-10' });
    expect(ok.ok).toBe(true);
    expect(ok.coupon).toMatchObject({ domain: 'myntra.com', code: 'MYNTRA15', source: 'feed', minSpend: 149900, lastSeen: NOW });
    expect(ok.coupon.firstSeen).toBe(Date.parse('2026-11-10T23:59:59+05:30'));
  });

  it('a start date in the future does not become firstSeen', () => {
    const r = normalizeItem({ code: 'FUTURE1', url: 'a.com', startedAt: '2027-01-01' }, { source: 'feed', now: NOW });
    expect(r.coupon.firstSeen).toBe(NOW);
  });

  it('de-duplicates a batch and keeps the later expiry', () => {
    const items = JSON.parse(feedText).data.offers.map((o) => mapItem(o, FEED_CFG.fields));
    const { coupons, rejected } = normalizeBatch(items, { source: 'feed', now: NOW });
    expect(coupons.map((c) => c.code).sort()).toEqual(['MYNTRA15', 'NYKAANEW', 'SHOPUS20']);
    expect(coupons.find((c) => c.code === 'MYNTRA15').expiresAt).toBe(Date.parse('2027-01-15T23:59:59+05:30'));
    expect(coupons.find((c) => c.code === 'NYKAANEW').firstOrderOnly).toBe(true);
    expect(rejected).toEqual({ no_code: 1, expired: 1, bad_code: 1, bad_domain: 1 });
  });

  it('merges a harvested record into a stored one without losing stats or sources', () => {
    const stored = { domain: 'myntra.com', code: 'MYNTRA15', source: 'dataset', sources: ['dataset'], firstSeen: NOW - 30 * DAY, lastSeen: NOW - 30 * DAY, expiresAt: null, stats: { tries: 5, successes: 3 }, lastSuccessAt: NOW - 20 * DAY };
    const inc = { domain: 'myntra.com', code: 'MYNTRA15', source: 'feed', sources: ['feed'], firstSeen: NOW - DAY, lastSeen: NOW, expiresAt: NOW + 10 * DAY, minSpend: 149900, description: 'new' };
    const m = mergeCoupon(stored, inc);
    expect(m).toMatchObject({ source: 'feed', sources: ['dataset', 'feed'], firstSeen: NOW - 30 * DAY, lastSeen: NOW, expiresAt: NOW + 10 * DAY, stats: { tries: 5, successes: 3 }, lastSuccessAt: NOW - 20 * DAY, minSpend: 149900 });
    expect(mergeCoupon(null, inc)).toMatchObject({ status: 'active', stats: { tries: 0, successes: 0 } });
    expect(mergeCoupon({ ...stored, expiresAt: NOW + 5 * DAY }, { ...inc, expiresAt: null }).expiresAt).toBe(NOW + 5 * DAY);
  });
});

describe('sources', () => {
  it('json feed: maps fields, sends the key from the environment, never from config', async () => {
    let seen;
    const items = await fetchJsonFeed(FEED_CFG, { fetchImpl: async (url, opts) => { seen = { url, opts }; return fakeFetch(feedText)(); }, env: { K: 'secret' } });
    expect(items).toHaveLength(8);
    expect(items[0]).toMatchObject({ code: 'MYNTRA15', url: 'https://www.myntra.com/', expiresAt: '2026-12-31' });
    expect(seen.opts.headers.Authorization).toBe('Token secret');
    await expect(fetchJsonFeed(FEED_CFG, { fetchImpl: fakeFetch(feedText), env: {} })).rejects.toThrow(/K is not set/);
    await expect(fetchJsonFeed({ ...FEED_CFG, url: 'http://insecure' }, { fetchImpl: fakeFetch(feedText), env: { K: 'x' } })).rejects.toThrow(/https/);
    await expect(fetchJsonFeed(FEED_CFG, { fetchImpl: fakeFetch('{}', 500), env: { K: 'x' } })).rejects.toThrow(/HTTP 500/);
    await expect(fetchJsonFeed({ ...FEED_CFG, itemsPath: 'nope' }, { fetchImpl: fakeFetch(feedText), env: { K: 'x' } })).rejects.toThrow(/not a list/);
    expect(getPath({ a: { b: [{ c: 1 }] } }, 'a.b.0.c')).toBe(1);
  });

  it('csv dataset: quotes, commas inside quotes, safe file names only', async () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n\n1,2')).toEqual([{ a: 'x, y', b: 'say "hi"' }, { a: '1', b: '2' }]);
    const items = await readFileDataset({ name: 'd', file: 'sample-dataset.csv' }, { dir: FEEDS });
    expect(items[0]).toMatchObject({ code: 'AJIO250', domain: 'ajio.com', expiresAt: '15th December 2026' });
    await expect(readFileDataset({ name: 'd', file: '../secrets.json' }, { dir: FEEDS })).rejects.toThrow(/plain/);
  });

  it('validates source configs', () => {
    expect(validateSourceConfig(FEED_CFG)).toEqual([]);
    expect(validateSourceConfig({ ...FEED_CFG, type: 'scraper' }).join()).toMatch(/type/);
    expect(validateSourceConfig({ ...FEED_CFG, source: 'shared' }).join()).toMatch(/source/);
    expect(validateSourceConfig({ ...FEED_CFG, name: 'Bad Name' }).join()).toMatch(/name/);
  });
});

describe('harvest run', () => {
  it('runs enabled sources, keeps allowed domains, continues past a failing source, and upserts', async () => {
    const repo = createMemoryRepo({ stores: [], coupons: [] });
    const sources = [
      FEED_CFG,
      { name: 'csv', type: 'file', source: 'dataset', enabled: true, file: 'sample-dataset.csv', domains: ['ajio.com', 'myntra.com'] },
      { name: 'broken', type: 'jsonFeed', source: 'feed', enabled: true, url: 'https://down.test', itemsPath: 'x' },
      { name: 'off', type: 'jsonFeed', source: 'feed', enabled: false, url: 'https://never.test' },
    ];
    const fetchImpl = async (url) => (url.startsWith('https://feed.test') ? fakeFetch(feedText)() : fakeFetch('', 503)());
    const r = await harvest({ sources, repo, now: NOW, deps: { fetchImpl, env: { K: 'k' }, dir: FEEDS } });
    expect(r.summary.map((l) => l.name)).toEqual(['test-feed', 'csv', 'broken']);
    expect(r.summary[0]).toMatchObject({ fetched: 8, kept: 2, rejected: { other_domain: 1 } });
    expect(r.summary[1]).toMatchObject({ kept: 2, rejected: { bad_code: 1 } });
    expect(r.summary[2].error).toMatch(/503/);
    const myntra = await repo.listCoupons('myntra.com');
    expect(myntra).toHaveLength(1);
    expect(myntra[0]).toMatchObject({ code: 'MYNTRA15', source: 'feed', sources: ['feed', 'dataset'] });
    expect((await repo.listCoupons('example-us-store.com'))).toEqual([]);
  });
});

describe('scorer', () => {
  const base = { code: 'X', source: 'feed', stats: { tries: 0, successes: 0 } };
  it('freshness halves every 7 days; no dates means fresh', () => {
    expect(freshness({ lastSeen: NOW }, NOW)).toBe(1);
    expect(freshness({ lastSeen: NOW - 7 * DAY }, NOW)).toBeCloseTo(0.5, 6);
    expect(freshness({ lastSeen: NOW - 14 * DAY, lastSuccessAt: NOW - 7 * DAY }, NOW)).toBeCloseTo(0.5, 6);
    expect(freshness({}, NOW)).toBe(1);
  });
  it('reliability uses the source prior until reports exist', () => {
    expect(reliability({ ...base, source: 'shared' })).toBeGreaterThan(reliability({ ...base, source: 'feed' }));
    expect(reliability({ ...base, source: 'feed' })).toBeGreaterThan(reliability({ ...base, source: 'dataset' }));
    expect(reliability({ ...base, stats: { tries: 20, successes: 18 } })).toBeGreaterThan(reliability({ ...base, source: 'shared' }));
  });
  it('fit drops expired and dead codes and halves first-order codes', () => {
    expect(fit({ expiresAt: NOW - 1 }, NOW)).toBe(0);
    expect(fit({ status: 'dead', deadUntil: NOW + DAY }, NOW)).toBe(0);
    expect(fit({ status: 'dead', deadUntil: NOW - 1 }, NOW)).toBe(1); // revived after its dead period
    expect(fit({ firstOrderOnly: true }, NOW)).toBe(0.5);
  });
  it('ranks a fresh feed code above a stale one and a proven code above both; excludes and caps', () => {
    const list = [
      { ...base, code: 'STALE', lastSeen: NOW - 28 * DAY },
      { ...base, code: 'FRESH', lastSeen: NOW },
      { ...base, code: 'PROVEN', lastSeen: NOW - DAY, lastSuccessAt: NOW - DAY, stats: { tries: 30, successes: 27 } },
      { ...base, code: 'GONE', lastSeen: NOW, expiresAt: NOW - 1 },
    ];
    expect(rankCoupons(list, { now: NOW }).map((c) => c.code)).toEqual(['PROVEN', 'FRESH', 'STALE']);
    expect(rankCoupons(list, { now: NOW, k: 1 }).map((c) => c.code)).toEqual(['PROVEN']);
    expect(rankCoupons(list, { now: NOW, exclude: ['proven'] }).map((c) => c.code)).toEqual(['FRESH', 'STALE']);
    expect(scoreCoupon(list[3], NOW)).toBe(0);
  });
});

describe('repo rules: dead codes and sharing', () => {
  const report = (repo, clientId, outcome, now, day = 'd1') => repo.recordReport({ domain: 'myntra.com', code: 'MYNTRA15', outcome, clientId, day, now });
  it('marks a code dead after 3 different clients see it fail within 24 h, and revives it on success', async () => {
    const repo = createMemoryRepo({ stores: [], coupons: [] });
    await report(repo, 'client-0000001', 'invalid', NOW);
    await report(repo, 'client-0000001', 'invalid', NOW + 1, 'd2'); // same client again: still one client
    await report(repo, 'client-0000002', 'min_spend_not_met', NOW + 2); // says nothing about the code itself
    await report(repo, 'client-0000003', 'expired', NOW + 3);
    expect((await repo.listCoupons('myntra.com'))[0].status).toBe('active');
    await report(repo, 'client-0000004', 'no_effect', NOW + 4);
    const dead = (await repo.listCoupons('myntra.com'))[0];
    expect(dead.status).toBe('dead');
    expect(rankCoupons([dead], { now: NOW + 5 })).toEqual([]);
    await report(repo, 'client-0000005', 'applied', NOW + 6);
    expect((await repo.listCoupons('myntra.com'))[0]).toMatchObject({ status: 'active', lastSuccessAt: NOW + 6 });
  });
  it('old failures outside the 24 h window do not count', async () => {
    const repo = createMemoryRepo({ stores: [], coupons: [] });
    await report(repo, 'client-0000001', 'invalid', NOW - 2 * DAY);
    await report(repo, 'client-0000002', 'invalid', NOW);
    await report(repo, 'client-0000003', 'invalid', NOW);
    expect((await repo.listCoupons('myntra.com'))[0].status).toBe('active');
  });
  it('a shared code is served only after 2 different clients share it', async () => {
    const repo = createMemoryRepo({ stores: [], coupons: [] });
    expect(await repo.recordShare({ domain: 'ajio.com', code: 'FRIEND10', clientId: 'client-0000001', now: NOW })).toEqual({ counted: true, promoted: false });
    expect(await repo.recordShare({ domain: 'ajio.com', code: 'FRIEND10', clientId: 'client-0000001', now: NOW })).toEqual({ counted: false, promoted: false });
    expect(await repo.listCoupons('ajio.com')).toEqual([]);
    expect(await repo.recordShare({ domain: 'ajio.com', code: 'FRIEND10', clientId: 'client-0000002', now: NOW })).toEqual({ counted: true, promoted: true });
    expect((await repo.listCoupons('ajio.com'))[0]).toMatchObject({ code: 'FRIEND10', source: 'shared', lastSuccessAt: NOW });
  });
});

describe('API: k, exclude, share', () => {
  const mk = async () => {
    const repo = createMemoryRepo({ stores: [], coupons: [] });
    const now = Date.now();
    await repo.upsertHarvested(['AAA1', 'BBB2', 'CCC3', 'DDD4'].map((code, i) => ({ domain: 'myntra.com', code, source: 'feed', sources: ['feed'], firstSeen: now, lastSeen: now - i * DAY, expiresAt: null, minSpend: i === 0 ? 149900 : null, description: 'd' })));
    return createApp({ repo });
  };
  it('returns the top k, skips excluded codes, and carries freshness fields', async () => {
    const app = await mk();
    const r = await request(app).get('/api/v1/coupons/www.myntra.com?k=2&exclude=aaa1');
    expect(r.body.coupons.map((c) => c.code)).toEqual(['BBB2', 'CCC3']);
    expect(r.body.coupons[0]).toMatchObject({ source: 'feed', sources: ['feed'], minSpend: null, firstOrderOnly: false });
    expect(typeof r.body.coupons[0].lastSeen).toBe('number');
    const all = await request(app).get('/api/v1/coupons/myntra.com?k=999');
    expect(all.body.coupons).toHaveLength(4);
    expect(all.body.coupons[0]).toMatchObject({ code: 'AAA1', minSpend: 149900 });
  });
  it('accepts a valid share and rejects bad ones', async () => {
    const app = await mk();
    const ok = await request(app).post('/api/v1/coupons/share').send({ domain: 'ajio.com', code: 'friend10', clientId: 'client-aaaa-0001' });
    expect(ok.status).toBe(202);
    expect(ok.body).toEqual({ counted: true, promoted: false });
    for (const b of [{ domain: 'ajio.com', code: 'x', clientId: 'client-aaaa-0001' }, { domain: { $ne: 1 }, code: 'GOOD1', clientId: 'client-aaaa-0001' }, { domain: 'ajio.com', code: 'GOOD1' }]) {
      expect((await request(app).post('/api/v1/coupons/share').send(b)).status).toBe(400);
    }
  });
});
