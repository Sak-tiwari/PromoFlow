// Heuristic detection of the promo-code box, its apply button, the order total, messages and bank offers.
// Matching is by text, ARIA and attributes, never by CSS class names, so it survives restyling.

import { findRupeeAmounts } from '../lib/money.js';

const PROMO_WORDS = /coupon|promo|voucher|discount|reduction|offer\s*code/i;
const WEAK_WORDS = /gift\s*card|\bcode\b/i;
const NEGATIVE = /search|e-?mail|phone|mobile|pin\s*code|zip|otp|password|address|first\s*name|last\s*name|\bcard\s*number\b|cvv|expiry/i;
const BAD_TYPES = new Set(['password', 'email', 'tel', 'search', 'number', 'hidden', 'checkbox', 'radio', 'file']);
const APPLY_WORDS = /apply|redeem|submit|check|add|use|ok|go/i;
const STRONG_APPLY = /apply|redeem/i;
const TOGGLE_WORDS = /(have|got|add|enter|use|apply)\s+(a\s+|your\s+)?(promo|coupon|voucher|discount|gift)/i;
const TOTAL_LABEL = /(order\s*total|grand\s*total|amount\s*payable|total\s*payable|total\s*amount|you\s*pay|to\s*pay|net\s*payable|^total\b)/i;
const NOT_TOTAL = /sub\s*-?\s*total|saving|you\s*save|discount|coupon|shipping|delivery|tax\b|gst|fee\b/i;
const OFFER_WORDS = /(bank|card|upi|wallet)\s*offer|instant\s*discount|cash\s*back|%\s*(instant\s*)?(off|discount)|flat\s*₹|₹\s*[\d,]+\s*off/i;

export function isVisible(el) {
  if (!el || !el.ownerDocument) return false;
  const win = el.ownerDocument.defaultView;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (n.hidden) return false;
    const cs = win.getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  }
  return true;
}

function labelText(input) {
  const doc = input.ownerDocument;
  const parts = [];
  if (input.id) {
    const esc = doc.defaultView?.CSS?.escape;
    const l = doc.querySelector(`label[for="${esc ? esc(input.id) : input.id.replace(/"/g, '')}"]`);
    if (l) parts.push(l.textContent);
  }
  const wrap = input.closest('label');
  if (wrap) parts.push(wrap.textContent);
  return parts.join(' ');
}

function inputSignals(input) {
  return [
    input.name, input.id, input.placeholder, input.getAttribute('aria-label'),
    input.getAttribute('data-testid'), input.title, input.getAttribute('autocomplete'), labelText(input),
  ].filter(Boolean).join(' ');
}

export function scorePromoInput(input) {
  const type = (input.getAttribute('type') || 'text').toLowerCase();
  if (BAD_TYPES.has(type)) return -10;
  const s = inputSignals(input);
  let score = 0;
  if (PROMO_WORDS.test(s)) score += 3;
  if (WEAK_WORDS.test(s)) score += 1;
  if (NEGATIVE.test(s)) score -= 5;
  return score;
}

/** Finds the best visible promo input. Returns {input, button} or null. */
export function findPromoField(doc) {
  let best = null;
  for (const input of doc.querySelectorAll('input')) {
    if (!isVisible(input)) continue;
    const score = scorePromoInput(input);
    if (score >= 3 && (!best || score > best.score)) best = { input, score };
  }
  if (!best) return null;
  return { input: best.input, button: findApplyButton(best.input) };
}

export function findApplyButton(input) {
  const sel = 'button, input[type=submit], input[type=button], [role=button]';
  let scope = input.parentElement;
  for (let depth = 0; scope && depth < 5; depth++, scope = scope.parentElement) {
    const buttons = [...scope.querySelectorAll(sel)].filter((b) => b !== input && isVisible(b));
    const text = (b) => `${b.textContent || ''} ${b.value || ''} ${b.getAttribute('aria-label') || ''}`.trim();
    const strong = buttons.find((b) => STRONG_APPLY.test(text(b)));
    if (strong) return strong;
    const weak = buttons.find((b) => APPLY_WORDS.test(text(b)) && !/remove|clear|cancel/i.test(text(b)));
    if (weak) return weak;
    if (scope.tagName === 'FORM') break;
  }
  return null;
}

