// Turns raw items from outside sources into clean coupon records, and merges them with what is already stored.
// Everything here is pure (no I/O) so it is fully unit-tested. Items without a real code (plain "deals") are rejected.

export const CODE_RE = /^[A-Z0-9_-]{3,32}$/;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Prior success rate per source, used before any outcome reports exist. */
export const SOURCE_PRIOR = Object.freeze({ shared: 0.4, feed: 0.3, crowd: 0.25, seed: 0.25, demo: 0.25, dataset: 0.05 });
export const KNOWN_SOURCES = Object.keys(SOURCE_PRIOR);

/** "https://www.Myntra.com/cart?x" | "myntra.com" -> "myntra.com"; null if it is not a usable host. */
export function normalizeDomain(input) {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#:]/)[0].replace(/^www\./, '').replace(/\.$/, '');
  if (!DOMAIN_RE.test(s)) return null;
  if (s !== 'localhost' && !s.includes('.')) return null;
  return s;
}

export function normalizeCodeStrict(input) {
  const c = String(input ?? '').trim().toUpperCase().replace(/\s+/g, '');
  return CODE_RE.test(c) ? c : null;
}

/** Accepts ISO dates, epoch ms, "30/11/2026", "30-11-2026", "30th November 2026", "Nov 30, 2026". Returns ms or null. */
export function parseDate(input) {
  if (input == null || input === '') return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  const s = String(input).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const t = Date.parse(s.length > 10 ? s : `${s}T23:59:59+05:30`); // a bare date means the end of that day in India
    return Number.isFinite(t) ? t : null;
  }
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // Indian order: day/month/year
  if (m) return endOfDayIST(+m[3], +m[2], +m[1]);
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*,?\s+(\d{4})/i);
  if (m && MONTHS.includes(m[2].toLowerCase())) return endOfDayIST(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  m = s.match(/([a-z]{3})[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (m && MONTHS.includes(m[1].toLowerCase())) return endOfDayIST(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  return null;
}

function endOfDayIST(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, mo - 1, d, 23, 59, 59) - 330 * 60_000; // 23:59:59 IST
  const back = new Date(t + 330 * 60_000);
  return back.getUTCDate() === d ? t : null; // rejects 31/02 etc.
}

/** Minimum spend in paise from text like "minimum purchase of Rs. 1999", "min spend of ₹3,000", "orders above ₹1,499". */
export function parseMinSpend(text) {
  const m = String(text ?? '').match(
    /(?:min(?:imum)?\.?\s*(?:order|purchase|spend|cart|transaction)?\s*(?:value|amount)?\s*(?:of)?|orders?\s*(?:above|over|of|worth)|purchases?\s*(?:above|over|of))\s*:?\s*(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
  );
  if (!m) return null;
  const rupees = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(rupees) && rupees > 0 ? Math.round(rupees * 100) : null;
}

export const isFirstOrderOnly = (text) => /first\s+(ever\s+)?(order|purchase|transaction)|new\s+(users?|customers?)\s+only|for\s+new\s+(users?|customers?)/i.test(String(text ?? ''));

/**
 * One raw item -> { ok: true, coupon } or { ok: false, reason }.
 * raw: { code, domain | url, expiresAt?, description?, startedAt? }; source: one of KNOWN_SOURCES.
 */
export function normalizeItem(raw, { source, now = Date.now() }) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not_an_object' };
  if (!KNOWN_SOURCES.includes(source)) return { ok: false, reason: 'unknown_source' };
  const domain = normalizeDomain(raw.domain ?? raw.url ?? raw.store);
  if (!domain) return { ok: false, reason: 'bad_domain' };
  if (raw.code == null || String(raw.code).trim() === '') return { ok: false, reason: 'no_code' }; // a deal, not a code
  const code = normalizeCodeStrict(raw.code);
  if (!code) return { ok: false, reason: 'bad_code' };
  const description = String(raw.description ?? raw.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const expiresAt = parseDate(raw.expiresAt ?? raw.expiry ?? raw.endDate);
  if (expiresAt != null && expiresAt < now) return { ok: false, reason: 'expired' };
  const minSpend = Number.isInteger(raw.minSpend) ? raw.minSpend : parseMinSpend(description);
  const seen = parseDate(raw.startedAt ?? raw.publishedAt);
  return {
    ok: true,
    coupon: {
      domain,
      code,
      source,
      sources: [source],
      description,
      expiresAt,
      minSpend: minSpend ?? null,
      firstOrderOnly: isFirstOrderOnly(description),
      firstSeen: seen != null && seen <= now ? seen : now,
      lastSeen: now,
    },
  };
}

/** Normalizes a batch and de-duplicates it on (domain, code). Returns { coupons, rejected: { reason: count } }. */
export function normalizeBatch(items, { source, now = Date.now() }) {
  const byKey = new Map();
  const rejected = {};
  for (const raw of items || []) {
    const r = normalizeItem(raw, { source, now });
    if (!r.ok) { rejected[r.reason] = (rejected[r.reason] ?? 0) + 1; continue; }
    const k = `${r.coupon.domain}|${r.coupon.code}`;
    byKey.set(k, byKey.has(k) ? mergeCoupon(byKey.get(k), r.coupon) : r.coupon);
  }
  return { coupons: [...byKey.values()], rejected };
}

/**
 * Merges a freshly harvested record into a stored one (same domain and code).
 * Keeps every source, the earliest firstSeen, the latest lastSeen, and outcome stats untouched.
 * The best-trusted source becomes `source`. A later expiry wins (sources refresh it); a missing one never erases a known one.
 */
export function mergeCoupon(stored, incoming) {
  if (!stored) return { stats: { tries: 0, successes: 0 }, status: 'active', ...incoming };
  const sources = [...new Set([...(stored.sources ?? [stored.source].filter(Boolean)), ...(incoming.sources ?? [incoming.source])])];
  const best = sources.slice().sort((a, b) => (SOURCE_PRIOR[b] ?? 0) - (SOURCE_PRIOR[a] ?? 0))[0];
  const expiries = [stored.expiresAt, incoming.expiresAt].filter((x) => x != null);
  return {
    ...stored,
    source: best,
    sources,
    description: incoming.description || stored.description || '',
    expiresAt: expiries.length ? Math.max(...expiries) : null,
    minSpend: incoming.minSpend ?? stored.minSpend ?? null,
    firstOrderOnly: !!(incoming.firstOrderOnly || stored.firstOrderOnly),
    firstSeen: Math.min(stored.firstSeen ?? incoming.firstSeen, incoming.firstSeen ?? stored.firstSeen),
    lastSeen: Math.max(stored.lastSeen ?? 0, incoming.lastSeen ?? 0),
    stats: stored.stats ?? { tries: 0, successes: 0 },
  };
}
