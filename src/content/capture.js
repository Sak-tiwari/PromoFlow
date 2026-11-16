// "Diagnose this page": builds a sanitized snapshot of the coupon / total / offer areas of the current page.
// The snapshot is copied or downloaded by the user. It is never sent anywhere by the extension.
//
// Privacy approach: start from small subtrees around coupon-related elements, clone them, then strip
// everything that could identify the person (values, emails, phones, PIN codes, address blocks, images, scripts).

export const MAX_BYTES = 200 * 1024;
export const STATES = ['bag', 'coupon_panel_open', 'coupon_applied', 'coupon_error', 'payment'];

const ANCHOR = /coupon|promo|voucher|offer|apply|remove|total|payable|amount|bank|login|sign\s*in/i;
const SENSITIVE = /address|pin\s*code|pincode|deliver(?:y|ing)?\s+to|profile|account\s*name|saved\s*card|upi\s*id/i;
const DROP_TAGS = 'script, style, svg, img, picture, video, iframe, noscript, link, meta, input[type=hidden]';
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG', 'IMG', 'PICTURE', 'VIDEO', 'IFRAME', 'NOSCRIPT', 'LINK', 'META', 'HTML', 'BODY', 'HEAD']);
const KEEP_ATTRS = new Set(['id', 'class', 'name', 'type', 'role', 'placeholder', 'for', 'href', 'disabled', 'checked']);
const ATTR_FOR_ANCHOR = ['id', 'class', 'name', 'placeholder', 'aria-label', 'role', 'title'];

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /(?<![\d₹])\+?\d(?:[\s-]?\d){9,}(?!\d)/g;
const PIN = /(?<![\d₹.,])\b\d{6}\b(?![.,]\d)/g;

export function redact(text) {
  return String(text).replace(EMAIL, '[removed]').replace(PHONE, '[removed]').replace(PIN, '[removed]');
}

const bytes = (s) => new TextEncoder().encode(s).length;

function ownText(el) {
  let t = '';
  for (const n of el.childNodes) if (n.nodeType === 3) t += ` ${n.nodeValue}`;
  return t.replace(/\s+/g, ' ').trim();
}

function attrBlob(el) {
  const parts = ATTR_FOR_ANCHOR.map((a) => el.getAttribute(a) || '');
  for (const a of el.attributes) if (a.name.startsWith('data-') && a.value.length < 60) parts.push(a.name, a.value);
  return parts.join(' ');
}

function isAnchor(el) {
  if (SKIP_TAGS.has(el.tagName.toUpperCase())) return false;
  if (el.closest('[data-promoflow]')) return false;
  const own = ownText(el);
  if (own.length > 0 && own.length <= 80 && ANCHOR.test(own)) return true;
  return ANCHOR.test(attrBlob(el));
}

function depthOf(el) {
  let d = 0;
  for (let n = el; n.parentElement; n = n.parentElement) d++;
  return d;
}

function climb(doc, el, levels) {
  let n = el;
  for (let i = 0; i < levels; i++) {
    const p = n.parentElement;
    if (!p || p === doc.body || p === doc.documentElement) break;
    n = p;
  }
  return n;
}

/** Keeps outermost roots only (drops any root that sits inside another) in document order. */
function mergeRoots(roots) {
  const uniq = [...new Set(roots)];
  const kept = uniq.filter((r) => !uniq.some((o) => o !== r && o.contains(r)));
  kept.sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1)); // 4 = b follows a
  return kept;
}

function pathOnly(href) {
  try {
    const u = new URL(href, 'https://x.invalid/');
    if (!/^https?:$/.test(u.protocol)) return '';
    return u.pathname;
  } catch { return ''; }
}

