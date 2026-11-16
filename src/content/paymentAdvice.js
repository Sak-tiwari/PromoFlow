// Payment-page advice. READ-ONLY: this module never clicks, types, focuses or reads the value of any input.
// It reads the payable total and the offer texts shown on the page, and returns the best bank/payment offer as an ESTIMATE.

import { bestCombination } from '../algorithms/Knapsack.js';
import { parseOffer, estimateSaving } from '../lib/offerParser.js';
import { readTotalPaise, readOfferTexts } from './domDetector.js';
import { locate } from '../adapters/recipe.js';
import { findRupeeAmounts } from '../lib/money.js';
import { freshLast } from '../lib/lastResult.js';

function pageTotal(doc, recipe) {
  const el = recipe?.total ? locate(doc, recipe.total) : null;
  if (el) {
    const amounts = findRupeeAmounts(el.textContent);
    if (amounts.length) return amounts[amounts.length - 1];
  }
  return readTotalPaise(doc);
}

function pageOffers(doc, recipe) {
  if (recipe?.offers?.container) {
    const box = locate(doc, recipe.offers.container);
    return box ? readOfferTexts(box) : [];
  }
  return readOfferTexts(doc);
}

/**
 * @param last the entry saved after the coupon search on the bag page (or null); used only if fresh
 * Returns { status: 'no_total' } or
 *   { status: 'ok', total, coupon: {code, saving}|null, pageDiffers, offer: {text, issuer, estimatedSaving}|null, estimatedPayable }
 * The page is the truth: the coupon saving is computed from the total the page shows now, not from what was stored.
 */
export function adviseOnPayment({ doc, recipe = null, last = null, now = Date.now() }) {
  const total = pageTotal(doc, recipe);
  if (total == null) return { status: 'no_total' };

  const host = String(doc.location?.hostname || '').toLowerCase();
  const stored = freshLast(last, host, now);
  // The stored baseline is the cart price without the coupon. It counts only if this page shows a lower total.
  const couponShown = !!stored && stored.baseline > total;
  const baseline = couponShown ? stored.baseline : total;

  const offerOpts = pageOffers(doc, recipe)
    .map(parseOffer)
    .filter((o) => o && o.kind === 'instant') // cashback is paid later: not estimated
    .map((o, i) => ({ id: `offer:${i}`, ...o }));
  const couponOpts = couponShown ? [{ id: stored.code, payableAfter: total }] : [];

  const combo = bestCombination({ baseline, layers: [couponOpts, offerOpts] });
  const offerPick = combo.picks.find((p) => String(p.id).startsWith('offer:')) ?? null;
  const saving = offerPick ? estimateSaving(offerPick, total) : 0;

  return {
    status: 'ok',
    total,
    coupon: couponShown ? { code: stored.code, saving: baseline - total } : null,
    pageDiffers: couponShown && stored.payable !== total,
    offer: offerPick && saving > 0 ? { text: offerPick.raw, issuer: offerPick.issuer, estimatedSaving: saving } : null,
    estimatedPayable: total - (offerPick && saving > 0 ? saving : 0),
  };
}
