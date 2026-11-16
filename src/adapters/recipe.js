// Site recipes: data-only descriptions of one site's coupon flow, plus the code that reads them.
// Recipes may come from the server, so they are UNTRUSTED input: validated strictly, unknown keys dropped,
// and text matching is plain case-insensitive substring search (no regular expressions built from recipe data).

import { isVisible } from '../content/domDetector.js';

const ID_RE = /^[a-z0-9-]{2,40}$/;
const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
const TAG_RE = /^[a-z][a-z0-9-]{0,20}$/i;
const ATTR_RE = /^[a-z][a-z0-9_:.-]{0,60}$/i;
const MAX_STR = 200;
const MAX_LIST = 10;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function str(v, path, errors, { required = false } = {}) {
  if (v === undefined || v === null) { if (required) errors.push(`${path}: required`); return undefined; }
  if (typeof v !== 'string') { errors.push(`${path}: must be a string`); return undefined; }
  if (v.length === 0 || v.length > MAX_STR) { errors.push(`${path}: must be 1-${MAX_STR} characters`); return undefined; }
  return v;
}

function strList(v, path, errors, { max = MAX_LIST, item = null } = {}) {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) { errors.push(`${path}: must be an array`); return undefined; }
  if (v.length > max) { errors.push(`${path}: at most ${max} items`); return undefined; }
  const out = [];
  v.forEach((s, i) => {
    const ok = str(s, `${path}[${i}]`, errors);
    if (ok === undefined) return;
    if (item && !item.test(ok)) { errors.push(`${path}[${i}]: invalid value`); return; }
    out.push(ok);
  });
  return out;
}

/** locator = { css?, text?[], tag?[] } or, for listed codes only, { attr } | { css }. */
function locator(v, path, errors) {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) { errors.push(`${path}: must be an object`); return undefined; }
  const out = {};
  const css = str(v.css, `${path}.css`, errors);
  const text = strList(v.text, `${path}.text`, errors);
  const tag = strList(v.tag, `${path}.tag`, errors, { item: TAG_RE });
  if (css) out.css = css;
  if (text?.length) out.text = text;
  if (tag?.length) out.tag = tag;
  if (!out.css && !out.text) { errors.push(`${path}: needs css or text`); return undefined; }
  return out;
}

function codeLocator(v, path, errors) {
  if (!isObj(v)) { errors.push(`${path}: must be an object`); return undefined; }
  if (v.attr !== undefined) {
    const a = str(v.attr, `${path}.attr`, errors);
    if (a && !ATTR_RE.test(a)) { errors.push(`${path}.attr: invalid attribute name`); return undefined; }
    return a ? { attr: a } : undefined;
  }
  const css = str(v.css, `${path}.css`, errors, { required: true });
  return css ? { css } : undefined;
}