/** A visible control such as "Have a promo code?" that reveals a collapsed promo box. */
export function findPromoToggle(doc) {
  const els = doc.querySelectorAll('button, a, summary, [role=button], [aria-expanded]');
  for (const el of els) {
    if (!isVisible(el)) continue;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t.length < 80 && TOGGLE_WORDS.test(t)) return el;
  }
  return null;
}

/** The final payable total in paise, as the page currently shows it. Null if it cannot be read. */
export function readTotalPaise(doc, { selectors = [] } = {}) {
  for (const sel of selectors) {
    let el = null;
    try { el = doc.querySelector(sel); } catch { /* invalid selector: ignore */ }
    if (el && isVisible(el)) {
      const amounts = findRupeeAmounts(el.textContent);
      if (amounts.length) return amounts[amounts.length - 1];
    }
  }
  let best = null;
  for (const el of doc.body.querySelectorAll('tr, li, div, p, span, dd, dl, section')) {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length > 140 || !TOTAL_LABEL.test(text)) continue;
    // "Total payable (incl. GST)" is still the total: drop notes like "(incl. GST)" before looking for non-total words.
    const core = text.replace(/\([^)]*\)/g, ' ').replace(/incl(?:uding|usive|\.)?\s*(?:of\s*)?(?:all\s*)?(?:taxes|tax|gst)?/gi, ' ');
    if (NOT_TOTAL.test(core.replace(TOTAL_LABEL, ' '))) continue;
    if (!isVisible(el)) continue;
    const amounts = findRupeeAmounts(text);
    if (!amounts.length) continue;
    // Prefer the most specific (shortest) container; later in the document wins ties.
    if (!best || text.length <= best.len) best = { len: text.length, value: amounts[amounts.length - 1] };
  }
  return best ? best.value : null;
}

/** Text of feedback shown near the promo box (alerts, live regions, nearby short text). */
export function readPromoMessage(doc, input) {
  const parts = [];
  for (const el of doc.querySelectorAll('[role=alert], [role=status], [aria-live]')) {
    if (isVisible(el) && el.textContent.trim()) parts.push(el.textContent.trim());
  }
  let scope = input ? input.parentElement : null;
  for (let d = 0; scope && d < 3; d++, scope = scope.parentElement) {
    const t = scope.textContent.replace(/\s+/g, ' ').trim();
    if (t.length < 300) { parts.push(t); break; }
  }
  return parts.join(' | ');
}

/** Short texts that look like bank/card/payment offers. */
export function readOfferTexts(doc, limit = 8) {
  const seen = new Set();
  const out = [];
  for (const el of doc.body.querySelectorAll('p, li, div, span, label')) {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t.length < 20 || t.length > 260 || !OFFER_WORDS.test(t) || seen.has(t)) continue;
    if ([...el.children].some((c) => OFFER_WORDS.test(c.textContent || ''))) continue; // take the leaf
    if (!isVisible(el)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

export function looksLikeCaptcha(doc) {
  // Only VISIBLE challenge elements count: pages often keep hidden captcha containers around.
  const sel = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, #captcha, [id*="captcha" i]';
  if ([...doc.querySelectorAll(sel)].some((el) => isVisible(el))) return true;
  let t = doc.body.innerText; // real browsers: visible text only
  if (typeof t !== 'string') { // jsdom has no innerText: walk visible text nodes instead of counting hidden text
    t = '';
    const w = doc.createTreeWalker(doc.body, 0x4);
    while (t.length < 4000 && w.nextNode()) {
      const n = w.currentNode;
      if (n.nodeValue.trim() && isVisible(n.parentElement)) t += ` ${n.nodeValue}`;
    }
  }
  t = t.slice(0, 4000);
  return /are you a robot|verify (that )?you are human|unusual traffic|enter the characters you see/i.test(t);
}

/** Finds a "remove" control for an applied code, near the promo box. */
export function findRemoveControl(doc, input) {
  const sel = 'a, button, [role=button], span[role=link]';
  let scope = input ? input.parentElement : doc.body;
  for (let d = 0; scope && d < 6; d++, scope = scope.parentElement) {
    for (const el of scope.querySelectorAll(sel)) {
      const t = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`.trim();
      if (isVisible(el) && /^(remove|clear|delete|×|✕|x)\b|\bremove\b/i.test(t) && t.length < 40) return el;
    }
  }
  return null;
}