/** Cleans a detached clone in place. Returns its sanitized HTML. */
function sanitize(doc, root) {
  const box = doc.createElement('div');
  box.appendChild(root.cloneNode(true));

  box.querySelectorAll(DROP_TAGS).forEach((n) => n.remove());
  box.querySelectorAll('textarea').forEach((n) => { n.textContent = ''; });

  // Remove personal blocks (addresses, profile, saved cards...). Deepest elements first, so a coupon section
  // that merely sits next to an address block is never removed with it.
  const hits = [...box.querySelectorAll('*')].reverse();
  for (const el of hits) {
    if (!box.contains(el)) continue;
    if (SENSITIVE.test(attrBlob(el))) { el.remove(); continue; }
    const own = ownText(el);
    if (own.length === 0 || own.length > 120 || !SENSITIVE.test(own)) continue;
    // A label such as "Deliver to": remove its small enclosing block (the address under it), unless that block holds coupon/total content.
    const p = el.parentElement;
    const target = p && p !== box && (p.textContent || '').length <= 300 && !ANCHOR.test(p.textContent || '') ? p : el;
    target.remove();
  }

  for (const el of box.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      const name = a.name.toLowerCase();
      const keep = KEEP_ATTRS.has(name) || name.startsWith('aria-') || (name.startsWith('data-') && a.value.length < 60);
      if (!keep) { el.removeAttribute(a.name); continue; }
      if (name === 'href') {
        const p = pathOnly(a.value);
        if (p) el.setAttribute('href', p); else el.removeAttribute('href');
      } else {
        el.setAttribute(a.name, redact(a.value));
      }
    }
  }

  const walker = doc.createTreeWalker(box, 0x4 | 0x80); // text + comment nodes
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    if (n.nodeType === 8) { n.remove(); continue; }
    let v = redact(n.nodeValue);
    if (v.length > 120) v = `${v.slice(0, 120)}…`;
    n.nodeValue = v;
  }
  return box.innerHTML;
}

/**
 * Returns { host, path, state, capturedAt, html }. `path` has no query string or hash.
 * The result is capped at MAX_BYTES: first by taking smaller subtrees, then by dropping the deepest ones.
 */
export function captureSnapshot(doc, { state = 'bag', maxBytes = MAX_BYTES, now = () => new Date() } = {}) {
  const loc = doc.location || doc.defaultView?.location;
  const anchors = [...doc.body.querySelectorAll('*')].filter(isAnchor);

  let pieces = [];
  for (let levels = 4; levels >= 0; levels--) {
    const roots = mergeRoots(anchors.map((a) => climb(doc, a, levels)));
    pieces = roots.map((r) => ({ depth: depthOf(r), html: sanitize(doc, r) }));
    if (bytes(pieces.map((p) => p.html).join('\n')) <= maxBytes) break;
  }
  // Still too big at the smallest size: drop the deepest subtrees first.
  while (pieces.length > 0 && bytes(pieces.map((p) => p.html).join('\n')) > maxBytes) {
    let di = 0;
    pieces.forEach((p, i) => { if (p.depth > pieces[di].depth) di = i; });
    pieces.splice(di, 1);
  }

  return {
    host: String(loc?.hostname || '').toLowerCase(),
    path: String(loc?.pathname || ''),
    state: STATES.includes(state) ? state : 'bag',
    capturedAt: now().toISOString(),
    html: pieces.map((p) => p.html).join('\n'),
  };
}

/** The file/clipboard text: an HTML document that starts with a comment holding host, path, state and time. */
export function snapshotToDocument(s) {
  const safe = (v) => String(v).replace(/--+/g, '-').replace(/[\r\n]+/g, ' ');
  return `<!-- Promo-Flow snapshot | host: ${safe(s.host)} | path: ${safe(s.path)} | state: ${safe(s.state)} | captured: ${safe(s.capturedAt)} -->\n`
    + `<!doctype html>\n<meta charset="utf-8">\n<title>${safe(s.host)} ${safe(s.state)}</title>\n<body>\n${s.html}\n</body>\n`;
}

export function snapshotFileName(s) {
  return `${(s.host || 'page').replace(/[^a-z0-9.-]/g, '')}-${s.state}.html`;
}
