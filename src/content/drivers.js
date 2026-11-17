// Drivers hide HOW a page's coupon flow works behind one interface, so the engine has a single trial loop.
//
//   kind              'generic' | 'recipe'
//   limits            { maxAttempts, delayMs, jitterMs } or null (engine defaults apply)
//   panelClosesOnApply
//   ensureOpen()      async -> true when the coupon input or the coupon list is reachable (opens the panel if needed)
//   panelOpen()       -> true / false / null (unknown)
//   listCodes()       -> [{ code, eligible }] taken from the site's own list ([] when there is none)
//   apply(code)       async: type or select the code, then submit
//   readTotal()       -> payable paise or null;   readMessage() -> string
//   isApplied()       -> bool;  appliedText() -> text of the applied indicator;  remove() async -> bool
//   readOffers()      -> bank/payment offer texts visible on this page
//   loginRequired(), captcha() -> bool

import { findRemoveControl, looksLikeCaptcha, readPromoMessage, readTotalPaise, readOfferTexts } from './domDetector.js';
import { locate, locateAll } from '../adapters/recipe.js';
import { findRupeeAmounts } from '../lib/money.js';
import { normalizeCode } from '../algorithms/Trie.js';
import { setNativeValue } from './setValue.js';

const CODE_RE = /^[A-Z0-9_-]{3,32}$/;
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pressEnter(input) {
  input.dispatchEvent(new input.ownerDocument.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

/** The v1 behaviour: find a promo box by heuristics (or an adapter's hints), expanding a collapsed section if needed. */
export function genericDriver(doc, adapter, overrides = {}, { sleep = defaultSleep, settleMs = 4000 } = {}) {
  let field = null;
  const stillThere = () => field && field.input.isConnected && field.input.ownerDocument === doc;
  return {
    kind: 'generic',
    limits: null,
    panelClosesOnApply: false,
    async ensureOpen() {
      if (stillThere()) return true;
      field = adapter.findField(doc, overrides);
      if (!field) {
        const toggle = adapter.findToggle(doc);
        if (toggle) {
          toggle.click();
          await sleep(Math.min(400, settleMs));
          field = adapter.findField(doc, overrides);
        }
      }
      return !!field;
    },
    panelOpen: () => null,
    listCodes: () => [],
    async apply(code) {
      setNativeValue(field.input, code);
      if (field.button) field.button.click(); else pressEnter(field.input);
    },
    readTotal: () => adapter.readTotal(doc, overrides),
    readOffers: () => adapter.readOffers(doc),
    readMessage: () => readPromoMessage(doc, field?.input),
    isApplied: () => !!(field && findRemoveControl(doc, field.input)),
    appliedText() {
      const ctl = field && findRemoveControl(doc, field.input);
      return ctl?.parentElement?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    },
    async remove() {
      const ctl = field && findRemoveControl(doc, field.input);
      if (!ctl) return false;
      ctl.click();
      return true;
    },
    loginRequired: () => false,
    captcha: () => looksLikeCaptcha(doc),
  };
}

/** A site-specific flow described by a validated recipe (see src/adapters/recipe.js). */
export function recipeDriver(doc, recipe, { sleep = defaultSleep, pollMs = 100, openWaitMs = 3000 } = {}) {
  const c = recipe.coupon;
  const reachable = () => !!(locate(doc, c.input) || (c.listed && locate(doc, c.listed.item)));
  const items = () => (c.listed ? locateAll(doc, c.listed.item) : []);

  function itemCode(item) {
    const spec = c.listed.code;
    const raw = spec.attr ? item.getAttribute(spec.attr) : item.querySelector(spec.css)?.textContent;
    const code = normalizeCode(raw);
    return CODE_RE.test(code) ? code : null;
  }

  return {
    kind: 'recipe',
    limits: recipe.limits,
    panelClosesOnApply: !!c.panelClosesOnApply,
    async ensureOpen() {
      if (reachable()) return true;
      const opener = locate(doc, c.open);
      if (!opener) return false;
      opener.click();
      const start = Date.now();
      while (!reachable() && Date.now() - start < openWaitMs) await sleep(pollMs);
      return reachable();
    },
    panelOpen: () => (c.panel ? !!locate(doc, c.panel) : null),
    listCodes() {
      if (!c.listed) return [];
      const seen = new Set();
      const out = [];
      for (const item of items()) {
        const code = itemCode(item);
        if (!code || seen.has(code)) continue;
        seen.add(code);
        const text = norm(item.textContent);
        out.push({ code, eligible: !c.listed.ineligibleText.some((t) => text.includes(norm(t))) });
      }
      return out;
    },
    async apply(code) {
      const item = c.listed ? items().find((i) => itemCode(i) === code) : null;
      const pick = item && c.listed.select ? locate(item, c.listed.select) : null;
      const input = locate(doc, c.input);
      if (pick && !pick.disabled) pick.click();
      else if (input) setNativeValue(input, code);
      const button = locate(doc, c.apply);
      if (button) button.click();
      else if (input) pressEnter(input);
    },
    readTotal() {
      const el = locate(doc, recipe.total);
      if (el) {
        const amounts = findRupeeAmounts(el.textContent);
        if (amounts.length) return amounts[amounts.length - 1];
      }
      return readTotalPaise(doc);
    },
    readMessage: () => (c.message ? locateAll(doc, c.message).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ') : ''),
    isApplied: () => !!locate(doc, c.applied || c.remove),
    appliedText() {
      const el = locate(doc, c.applied) || locate(doc, c.remove)?.parentElement;
      return el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    },
    async remove() {
      const ctl = locate(doc, c.remove);
      if (!ctl) return false;
      ctl.click();
      return true;
    },
    // With a recipe, offers are read ONLY from the recipe's offers container (coupon list entries look like offers otherwise).
    readOffers() {
      if (!recipe.offers?.container) return [];
      const box = locate(doc, recipe.offers.container);
      if (!box) return [];
      if (recipe.offers.item) { // the site splits one offer over several elements: read each offer as a whole, once
        const seen = new Set();
        const out = [];
        for (const el of locateAll(box, recipe.offers.item)) {
          // Join the text pieces with spaces: "Discount" + "On YES Card" must not become "DiscountOn".
          const parts = [];
          const w = doc.createTreeWalker(el, 0x4);
          while (w.nextNode()) if (w.currentNode.nodeValue.trim()) parts.push(w.currentNode.nodeValue.trim());
          const t = parts.join(' ').replace(/\s+/g, ' ').trim();
          if (t && !seen.has(t)) { seen.add(t); out.push(t); }
          if (out.length >= 20) break;
        }
        return out;
      }
      return readOfferTexts(box);
    },
    loginRequired: () => !!(recipe.loginWall && locate(doc, recipe.loginWall)),
    captcha: () => looksLikeCaptcha(doc),
  };
}
