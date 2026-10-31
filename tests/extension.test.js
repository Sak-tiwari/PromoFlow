import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { buildCandidates, TtlCache } from '../src/background/candidates.js';
import { t, pickLang, LANGS } from '../src/i18n/i18n.js';

describe('i18n', () => {
  const tables = Object.fromEntries(Object.keys(LANGS).map((l) => [l, JSON.parse(fs.readFileSync(`src/i18n/${l}.json`, 'utf8'))]));
  it('all languages have exactly the same keys and no empty strings', () => {
    const keys = Object.keys(tables.en).sort();
    for (const [l, tb] of Object.entries(tables)) {
      expect(Object.keys(tb).sort(), l).toEqual(keys);
      for (const v of Object.values(tb)) expect(v.trim().length).toBeGreaterThan(0);
    }
  });
  it('keeps placeholders identical across languages', () => {
    for (const [l, tb] of Object.entries(tables)) {
      for (const k of Object.keys(tables.en)) {
        const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
        expect(ph(tb[k]), `${l}.${k}`).toBe(ph(tables.en[k]));
      }
    }
  });
  it('interpolates, falls back, and picks a language', () => {
    expect(t('hi', 'trying', { code: 'A1', n: 1, total: 3 })).toContain('A1');
    expect(t('xx', 'find')).toBe(tables.en.find);
    expect(pickLang(null, 'ta-IN')).toBe('ta');
    expect(pickLang('fr', 'fr-FR')).toBe('en');
  });
  it('locale message files exist for each language', () => {
    for (const l of Object.keys(LANGS)) {
      const m = JSON.parse(fs.readFileSync(`_locales/${l}/messages.json`, 'utf8'));
      expect(m.extName.message).toBeTruthy();
      expect(m.extDesc.message.length).toBeLessThanOrEqual(132);
    }
  });
});

describe('buildCandidates', () => {
  it('ranks by evidence, puts user codes first, dedupes, and caps at k', () => {
    const out = buildCandidates({
      server: [{ code: 'good', score: 0.8 }, { code: 'bad', score: 0.05 }],
      seed: [{ code: 'GOOD', stats: { tries: 5, successes: 5 } }, { code: 'MID', stats: { tries: 10, successes: 5 } }],
      user: ['mine', 'bad'],
    }, 10);
    expect(out.map((c) => c.code)).toEqual(['BAD', 'MINE', 'GOOD', 'MID'].sort((a, b) => out.findIndex((c) => c.code === a) - out.findIndex((c) => c.code === b)));
    expect(new Set(out.map((c) => c.code)).size).toBe(out.length);
    expect(out.slice(0, 2).map((c) => c.code).sort()).toEqual(['BAD', 'MINE']);
    expect(buildCandidates({ user: Array.from({ length: 30 }, (_, i) => `CODE${i}`) }, 10)).toHaveLength(10);
  });
  it('never invents codes and ignores junk', () => {
    expect(buildCandidates({ server: [{ code: '' }, { code: '!!' }] }, 10)).toEqual([]);
  });
});

describe('TtlCache', () => {
  it('expires entries via the MinHeap and survives serialize/restore', () => {
    let now = 1000;
    const c = new TtlCache(100, () => now);
    c.set('a', 1); now = 1050; c.set('b', 2);
    expect(c.get('a')).toBe(1);
    const restored = TtlCache.restore(c.serialize(), 100, () => now);
    now = 1120;
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
    expect(restored.get('b')).toBe(2);
    now = 1200;
    expect(restored.size).toBe(0);
  });
  it('an overwritten key is not deleted by its stale heap entry', () => {
    let now = 0;
    const c = new TtlCache(100, () => now);
    c.set('k', 'old'); now = 60; c.set('k', 'new'); now = 110;
    expect(c.get('k')).toBe('new');
  });
});
