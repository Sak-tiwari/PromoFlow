// Money helpers. All amounts are integer paise. No floating point arithmetic on money.

const RUPEE_RE = /(?:₹|rs\.?|inr)\s*(\d[\d,]*)(?:\.(\d{1,2}))?/gi;
const PLAIN_RE = /(\d[\d,]*)(?:\.(\d{1,2}))?/;

function toPaise(whole, frac) {
  const w = String(whole).replace(/,/g, '');
  if (!w) return null;
  const paise = Number(w) * 100 + Number(String(frac || '').padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? paise : null;
}

/** All amounts written with a rupee marker (₹, Rs, INR) in the text, as paise, in order. */
export function findRupeeAmounts(text) {
  const out = [];
  if (text == null) return out;
  const s = String(text).replace(/ /g, ' ');
  for (const m of s.matchAll(RUPEE_RE)) {
    const p = toPaise(m[1], m[2]);
    if (p != null) out.push(p);
  }
  return out;
}

/** First number in the text as paise (rupee marker optional). Returns null if none. */
export function parseRupees(text) {
  if (text == null) return null;
  const s = String(text).replace(/ /g, ' ');
  const marked = findRupeeAmounts(s);
  if (marked.length) return marked[0];
  const m = s.match(PLAIN_RE);
  return m ? toPaise(m[1], m[2]) : null;
}

/** Format paise with Indian digit grouping, e.g. 12345600 -> "₹1,23,456.00". Latin digits always. */
export function formatRupees(paise) {
  if (!Number.isInteger(paise)) return '';
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const whole = String(Math.trunc(abs / 100));
  const frac = String(abs % 100).padStart(2, '0');
  let grouped = whole;
  if (whole.length > 3) {
    const last3 = whole.slice(-3);
    const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = `${rest},${last3}`;
  }
  return `${neg ? '-' : ''}₹${grouped}.${frac}`;
}

/** floor(amount * bp / 10000) using integer-safe arithmetic for realistic amounts. */
export function percentOf(amountPaise, basisPoints) {
  return Math.floor((amountPaise * basisPoints) / 10000);
}
