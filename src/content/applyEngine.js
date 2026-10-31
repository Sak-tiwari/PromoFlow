// Sequential code tester. One code at a time, reading the REAL payable total after each attempt.
// Savings are only ever reported from observed totals; bank offers are advice (estimates) and are never applied.

import { bestCombination } from '../algorithms/Knapsack.js';
import { parseOffer, estimateSaving } from '../lib/offerParser.js';
import { findRemoveControl, looksLikeCaptcha, readPromoMessage } from './domDetector.js';
import { normalizeCode } from '../algorithms/Trie.js';

export const OUTCOME = Object.freeze({
  APPLIED: 'applied',
  INVALID: 'invalid',
  EXPIRED: 'expired',
  MIN_SPEND: 'min_spend_not_met',
  NOT_APPLICABLE: 'not_applicable',
  NO_EFFECT: 'no_effect',
});

const RE_EXPIRED = /expired|no longer valid|has ended/i;
const RE_MIN = /minimum|min\.?\s*(order|purchase|spend|cart|value)|at least|spend .{0,20}more|add .{0,20}more/i;
const RE_NOT_APPLICABLE = /not applicable|cannot be applied|can'?t be applied|not eligible|only valid|already applied|already used|not valid for/i;
const RE_INVALID = /invalid|incorrect|doesn'?t exist|does not exist|not found|unable to apply|couldn'?t apply|not recogni[sz]ed|wrong/i;

const RE_FINAL = new RegExp(
  [RE_EXPIRED, RE_MIN, RE_NOT_APPLICABLE, RE_INVALID, /applied|success|saved/i].map((r) => r.source).join('|'),
  'i',
);

export function classify({ before, after, message }) {
  if (after != null && before != null && after < before) return OUTCOME.APPLIED;
  const m = message || '';
  if (RE_EXPIRED.test(m)) return OUTCOME.EXPIRED;
  if (RE_MIN.test(m)) return OUTCOME.MIN_SPEND;
  if (RE_NOT_APPLICABLE.test(m)) return OUTCOME.NOT_APPLICABLE;
  if (RE_INVALID.test(m)) return OUTCOME.INVALID;
  return OUTCOME.NO_EFFECT;
}

