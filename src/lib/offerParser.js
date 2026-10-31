// Turns bank/payment offer text shown on a checkout page into a structured offer.
// This is a heuristic parser: results are ESTIMATES. The extension never applies bank offers itself.

import { percentOf } from './money.js';

const BANKS = [
  'HDFC', 'ICICI', 'SBI', 'Axis', 'Kotak', 'Yes Bank', 'IDFC', 'Federal', 'AU Small', 'RBL', 'IndusInd',
  'Bank of Baroda', 'BOB', 'American Express', 'Amex', 'Citi', 'HSBC', 'Standard Chartered', 'OneCard',
  'Paytm', 'Amazon Pay', 'PhonePe', 'Google Pay', 'BHIM',
];

const RS = '(?:₹|rs\\.?|inr)\\s*';
const NUM = '(\\d[\\d,]*)';

const toPaise = (s) => Number(String(s).replace(/,/g, '')) * 100;

export function parseOffer(rawText) {
  const t = String(rawText ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;

  const issuer =
    BANKS.find((b) => new RegExp(`\\b${b.replace(/ /g, '\\s+')}\\b`, 'i').test(t)) ?? null;
  const cardType = /credit/i.test(t) ? 'credit' : /debit/i.test(t) ? 'debit' : null;
  const cashback = /cash\s*back|reward points?|super\s*coins?|\bcoins?\b/i.test(t) && !/instant/i.test(t);

  const pct = t.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  const upTo = t.match(new RegExp(`up\\s*to\\s*${RS}${NUM}`, 'i'));
  const flat = t.match(new RegExp(`${RS}${NUM}\\s*(?:instant\\s*)?(?:off|discount)`, 'i'));
  const min = t.match(
    new RegExp(
      `(?:min(?:imum)?\\.?\\s*(?:purchase|order|spend|transaction|cart)?\\s*(?:value|amount)?\\s*(?:of)?|(?:orders?|purchases?|shopping)\\s*(?:of|above|over|worth)|above|over)\\s*:?\\s*${RS}${NUM}`,
      'i',
    ),
  );

  let type = null;
  let value = null;
  let maxDiscount = null;
  if (pct) {
    type = 'percent';
    value = Math.round(Number(pct[1]) * 100);
    if (upTo) maxDiscount = toPaise(upTo[1]);
    else if (flat) maxDiscount = toPaise(flat[1]);
  } else if (flat) {
    type = 'flat';
    value = toPaise(flat[1]);
  }
  if (!type) return null;

  return {
    raw: t,
    issuer,
    cardType,
    kind: cashback ? 'cashback' : 'instant',
    type,
    value,
    maxDiscount,
    minSpend: min ? toPaise(min[1]) : null,
  };
}

/** Estimated saving of an instant offer on a payable amount. 0 if not applicable or not instant. */
export function estimateSaving(offer, payable) {
  if (!offer || offer.kind !== 'instant') return 0;
  if (offer.minSpend != null && payable < offer.minSpend) return 0;
  let d = offer.type === 'percent' ? percentOf(payable, offer.value) : offer.value;
  if (offer.type === 'percent' && offer.maxDiscount != null) d = Math.min(d, offer.maxDiscount);
  return Math.max(0, Math.min(d, payable));
}
