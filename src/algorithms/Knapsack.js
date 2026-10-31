// Stacking as a grouped (multiple-choice) knapsack solved by dynamic programming.
//
// Policy: at most one option per slot (slot 1 = coupon, slot 2 = payment/bank offer), at most 2 in total.
// Each slot is a group; from every group we pick one option or none. State = the payable amount in paise
// after the groups processed so far. Equal payables are merged, so the state count never exceeds the number
// of distinct reachable payables, and the work is O(sum over layers of states x options).
//
// An option is one of:
//   { id, payableAfter }                       // MEASURED: the page showed this payable after applying it
//   { id, type:'percent', value:bp, maxDiscount?, minSpend? }   // ESTIMATED from rule text
//   { id, type:'flat',    value:paise, minSpend? }
// `exclusive: true` means it cannot be combined with any other option.

import { percentOf } from '../lib/money.js';

/** Payable after applying an option to `payable`. Returns null if the option is not applicable. */
export function applyOption(payable, opt) {
  if (Number.isInteger(opt.payableAfter)) {
    return opt.payableAfter <= payable ? opt.payableAfter : null;
  }
  if (opt.minSpend != null && payable < opt.minSpend) return null;
  let discount;
  if (opt.type === 'percent') {
    discount = percentOf(payable, opt.value);
    if (opt.maxDiscount != null) discount = Math.min(discount, opt.maxDiscount);
  } else if (opt.type === 'flat') {
    discount = opt.value;
  } else {
    return null;
  }
  discount = Math.max(0, Math.min(discount, payable));
  return payable - discount;
}

/**
 * @param {object} p
 * @param {number} p.baseline   payable with no promotion, in paise
 * @param {Array<Array<object>>} p.layers  one array of options per slot, in application order
 * @returns {{payable:number, saving:number, picks:object[]}}
 */
export function bestCombination({ baseline, layers }) {
  let states = new Map([[baseline, []]]);
  for (const options of layers) {
    const next = new Map();
    for (const [payable, picks] of states) {
      // Choosing nothing from this slot keeps the state.
      if (!next.has(payable) || next.get(payable).length > picks.length) next.set(payable, picks);
      for (const opt of options) {
        if (opt.exclusive && picks.length > 0) continue;
        if (picks.some((x) => x.exclusive)) continue;
        const after = applyOption(payable, opt);
        if (after == null || after === payable) continue;
        const cand = [...picks, opt];
        const cur = next.get(after);
        if (!cur || cand.length < cur.length || (cand.length === cur.length && cand.map((x) => x.id).join() < cur.map((x) => x.id).join())) {
          next.set(after, cand);
        }
      }
    }
    states = next;
  }
  let bestPayable = baseline;
  let bestPicks = [];
  for (const [payable, picks] of states) {
    if (payable < bestPayable || (payable === bestPayable && picks.length < bestPicks.length)) {
      bestPayable = payable;
      bestPicks = picks;
    }
  }
  return { payable: bestPayable, saving: baseline - bestPayable, picks: bestPicks };
}

/** Exhaustive reference used by tests to prove the DP returns the optimum. */
export function bruteForce({ baseline, layers }) {
  let best = { payable: baseline, saving: 0, picks: [] };
  const rec = (i, payable, picks) => {
    if (i === layers.length) {
      if (payable < best.payable || (payable === best.payable && picks.length < best.picks.length)) {
        best = { payable, saving: baseline - payable, picks };
      }
      return;
    }
    rec(i + 1, payable, picks);
    for (const opt of layers[i]) {
      if (opt.exclusive && picks.length > 0) continue;
      if (picks.some((x) => x.exclusive)) continue;
      const after = applyOption(payable, opt);
      if (after == null || after === payable) continue;
      rec(i + 1, after, [...picks, opt]);
    }
  };
  rec(0, baseline, []);
  return best;
}
