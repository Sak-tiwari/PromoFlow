import { buildCandidates, TtlCache } from './candidates.js';
import { normalizeHost } from '../adapters/index.js';
import { pickLang } from '../i18n/i18n.js';
import seed from '../../backend/data/seed.json';
import { bundledRecipes, recipeForHost } from '../adapters/bundledRecipes.js';

const DEFAULTS = { apiBase: 'http://localhost:3000', telemetry: false, userCodes: [], lang: null };
const TTL = 6 * 3600_000;

async function settings() {
  const s = await chrome.storage.local.get(['apiBase', 'telemetry', 'userCodes', 'lang', 'clientId', 'cache']);
  return { ...DEFAULTS, ...s };
}

async function loadCache() {
  const { cache } = await chrome.storage.local.get('cache');
  return TtlCache.restore(cache, TTL); // MinHeap is rebuilt (heapified) when the worker wakes up
}
async function saveCache(c) { await chrome.storage.local.set({ cache: c.serialize() }); }

async function fetchServer(apiBase, domain) {
  const cache = await loadCache();
  const hit = cache.get(domain);
  if (hit) return hit;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${apiBase.replace(/\/$/, '')}/api/v1/coupons/${encodeURIComponent(domain)}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return [];
    const { coupons } = await r.json();
    cache.set(domain, coupons);
    await saveCache(cache);
    return coupons;
  } catch { return []; } // offline or backend down: fall back to bundled seed and user codes
}

async function runOnTab(tabId, url) {
  const host = normalizeHost(new URL(url).hostname);
  const s = await settings();
  const server = await fetchServer(s.apiBase, host);
  const seedForHost = seed.coupons.filter((c) => c.domain === host);
  // Known codes keep their origin (user | server | seed): the engine reports only server/seed/listed ones, never a user's own codes.
  const known = buildCandidates({ server, seed: seedForHost, user: s.userCodes }, 10).map((c) => ({ code: c.code, origin: c.origin }));
  const recipe = recipeForHost(host, bundledRecipes);
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  const stored = await chrome.storage.local.get('overrides');
  await chrome.tabs.sendMessage(tabId, {
    type: 'PF_START', candidates: known, recipe, lang: pickLang(s.lang, chrome.i18n.getUILanguage()), overrides: stored.overrides?.[host],
  });
  return { ok: true, count: known.length };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'PF_RUN') {
    runOnTab(msg.tabId, msg.url).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === 'PF_REPORT') {
    (async () => {
      const s = await settings();
      if (!s.telemetry) return;
      let clientId = s.clientId;
      if (!clientId) { clientId = crypto.randomUUID(); await chrome.storage.local.set({ clientId }); }
      await fetch(`${s.apiBase.replace(/\/$/, '')}/api/v1/coupons/report`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: msg.domain, code: msg.code, outcome: msg.outcome, clientId }),
      }).catch(() => {});
    })();
    return false;
  }
});

// Periodically drop expired cache entries (MinHeap sweep) even if no popup is open.
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('pf-sweep', { periodInMinutes: 60 }));
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'pf-sweep') return;
  const c = await loadCache();
  c.sweep();
  await saveCache(c);
});
