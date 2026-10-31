// Site adapters. An adapter only holds site-specific hints; the generic detector does the real work and is the fallback.
// Hints marked `unverified` were NOT tested against the live site. Use the selector recorder (popup) to correct them.

import {
  findPromoField, findApplyButton, findPromoToggle, readTotalPaise, readOfferTexts, isVisible,
} from '../content/domDetector.js';

function firstVisible(doc, selectors) {
  for (const s of selectors) {
    if (!s) continue;
    try {
      const el = doc.querySelector(s);
      if (el && isVisible(el)) return el;
    } catch { /* invalid selector */ }
  }
  return null;
}

function makeAdapter({ id, hostRe, checkoutRe = null, totalSelectors = [], inputSelectors = [], buttonSelectors = [], unverified = false }) {
  return {
    id,
    unverified,
    matches: (host) => hostRe.test(host),
    /** True when the URL looks like a cart/checkout/payment step. The generic adapter always says yes (the user clicked). */
    isCheckout: (loc) => (checkoutRe ? checkoutRe.test(`${loc.pathname}${loc.search}`) : true),
    findField(doc, overrides = {}) {
      const input = firstVisible(doc, [overrides.input, ...inputSelectors]);
      if (!input) return findPromoField(doc);
      const button = firstVisible(doc, [overrides.button, ...buttonSelectors]) ?? findApplyButton(input);
      return { input, button };
    },
    readTotal: (doc, overrides = {}) => readTotalPaise(doc, { selectors: [overrides.total, ...totalSelectors].filter(Boolean) }),
    readOffers: (doc) => readOfferTexts(doc),
    findToggle: (doc) => findPromoToggle(doc),
  };
}

export const generic = makeAdapter({ id: 'generic', hostRe: /./ });

// Amazon: clip coupons apply on their own once clipped; promo/gift codes go in a box on the payment step.
// The two input selectors below are recalled from memory and unverified; the generic detector is the fallback.
export const amazon = makeAdapter({
  id: 'amazon',
  hostRe: /(^|\.)amazon\.(in|com)$/i,
  checkoutRe: /\/(gp\/buy|checkout|gp\/cart|cart)/i,
  inputSelectors: ['input[name="ppw-claimCode"]'],
  buttonSelectors: ['input[name="ppw-claimCodeApplyPressed"]'],
  unverified: true,
});

// Flipkart: savings are mostly the sale price and one bank offer; coupon boxes appear only for some campaigns.
export const flipkart = makeAdapter({
  id: 'flipkart',
  hostRe: /(^|\.)flipkart\.com$/i,
  checkoutRe: /(checkout|viewcart|payments)/i,
  unverified: true,
});

const ADAPTERS = [amazon, flipkart];

export function pickAdapter(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  return ADAPTERS.find((a) => a.matches(host)) ?? generic;
}

export function normalizeHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}