function pageDef(v, path, errors, { required }) {
  if (v === undefined || v === null) { if (required) errors.push(`${path}: required`); return undefined; }
  if (!isObj(v)) { errors.push(`${path}: must be an object`); return undefined; }
  const prefixes = strList(v.pathPrefixes, `${path}.pathPrefixes`, errors, { item: /^\// });
  if (!prefixes?.length) { errors.push(`${path}.pathPrefixes: needs at least one path starting with /`); return undefined; }
  return { pathPrefixes: prefixes };
}

function clampInt(v, lo, hi, dflt) {
  const n = Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.min(hi, Math.max(lo, n));
}

/** Returns { ok, errors, recipe }. `recipe` is a cleaned copy (unknown keys dropped) when ok, else null. */
export function validateRecipe(input) {
  const errors = [];
  if (!isObj(input)) return { ok: false, errors: ['recipe: must be an object'], recipe: null };

  const r = {};
  const id = str(input.id, 'id', errors, { required: true });
  if (id && !ID_RE.test(id)) errors.push('id: must match ^[a-z0-9-]{2,40}$'); else if (id) r.id = id;

  if (!Number.isInteger(input.version) || input.version < 1) errors.push('version: must be an integer >= 1'); else r.version = input.version;

  const hosts = strList(input.hosts, 'hosts', errors, { item: HOST_RE });
  if (!hosts?.length) errors.push('hosts: needs at least one host'); else r.hosts = hosts.map((h) => h.toLowerCase());

  if (input.verified !== undefined && typeof input.verified !== 'boolean') errors.push('verified: must be a boolean');
  r.verified = input.verified === true;

  const pages = {};
  if (!isObj(input.pages)) errors.push('pages: required');
  else {
    const bag = pageDef(input.pages.bag, 'pages.bag', errors, { required: true });
    const payment = pageDef(input.pages.payment, 'pages.payment', errors, { required: false });
    if (bag) pages.bag = bag;
    if (payment) pages.payment = payment;
  }
  r.pages = pages;

  const c = isObj(input.coupon) ? input.coupon : null;
  if (!c) errors.push('coupon: required');
  else {
    const coupon = {};
    for (const k of ['open', 'panel', 'input', 'apply', 'close', 'message', 'applied', 'remove']) {
      const l = locator(c[k], `coupon.${k}`, errors);
      if (l) coupon[k] = l;
    }
    if (c.panelClosesOnApply !== undefined && typeof c.panelClosesOnApply !== 'boolean') errors.push('coupon.panelClosesOnApply: must be a boolean');
    coupon.panelClosesOnApply = c.panelClosesOnApply === true;
    if (!coupon.open && !coupon.input) errors.push('coupon: needs open or input');

    if (c.listed !== undefined) {
      if (!isObj(c.listed)) errors.push('coupon.listed: must be an object');
      else {
        const item = locator(c.listed.item, 'coupon.listed.item', errors);
        const code = codeLocator(c.listed.code, 'coupon.listed.code', errors);
        const select = locator(c.listed.select, 'coupon.listed.select', errors);
        const inel = strList(c.listed.ineligibleText, 'coupon.listed.ineligibleText', errors);
        if (item && code) coupon.listed = { item, code, ...(select ? { select } : {}), ineligibleText: inel ?? [] };
        else if (!item || !code) errors.push('coupon.listed: needs item and code');
      }
    }
    r.coupon = coupon;
  }

  const total = locator(input.total, 'total', errors);
  if (total) r.total = total;

  if (input.offers !== undefined) {
    if (!isObj(input.offers)) errors.push('offers: must be an object');
    else {
      const container = locator(input.offers.container, 'offers.container', errors);
      if (container) r.offers = { container };
    }
  }

  const wall = locator(input.loginWall, 'loginWall', errors);
  if (wall) r.loginWall = wall;

  const lim = isObj(input.limits) ? input.limits : {};
  const onlyLocal = r.hosts?.every((h) => h === 'localhost') ?? false;
  r.limits = {
    maxAttempts: clampInt(lim.maxAttempts, 1, 6, 6),
    delayMs: clampInt(lim.delayMs, onlyLocal ? 0 : 1500, 10000, 1500),
    jitterMs: clampInt(lim.jitterMs, 0, 5000, 1000),
  };

  return errors.length ? { ok: false, errors, recipe: null } : { ok: true, errors: [], recipe: r };
}

/** Text of an element counting only text nodes that are actually visible (hidden descendants are ignored). */
function visibleText(el) {
  const doc = el.ownerDocument;
  const w = doc.createTreeWalker(el, 0x4);
  let out = '';
  while (w.nextNode()) {
    const n = w.currentNode;
    if (n.nodeValue.trim() && isVisible(n.parentElement)) out += ` ${n.nodeValue}`;
  }
  return out;
}

const MAX_TEXT_CANDIDATES = 50;

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** All visible elements under `root` that match the locator, best first. */
export function locateAll(root, loc) {
  if (!root || !loc) return [];
  const out = [];
  const seen = new Set();
  const add = (el) => { if (el && !seen.has(el) && isVisible(el)) { seen.add(el); out.push(el); } };

  if (loc.css) {
    let found = [];
    try { found = [...root.querySelectorAll(loc.css)]; } catch { found = []; } // invalid selector: ignore
    found.forEach(add);
    if (out.length) return out;
  }
  if (loc.text?.length) {
    const needles = loc.text.map(norm).filter(Boolean);
    const sel = loc.tag?.length ? loc.tag.filter((t) => TAG_RE.test(t)).join(',') : '*';
    let els = [];
    try { els = [...root.querySelectorAll(sel || '*')]; } catch { els = []; }
    const hits = [];
    for (const el of els) {
      if (/^(script|style|noscript|head|meta|link|title)$/i.test(el.tagName)) continue;
      const t = norm(el.textContent);
      if (!t || !needles.some((n) => t.includes(n))) continue;
      hits.push({ el, len: t.length, i: hits.length });
    }
    hits.sort((a, b) => a.len - b.len || a.i - b.i); // shortest matching element first
    for (const h of hits.slice(0, MAX_TEXT_CANDIDATES)) {
      const vt = norm(visibleText(h.el));
      if (needles.some((n) => vt.includes(n))) add(h.el);
    }
  }
  return out;
}

/** The best visible element for the locator, or null. */
export function locate(root, loc) {
  return locateAll(root, loc)[0] ?? null;
}
