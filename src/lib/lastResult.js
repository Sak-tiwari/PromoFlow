// The hand-off between the bag page (coupon search) and the payment page (bank-offer advice).
// Stored by the service worker in chrome.storage.session (cleared when the browser closes), under `pf:last:<host>`.

export const LAST_MAX_AGE_MS = 30 * 60 * 1000;
export const lastKey = (host) => `pf:last:${host}`;

const CODE_RE = /^[A-Z0-9_-]{1,32}$/;
const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

/** Validates a message from a content script and returns the entry to store, or null. */
export function makeLast(msg, now = Date.now()) {
  const host = String(msg?.host || '').toLowerCase();
  const code = String(msg?.code || '').toUpperCase();
  if (!HOST_RE.test(host) || !CODE_RE.test(code)) return null;
  if (!Number.isInteger(msg.baseline) || !Number.isInteger(msg.payable) || msg.baseline < 0 || msg.payable < 0) return null;
  return { host, code, baseline: msg.baseline, payable: msg.payable, at: now };
}

/** The entry if it is for this host and at most 30 minutes old, else null. */
export function freshLast(entry, host, now = Date.now()) {
  if (!entry || typeof entry.at !== 'number') return null;
  if (entry.host !== String(host).toLowerCase()) return null;
  const age = now - entry.at;
  return age >= 0 && age <= LAST_MAX_AGE_MS ? entry : null;
}
