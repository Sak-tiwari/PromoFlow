import { describe, it, expect } from 'vitest';
import { Trie } from '../src/algorithms/Trie.js';
import { MaxHeap, MinHeap } from '../src/algorithms/Heap.js';
import { bestCombination, bruteForce, applyOption } from '../src/algorithms/Knapsack.js';
import { parseRupees, findRupeeAmounts, formatRupees } from '../src/lib/money.js';
import { parseOffer, estimateSaving } from '../src/lib/offerParser.js';

// Small deterministic PRNG so "random" tests are repeatable.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe('money', () => {
  it('parses Indian-formatted rupee strings to paise', () => {
    expect(parseRupees('₹1,23,456.00')).toBe(12345600);
    expect(parseRupees('Rs. 499')).toBe(49900);
    expect(parseRupees('INR 1,299.5')).toBe(129950);
    expect(parseRupees('₹ 499/-')).toBe(49900);
    expect(parseRupees('no digits')).toBeNull();
  });
  it('prefers amounts with a rupee marker over other numbers', () => {
    expect(findRupeeAmounts('Total (2 items) ₹ 1,299.00')).toEqual([129900]);
    expect(parseRupees('Total (2 items) ₹ 1,299.00')).toBe(129900);
  });
  it('formats with Indian grouping and Latin digits', () => {
    expect(formatRupees(12345600)).toBe('₹1,23,456.00');
    expect(formatRupees(99900)).toBe('₹999.00');
    expect(formatRupees(10000000)).toBe('₹1,00,000.00');
    expect(formatRupees(5)).toBe('₹0.05');
  });
  it('round-trips format -> parse', () => {
    const r = rng(1);
    for (let i = 0; i < 500; i++) {
      const p = Math.floor(r() * 1e9);
      expect(parseRupees(formatRupees(p))).toBe(p);
    }
  });
});

describe('Trie', () => {
  it('inserts, searches and matches prefixes case-insensitively', () => {
    const t = new Trie();
    t.insert('save20');
    t.insert('SAVE10');
    expect(t.search('SAVE20')).toBe(true);
    expect(t.search('save')).toBe(false);
    expect(t.startsWith('sav')).toBe(true);
    expect(t.startsWith('xyz')).toBe(false);
    expect(t.size).toBe(2);
  });
  it('gives a new code a prior from its known prefix family', () => {
    const t = new Trie();
    for (let i = 0; i < 10; i++) t.record('WELCOME10', true);
    for (let i = 0; i < 10; i++) t.record('RANDOMXYZ', false);
    expect(t.prior('WELCOME15')).toBeGreaterThan(0.6);
    expect(t.prior('RANDOMABC')).toBeLessThan(0.2);
    expect(t.prior('NOPE')).toBe(0.2); // nothing known -> fallback
  });
  it('rejects impossible counts', () => {
    expect(new Trie().recordCounts('A1B2', 1, 2)).toBe(false);
  });
});

describe('heaps', () => {
  it('MaxHeap pops in descending order and MinHeap in ascending order', () => {
    const r = rng(7);
    const xs = Array.from({ length: 300 }, () => Math.floor(r() * 1000));
    const mx = new MaxHeap();
    const mn = new MinHeap();
    xs.forEach((x) => {
      mx.push(x);
      mn.push(x);
    });
    const desc = [...xs].sort((a, b) => b - a);
    const asc = [...xs].sort((a, b) => a - b);
    expect(Array.from({ length: xs.length }, () => mx.pop())).toEqual(desc);
    expect(Array.from({ length: xs.length }, () => mn.pop())).toEqual(asc);
  });
  it('builds from an array in O(n) and is stable for equal keys', () => {
    const items = [{ k: 1, n: 'a' }, { k: 1, n: 'b' }, { k: 2, n: 'c' }, { k: 1, n: 'd' }];
    const h = new MaxHeap((x) => x.k, items);
    expect(h.toSortedArray().map((x) => x.n)).toEqual(['c', 'a', 'b', 'd']);
    expect(h.size).toBe(4);
    expect(new MinHeap().pop()).toBeUndefined();
  });
});

