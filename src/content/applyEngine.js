// Sequential code tester. One code at a time, reading the REAL payable total after each attempt.
// Savings are only ever reported from observed totals; bank offers are advice (estimates) and are never applied.

import { bestCombination } from '../algorithms/Knapsack.js';
import { parseOffer, estimateSaving } from '../lib/offerParser.js';
import { genericDriver, recipeDriver } from './drivers.js';
import { mergeCandidates } from '../background/candidates.js';
import { pageKind } from '../adapters/recipe.js';
import { setNativeValue } from './setValue.js';

export { setNativeValue };

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

const RE_RATE_LIMITED = /too many|try again later/i;
const RE_FINAL = new RegExp(
  [RE_EXPIRED, RE_MIN, RE_NOT_APPLICABLE, RE_INVALID, RE_RATE_LIMITED, /applied|success|saved/i].map((r) => r.source).join('|'),
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

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RATE_LIMITED = RE_RATE_LIMITED;
// After one of these we stop touching the page at all (no final re-apply click).
const HANDS_OFF = new Set(['blocked_captcha', 'rate_limited', 'login_required']);

/**
 * Finds the best coupon (measured) and bank offer (estimated) for the cart on this page.
 *   candidates: strings or [{ code, origin }]
 *   recipe:     optional validated recipe; used when its "bag" page matches the current path, else the generic detector runs
 * Precedence for pacing: explicit cfg > the recipe's limits > engine defaults.
 */
export async function runSearch({ doc, adapter, overrides = {}, recipe = null, candidates, signal, onProgress = () => {}, cfg = {} }) {
  const base = {
    maxAttempts: 10, delayMs: 500, jitterMs: 250, settleMs: 4000, pollMs: 100, stableMs: 300, minWaitMs: 700,
    sleep: defaultSleep, random: Math.random, ...cfg,
  };
  const useRecipe = !!recipe && pageKind(recipe, doc.location?.pathname) === 'bag';
  const driver = useRecipe
    ? recipeDriver(doc, recipe, { sleep: base.sleep, pollMs: base.pollMs })
    : genericDriver(doc, adapter, overrides, { sleep: base.sleep, settleMs: base.settleMs });
  const c = { ...base };
  for (const k of ['maxAttempts', 'delayMs', 'jitterMs']) {
    if (cfg[k] === undefined && driver.limits?.[k] !== undefined) c[k] = driver.limits[k];
  }
  const aborted = () => !!signal?.aborted;
  const readTotal = () => driver.readTotal();

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

  // 1. Pre-flight: login wall, captcha, and the coupon box itself (opened if it sits behind a click).
  if (driver.loginRequired()) return { status: 'login_required' };
  if (driver.captcha()) return { status: 'blocked_captcha' };
  if (!(await driver.ensureOpen())) return { status: 'no_promo_field' };
  if (driver.loginRequired()) return { status: 'login_required' };
  if (readTotal() == null) return { status: 'no_total' };

  const known = (candidates || []).map((x) => (typeof x === 'string' ? { code: x, origin: 'known' } : x));

  // 2. A coupon may already be applied. Find out which one (only by matching KNOWN codes against the page text),
  //    then remove it so the baseline is the true price without promotions.
  let preApplied = null;
  if (driver.isApplied()) {
    const text = driver.appliedText().toUpperCase();
    const pool = [...known.map((k) => String(k.code).trim().toUpperCase()), ...driver.listCodes().map((l) => l.code)];
    const code = pool.filter((k) => k && text.includes(k)).sort((a, b) => b.length - a.length)[0] ?? null;
    preApplied = { code };
  }

  const first = mergeCandidates({ known, listed: driver.listCodes() }, c.maxAttempts);
  if (!first.list.length && !preApplied?.code) return { status: 'no_codes', baseline: readTotal(), skipped: first.skipped };

  if (preApplied) {
    const before = readTotal();
    await driver.remove();
    await waitFor(() => readTotal() !== before, c.settleMs);
    await driver.ensureOpen();
  }

  const baseline = readTotal();
  if (baseline == null) return { status: 'no_total' };

  // Fresh listing after the removal; a coupon that was applied before is measured like any other code.
  const merged = mergeCandidates({ known, listed: driver.listCodes() }, c.maxAttempts);
  let list = merged.list;
  if (preApplied?.code && !list.some((x) => x.code === preApplied.code)) {
    list = [{ code: preApplied.code, origin: 'preapplied' }, ...list].slice(0, c.maxAttempts);
  }
  if (!list.length) return { status: 'no_codes', baseline, skipped: merged.skipped };

  const trial = async (code) => {
    const before = readTotal();
    const msgBefore = driver.readMessage();
    const panelWasOpen = driver.panelOpen();
    let lastMsg = '';
    await driver.apply(code);
    // Settle: the total changed, the panel closed itself, or a FINAL message (not a transient "Checking...") appeared.
    // A final message identical to the previous attempt's is accepted only after a minimum wait, so a stale error is not mistaken for this result.
    await waitFor((elapsed) => {
      if (readTotal() !== before) return true;
      if (driver.panelClosesOnApply && panelWasOpen && driver.panelOpen() === false) return true;
      const m = driver.readMessage();
      if (m) lastMsg = m;
      if (!RE_FINAL.test(m)) return false;
      return m !== msgBefore || elapsed >= c.minWaitMs;
    }, c.settleMs);
    await c.sleep(c.stableMs);
    return { before, after: readTotal(), message: driver.readMessage() || lastMsg };
  };

  // 3. Try each code, one at a time, restoring the cart after every success.
  const results = [];
  let stopped = null;
  for (let i = 0; i < list.length; i++) {
    if (aborted()) { stopped = 'aborted'; break; }
    if (driver.captcha()) { stopped = 'blocked_captcha'; break; }
    if (driver.loginRequired()) { stopped = 'login_required'; break; }
    const { code, origin } = list[i];
    onProgress({ phase: 'trying', n: i + 1, total: list.length, code });
    if (!(await driver.ensureOpen())) { stopped = 'panel_unavailable'; break; } // the panel may have closed after the last attempt
    const r = await trial(code);
    const outcome = classify(r);
    if (outcome !== OUTCOME.APPLIED && RATE_LIMITED.test(r.message || '')) { stopped = 'rate_limited'; break; }
    const entry = { code, origin, outcome, payable: outcome === OUTCOME.APPLIED ? r.after : null, saving: outcome === OUTCOME.APPLIED ? baseline - r.after : 0 };
    results.push(entry);
    onProgress({ phase: 'result', ...entry });
    if (outcome === OUTCOME.APPLIED) {
      if (driver.panelClosesOnApply && driver.panelOpen()) await waitFor(() => driver.panelOpen() === false, Math.min(c.settleMs, 2000));
      const removed = await driver.remove();
      const restored = removed && (await waitFor(() => readTotal() === baseline, c.settleMs));
      if (!restored) { stopped = 'could_not_restore'; break; }
    }
    if (i < list.length - 1) await c.sleep(c.delayMs + Math.floor(c.random() * c.jitterMs));
  }

  // 4. Choose the best coupon + bank-offer pair (DP). Coupons are MEASURED, offers are ESTIMATED from text.
  const applied = results.filter((r) => r.outcome === OUTCOME.APPLIED);
  const offers = driver.readOffers().map(parseOffer).filter((o) => o && o.kind === 'instant');
  const couponOpts = applied.map((r) => ({ id: r.code, payableAfter: r.payable }));
  const offerOpts = offers.map((o, i) => ({ id: `offer:${i}`, ...o }));
  const combo = bestCombination({ baseline, layers: [couponOpts, offerOpts] });
  const couponPick = combo.picks.find((p) => !String(p.id).startsWith('offer:')) ?? null;
  const offerPick = combo.picks.find((p) => String(p.id).startsWith('offer:')) ?? null;

  // 5. Leave the best coupon applied and verify the page shows the measured total.
  //    After a captcha, login wall or rate limit we stop touching the page altogether.
  let finalApplied = false;
  let finalPayable = readTotal();
  if (couponPick && !aborted() && stopped !== 'could_not_restore' && !HANDS_OFF.has(stopped) && (await driver.ensureOpen())) {
    const before = readTotal();
    await driver.apply(couponPick.id);
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
    skipped: merged.skipped,
    coupon: couponPick
      ? { code: couponPick.id, payable: couponPick.payableAfter, saving: baseline - couponPick.payableAfter, origin: results.find((r) => r.code === couponPick.id)?.origin }
      : null,
    offer: offerPick && offerSaving > 0 ? { text: offerPick.raw, issuer: offerPick.issuer, estimatedSaving: offerSaving } : null,
    estimatedPayable: basePayable - offerSaving,
    finalPayable,
    finalApplied,
    preAppliedLost: !!preApplied && !finalApplied,
  };
  onProgress({ phase: 'done', summary });
  return summary;
}
