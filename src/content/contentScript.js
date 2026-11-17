// Injected on demand (user clicked the extension). Runs the search, shows the overlay, reports results to the service worker.
import { runSearch } from './applyEngine.js';
import { pickAdapter, normalizeHost } from '../adapters/index.js';
import { createOverlay } from '../ui/overlay.js';
import { t } from '../i18n/i18n.js';
import { captureSnapshot } from './capture.js';
import { shouldReport } from '../lib/telemetry.js';
import { pageKind } from '../adapters/recipe.js';
import { adviseOnPayment } from './paymentAdvice.js';
import { offerShare } from './share.js';

const MORE_COOLDOWN_MS = 30_000;

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

  async function start(msg) {
    const { candidates, lang, overrides, recipe, shareMode = 'ask', exclude = [] } = msg;
    document.querySelectorAll('[data-promoflow]').forEach((n) => n.remove());
    if (running) running.abort();
    const ctrl = new AbortController();
    running = { abort: () => ctrl.abort() };
    const host = normalizeHost(location.hostname);
    const adapter = pickAdapter(host);
    const siteRecipe = recipe && Array.isArray(recipe.hosts) && recipe.hosts.includes(host) ? recipe : null;
    const ui = createOverlay(document, lang, { onStop: () => ctrl.abort() });
    const metaByCode = new Map((candidates || []).filter((c) => c && typeof c === 'object').map((c) => [String(c.code).toUpperCase(), c]));
    ui.working(t(lang, 'working'));
    // A payment page only gets read-only advice. The coupon search never runs there.
    if (siteRecipe && pageKind(siteRecipe, location.pathname) === 'payment') {
      try {
        const last = await chrome.runtime.sendMessage({ type: 'PF_GET_LAST', host }).catch(() => null);
        ui.payment(adviseOnPayment({ doc: document, recipe: siteRecipe, last }));
      } finally { running = null; }
      return;
    }
    try {
      const s = await runSearch({
        doc: document, adapter, overrides: overrides || {}, recipe: siteRecipe, candidates, exclude, signal: ctrl.signal,
        onProgress: (p) => {
          if (p.phase === 'trying') ui.trying(p);
          else if (p.phase === 'result') {
            ui.result({ ...p, meta: metaByCode.get(p.code) });
            // Never report a user's own codes (they may be personal) or a coupon that was merely already in the cart.
            if (shouldReport(p.origin)) {
              chrome.runtime.sendMessage({ type: 'PF_REPORT', domain: host, code: p.code, outcome: p.outcome }).catch(() => {});
            }
          }
        },
      });
      const failKey = { no_promo_field: 'noField', blocked_captcha: 'captcha', no_total: 'noTotal', no_codes: 'noCodes', login_required: 'loginRequired' }[s.status];
      if (s.status !== 'ok') ui.message(t(lang, failKey || 'noField'));
      else {
        ui.summary(s, !!adapter.unverified);
        if (s.coupon && s.finalApplied) {
          // Remember the result for the payment page (the service worker keeps it for 30 minutes, in session storage).
          chrome.runtime.sendMessage({ type: 'PF_SAVE_LAST', host, code: s.coupon.code, baseline: s.baseline, payable: s.finalPayable }).catch(() => {});
        }
        // Only when this page is the recipe's bag page (not when the generic detector ran on some other page of the host).
        if (siteRecipe?.pages?.payment && pageKind(siteRecipe, location.pathname) === 'bag') ui.note(t(lang, 'payHint'));
        offerShare(ui, s, { host, lang, shareMode });
        // "Try N more": the next codes in the list, after a cooldown, only on a click. The best coupon so far is re-measured.
        if (s.remaining > 0 && !s.stopped && s.cap - (s.finalApplied ? 1 : 0) > 0) {
          const tried = [...new Set([...exclude, ...s.tried])];
          // The coupon left applied is measured again in the next run, so it takes one of the tries.
          const n = Math.min(s.remaining, s.cap - (s.finalApplied ? 1 : 0));
          ui.tryMore({ n, cooldownMs: MORE_COOLDOWN_MS, onClick: () => start({ ...msg, exclude: tried }) });
        }
      }
    } finally {
      running = null;
    }
  }
}