describe('Knapsack stacking (DP) vs brute force', () => {
  it('applies measured, percent and flat options correctly', () => {
    expect(applyOption(100000, { id: 'a', payableAfter: 90000 })).toBe(90000);
    expect(applyOption(100000, { id: 'b', type: 'percent', value: 1000, maxDiscount: 5000 })).toBe(95000);
    expect(applyOption(100000, { id: 'c', type: 'flat', value: 500000 })).toBe(0); // never negative
    expect(applyOption(100000, { id: 'd', type: 'flat', value: 100, minSpend: 200000 })).toBeNull();
  });

  it('picks the pair that maximizes total saving, honoring a bank-offer minimum spend', () => {
    // Coupon A saves more alone, but drops the payable below the bank offer's minimum, so coupon B + offer wins.
    const baseline = 600000; // Rs 6,000
    const layers = [
      [{ id: 'A', payableAfter: 500000 }, { id: 'B', payableAfter: 540000 }],
      [{ id: 'HDFC', type: 'percent', value: 1000, maxDiscount: 80000, minSpend: 520000 }],
    ];
    const r = bestCombination({ baseline, layers });
    // A alone: 5,000 payable (saves 1,000). B then 10% of 5,400 = 540 off: 4,860 payable (saves 1,140).
    // A + HDFC is impossible because 5,000 is below the 5,200 minimum.
    expect(r.picks.map((p) => p.id)).toEqual(['B', 'HDFC']);
    expect(r.payable).toBe(486000);
    expect(r.saving).toBe(114000);
  });

  it('never combines an exclusive option with another', () => {
    const r = bestCombination({
      baseline: 100000,
      layers: [[{ id: 'X', payableAfter: 80000, exclusive: true }], [{ id: 'Y', type: 'flat', value: 5000 }]],
    });
    expect(r.picks.map((p) => p.id)).toEqual(['X']);
  });

  it('matches exhaustive search on 400 random instances', () => {
    const r = rng(42);
    for (let t = 0; t < 400; t++) {
      const baseline = 10000 + Math.floor(r() * 2000000);
      const mk = (slot, n) =>
        Array.from({ length: n }, (_, i) => {
          const id = `${slot}${i}`;
          const kind = r();
          if (kind < 0.34) return { id, payableAfter: Math.floor(baseline * (0.5 + r() * 0.5)), exclusive: r() < 0.1 };
          if (kind < 0.67)
            return { id, type: 'percent', value: Math.floor(r() * 3000), maxDiscount: r() < 0.5 ? Math.floor(r() * 100000) : null, minSpend: r() < 0.5 ? Math.floor(r() * baseline) : null };
          return { id, type: 'flat', value: Math.floor(r() * 150000), minSpend: r() < 0.5 ? Math.floor(r() * baseline) : null };
        });
      const layers = [mk('c', 1 + Math.floor(r() * 5)), mk('p', Math.floor(r() * 4))];
      const dp = bestCombination({ baseline, layers });
      const bf = bruteForce({ baseline, layers });
      expect(dp.payable).toBe(bf.payable);
      expect(dp.payable).toBeGreaterThanOrEqual(0);
      expect(dp.picks.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('bank offer parser', () => {
  it('parses a percent offer with cap and minimum', () => {
    const o = parseOffer('10% instant discount up to ₹1,250 on HDFC Bank Credit Card. Min Order Value ₹5,000');
    expect(o).toMatchObject({ issuer: 'HDFC', cardType: 'credit', kind: 'instant', type: 'percent', value: 1000, maxDiscount: 125000, minSpend: 500000 });
  });
  it('parses a flat offer', () => {
    const o = parseOffer('Flat ₹150 off on ICICI Bank debit cards on orders above ₹1,499');
    expect(o).toMatchObject({ issuer: 'ICICI', cardType: 'debit', type: 'flat', value: 15000, minSpend: 149900 });
  });
  it('marks cashback as non-instant and ignores it in estimates', () => {
    const o = parseOffer('5% cashback up to ₹750 on Axis Bank cards');
    expect(o.kind).toBe('cashback');
    expect(estimateSaving(o, 1000000)).toBe(0);
  });
  it('estimates instant savings with cap and minimum', () => {
    const o = parseOffer('10% instant discount up to ₹300 on HDFC cards. Min order ₹2,000');
    expect(estimateSaving(o, 1000000)).toBe(30000);
    expect(estimateSaving(o, 100000)).toBe(0);
    expect(parseOffer('Free delivery on all orders')).toBeNull();
  });
});
