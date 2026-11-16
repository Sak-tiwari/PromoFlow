// Injected on demand (user clicked the extension). Runs the search, shows the overlay, reports results to the service worker.
import { runSearch } from './applyEngine.js';
import { pickAdapter, normalizeHost } from '../adapters/index.js';
import { createOverlay } from '../ui/overlay.js';
import { t } from '../i18n/i18n.js';
import { captureSnapshot } from './capture.js';
import { shouldReport } from '../lib/telemetry.js';

if (!window.__promoFlowLoaded) {
  window.__promoFlowLoaded = true;
  let running = null; // { abort }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'PF_PING') { sendResponse({ ok: true }); return; }
    if (msg?.type === 'PF_STOP') { running?.abort(); sendResponse({ ok: true }); return; }
    if (msg?.type === 'PF_CAPTURE') {
      try { sendResponse({ ok: true, snapshot: captureSnapshot(document, { state: msg.state }) }); }
      catch (e) { sendResponse({ ok: false, error: String(e?.message || e) }); }
      return;
    }
    if (msg?.type !== 'PF_START') return;
    sendResponse({ ok: true });
    start(msg).catch((e) => console.warn('[Promo-Flow]', e?.message));
  });

  async function start({ candidates, lang, overrides, recipe }) {
    document.querySelectorAll('[data-promoflow]').forEach((n) => n.remove());
    if (running) running.abort();
    const ctrl = new AbortController();
    running = { abort: () => ctrl.abort() };
    const host = normalizeHost(location.hostname);
    const adapter = pickAdapter(host);
    const siteRecipe = recipe && Array.isArray(recipe.hosts) && recipe.hosts.includes(host) ? recipe : null;
    const ui = createOverlay(document, lang, { onStop: () => ctrl.abort() });
    ui.working(t(lang, 'working'));
    try {
      const s = await runSearch({
        doc: document, adapter, overrides: overrides || {}, recipe: siteRecipe, candidates, signal: ctrl.signal,
        onProgress: (p) => {
          if (p.phase === 'trying') ui.trying(p);
          else if (p.phase === 'result') {
            ui.result(p);
            // Never report a user's own codes (they may be personal) or a coupon that was merely already in the cart.
            if (shouldReport(p.origin)) {
              chrome.runtime.sendMessage({ type: 'PF_REPORT', domain: host, code: p.code, outcome: p.outcome }).catch(() => {});
            }
          }
        },
      });
      const failKey = { no_promo_field: 'noField', blocked_captcha: 'captcha', no_total: 'noTotal', no_codes: 'noCodes', login_required: 'loginRequired' }[s.status];
      if (s.status !== 'ok') ui.message(t(lang, failKey || 'noField'));
      else ui.summary(s, !!adapter.unverified);
    } finally {
      running = null;
    }
  }
}