/** Sets a value the way React/Vue-controlled inputs expect (native setter + input/change events). */
export function setNativeValue(input, value) {
  const win = input.ownerDocument.defaultView;
  const desc =
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value') ||
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value');
  input.focus?.();
  desc.set.call(input, value);
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runSearch({ doc, adapter, overrides = {}, candidates, signal, onProgress = () => {}, cfg = {} }) {
  const c = {
    maxAttempts: 10, delayMs: 500, jitterMs: 250, settleMs: 4000, pollMs: 100, stableMs: 300, minWaitMs: 700,
    sleep: defaultSleep, random: Math.random, ...cfg,
  };
  const aborted = () => !!signal?.aborted;
  const readTotal = () => adapter.readTotal(doc, overrides);

  // pred receives the elapsed milliseconds. Time is counted from the clock so tests with fake sleeps still end.
  async function waitFor(pred, timeoutMs) {
    const start = Date.now();
    for (;;) {
      const elapsed = Date.now() - start;
      if (pred(elapsed)) return true;
      if (elapsed >= timeoutMs) return false;
      await c.sleep(c.pollMs);
    }
  }

  // 1. Locate the promo box (expanding a collapsed section if needed) and read the baseline.
  let field = adapter.findField(doc, overrides);
  if (!field) {
    const toggle = adapter.findToggle(doc);
    if (toggle) {
      toggle.click();
      await c.sleep(Math.min(400, c.settleMs));
      field = adapter.findField(doc, overrides);
    }
  }
  if (!field) return { status: 'no_promo_field' };
  if (looksLikeCaptcha(doc)) return { status: 'blocked_captcha' };

  const removeApplied = async (target) => {
    const ctl = findRemoveControl(doc, field.input);
    if (!ctl) return false;
    ctl.click();
    return waitFor(() => readTotal() === target, c.settleMs);
  };

  // A code may already be applied. Remove it so the baseline is the true price without promotions.
  if (findRemoveControl(doc, field.input)) {
    const before = readTotal();
    findRemoveControl(doc, field.input).click();
    await waitFor(() => readTotal() !== before, c.settleMs);
  }

  const baseline = readTotal();
  if (baseline == null) return { status: 'no_total' };

  const list = [...new Set((candidates || []).map(normalizeCode).filter(Boolean))].slice(0, c.maxAttempts);
  if (!list.length) return { status: 'no_codes', baseline };

  const trial = async (code) => {
    const before = readTotal();
    const msgBefore = readPromoMessage(doc, field.input);
    setNativeValue(field.input, code);
    if (field.button) field.button.click();
    else field.input.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // Settle: wait for the total to change, or for a FINAL message (not a transient "Checking..."), then confirm it is stable.
    // A final message identical to the previous attempt's is accepted only after a minimum wait, so a stale error is not mistaken for this result.
    await waitFor((elapsed) => {
      if (readTotal() !== before) return true;
      const m = readPromoMessage(doc, field.input);
      if (!RE_FINAL.test(m)) return false;
      return m !== msgBefore || elapsed >= c.minWaitMs;
    }, c.settleMs);
    await c.sleep(c.stableMs);
    const after = readTotal();
    return { before, after, message: readPromoMessage(doc, field.input) };
  };

  // 2. Try each code, one at a time, restoring the cart after every success.
  const results = [];
  let stopped = null;
  for (let i = 0; i < list.length; i++) {
    if (aborted()) { stopped = 'aborted'; break; }
    if (looksLikeCaptcha(doc)) { stopped = 'blocked_captcha'; break; }
    const code = list[i];
    onProgress({ phase: 'trying', n: i + 1, total: list.length, code });
    const r = await trial(code);
    const outcome = classify(r);
    const entry = { code, outcome, payable: outcome === OUTCOME.APPLIED ? r.after : null, saving: outcome === OUTCOME.APPLIED ? baseline - r.after : 0 };
    results.push(entry);
    onProgress({ phase: 'result', ...entry });
    if (outcome === OUTCOME.APPLIED) {
      const restored = await removeApplied(baseline);
      if (!restored) { stopped = 'could_not_restore'; break; }
    }
    if (i < list.length - 1) await c.sleep(c.delayMs + Math.floor(c.random() * c.jitterMs));
  }

  // 3. Choose the best coupon + bank-offer pair (DP). Coupons are MEASURED, offers are ESTIMATED from text.
  const applied = results.filter((r) => r.outcome === OUTCOME.APPLIED);
  const offers = adapter.readOffers(doc).map(parseOffer).filter((o) => o && o.kind === 'instant');
  const couponOpts = applied.map((r) => ({ id: r.code, payableAfter: r.payable }));
  const offerOpts = offers.map((o, i) => ({ id: `offer:${i}`, ...o }));
  const combo = bestCombination({ baseline, layers: [couponOpts, offerOpts] });
  const couponPick = combo.picks.find((p) => !String(p.id).startsWith('offer:')) ?? null;
  const offerPick = combo.picks.find((p) => String(p.id).startsWith('offer:')) ?? null;

  // 4. Leave the best coupon applied and verify the page shows the measured total.
  let finalApplied = false;
  let finalPayable = readTotal();
  if (couponPick && !aborted() && stopped !== 'could_not_restore') {
    const before = readTotal();
    setNativeValue(field.input, couponPick.id);
    if (field.button) field.button.click();
    await waitFor(() => readTotal() !== before, c.settleMs);
    await c.sleep(c.stableMs);
    finalPayable = readTotal();
    finalApplied = finalPayable === couponPick.payableAfter;
  }

  const basePayable = finalApplied ? finalPayable : baseline;
  const offerSaving = offerPick ? estimateSaving(offerPick, basePayable) : 0;
  const summary = {
    status: 'ok',
    stopped,
    baseline,
    results,
    coupon: couponPick ? { code: couponPick.id, payable: couponPick.payableAfter, saving: baseline - couponPick.payableAfter } : null,
    offer: offerPick && offerSaving > 0 ? { text: offerPick.raw, issuer: offerPick.issuer, estimatedSaving: offerSaving } : null,
    estimatedPayable: basePayable - offerSaving,
    finalPayable,
    finalApplied,
  };
  onProgress({ phase: 'done', summary });
  return summary;
}
