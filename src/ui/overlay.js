// Shadow-DOM panel so the page's CSS cannot restyle it (and ours cannot leak into the page).
import { t } from '../i18n/i18n.js';
import { formatRupees } from '../lib/money.js';

const CSS = `
:host{all:initial}
.box{position:fixed;right:16px;top:16px;z-index:2147483647;width:320px;max-width:calc(100vw - 32px);
 font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Devanagari","Noto Sans Tamil","Noto Sans Telugu",sans-serif;
 color:#1b1f23;background:#fff;border:1px solid #d0d7de;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:14px}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px}
h1{font-size:15px;margin:0}
button{font:inherit;border:1px solid #d0d7de;background:#f6f8fa;border-radius:8px;padding:4px 10px;cursor:pointer}
.msg{margin:10px 0 0}.big{font-size:20px;font-weight:700;color:#1a7f37}
.muted{color:#57606a;font-size:12px;margin-top:6px}.msg .muted{margin-top:2px}.warn{color:#9a6700}
ul{margin:8px 0 0;padding:0;list-style:none;max-height:160px;overflow:auto}li{display:flex;justify-content:space-between;font-size:12px;padding:2px 0;gap:8px}
li .tag{color:#57606a;font-size:11px;margin-left:6px}.acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}button:disabled{opacity:.6;cursor:default}
@media (prefers-color-scheme:dark){.box{background:#161b22;color:#e6edf3;border-color:#30363d}button{background:#21262d;color:inherit;border-color:#30363d}.muted,li .tag{color:#8b949e}.big{color:#3fb950}}
`;

const DAY = 86_400_000;
const SOURCE_KEYS = { user: 'srcYours', listed: 'srcSite', preapplied: 'srcSite', shared: 'srcShared', feed: 'srcFeed', dataset: 'srcDataset', crowd: 'srcShared' };

/** "site", "feed · 2d ago", "yours": where a code came from and how recently it was seen working or listed. */
export function sourceTag(lang, origin, meta = {}, now = Date.now()) {
  const key = SOURCE_KEYS[origin] ?? SOURCE_KEYS[meta.source] ?? 'srcKnown';
  const parts = [t(lang, key)];
  const ref = Math.max(meta.lastSuccessAt ?? 0, meta.lastSeen ?? 0);
  if (ref && origin !== 'user' && origin !== 'listed') {
    const d = Math.floor(Math.max(0, now - ref) / DAY);
    parts.push(d === 0 ? t(lang, 'ageToday') : t(lang, 'ageDays', { d }));
  }
  return parts.join(' · ');
}

export function createOverlay(doc, lang, { onStop }) {
  const host = doc.createElement('div');
  host.setAttribute('data-promoflow', '');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style><div class="box" role="status" aria-live="polite">
    <div class="row"><h1></h1><button type="button" data-act></button></div><div class="msg"></div><ul></ul><div class="muted"></div></div>`;
  doc.documentElement.appendChild(host);
  const $ = (s) => root.querySelector(s);
  $('h1').textContent = t(lang, 'appName');
  let closeMode = false;
  const act = $('[data-act]');
  act.textContent = t(lang, 'stop');
  act.addEventListener('click', () => (closeMode ? host.remove() : onStop()));
  const setClose = () => { closeMode = true; act.textContent = t(lang, 'close'); };

  const outcomeLine = (e) => `${e.code}`;
  return {
    working: (m) => { $('.msg').textContent = m; },
    trying: ({ code, n, total }) => { $('.msg').textContent = t(lang, 'trying', { code, n, total }); },
    result: (e) => {
      const li = doc.createElement('li');
      const a = doc.createElement('span'); a.textContent = outcomeLine(e);
      const tag = doc.createElement('span'); tag.className = 'tag'; tag.textContent = sourceTag(lang, e.origin, e.meta); a.appendChild(tag);
      const b = doc.createElement('span'); b.textContent = e.outcome === 'applied' ? `−${formatRupees(e.saving)}` : '✕';
      li.append(a, b); $('ul').appendChild(li);
    },
    message(text, warn = true) { $('.msg').textContent = text; $('.msg').className = warn ? 'msg warn' : 'msg'; setClose(); },
    summary(s, unverified) {
      setClose();
      const m = $('.msg'); m.textContent = '';
      const line = (txt, cls) => { const d = doc.createElement('div'); if (cls) d.className = cls; d.textContent = txt; m.appendChild(d); };
      if (!s.coupon && !s.offer) { line(t(lang, 'noneWorked')); }
      if (s.coupon) {
        line(`${t(lang, 'couponApplied')}: ${s.coupon.code}`);
        const originKey = { user: 'originUser', listed: 'originListed', server: 'originShared', seed: 'originShared' }[s.coupon.origin];
        if (originKey) line(t(lang, originKey), 'muted');
        line(`${t(lang, 'before')} ${formatRupees(s.baseline)} → ${t(lang, 'after')} ${formatRupees(s.coupon.payable)}`);
        if (!s.finalApplied) line(t(lang, 'couponNotApplied', { code: s.coupon.code }), 'warn');
        line(`${t(lang, 'youSave')} ${formatRupees(s.coupon.saving)}`, 'big');
      }
      if (s.offer) {
        line(`${t(lang, 'bankOffer')}: ${s.offer.text}`);
        line(`${t(lang, 'estimate')}: −${formatRupees(s.offer.estimatedSaving)} → ${formatRupees(s.estimatedPayable)}`);
        $('.box > .muted').textContent = t(lang, 'bankHint');
      }
      if (s.skipped?.length) line(t(lang, 'skippedIneligible', { codes: s.skipped.join(', ') }), 'muted');
      if (s.skippedMinSpend?.length) line(t(lang, 'skippedMinSpend', { codes: s.skippedMinSpend.join(', ') }), 'muted');
      if (s.preAppliedLost) line(t(lang, 'preAppliedLost'), 'warn');
      const stopKey = { blocked_captcha: 'captcha', aborted: 'stopped', rate_limited: 'rateLimited', login_required: 'loginRequired', could_not_restore: 'couldNotRestore', panel_unavailable: 'noField' }[s.stopped];
      if (stopKey) line(t(lang, stopKey), 'warn');
      if (unverified) $('.box > .muted').textContent += ` ${t(lang, 'unverifiedSite')}`;
    },
    /** "Try N more" button, enabled after a cooldown so tries stay paced. */
    tryMore({ n, cooldownMs, onClick, now = Date.now, setTimer = setTimeout }) {
      const wrap = doc.createElement('div'); wrap.className = 'acts';
      const b = doc.createElement('button'); b.type = 'button'; b.setAttribute('data-more', '');
      wrap.appendChild(b); $('.msg').appendChild(wrap);
      const until = now() + cooldownMs;
      const tick = () => {
        const left = Math.ceil((until - now()) / 1000);
        if (left > 0) { b.disabled = true; b.textContent = t(lang, 'tryMoreWait', { s: left }); setTimer(tick, 1000); return; }
        b.disabled = false; b.textContent = t(lang, 'tryMore', { n });
      };
      tick();
      b.addEventListener('click', () => { if (!b.disabled) { b.disabled = true; onClick(); } });
      return b;
    },
    /** Asks before sharing a code that worked. onAnswer('yes' | 'no' | 'always'). */
    sharePrompt({ code, onAnswer }) {
      const box = doc.createElement('div'); box.className = 'muted'; box.setAttribute('data-share', '');
      box.textContent = t(lang, 'sharePrompt', { code });
      const wrap = doc.createElement('div'); wrap.className = 'acts';
      for (const [ans, key] of [['yes', 'shareYes'], ['no', 'shareNo'], ['always', 'shareAlways']]) {
        const b = doc.createElement('button'); b.type = 'button'; b.textContent = t(lang, key); b.setAttribute('data-answer', ans);
        b.addEventListener('click', () => { box.remove(); wrap.remove(); onAnswer(ans); });
        wrap.appendChild(b);
      }
      $('.msg').append(box, wrap);
    },
    note(text) { const d = doc.createElement('div'); d.className = 'muted'; d.textContent = text; $('.msg').appendChild(d); },
    payment(res) {
      setClose();
      const m = $('.msg'); m.textContent = '';
      const line = (txt, cls) => { const d = doc.createElement('div'); if (cls) d.className = cls; d.textContent = txt; m.appendChild(d); };
      if (res.status !== 'ok') { line(t(lang, 'noTotal'), 'warn'); return; }
      if (res.coupon) {
        line(`${t(lang, 'couponApplied')}: ${res.coupon.code}`);
        line(`${t(lang, 'youSave')} ${formatRupees(res.coupon.saving)}`, 'big');
      }
      line(`${t(lang, 'totalOnPage')}: ${formatRupees(res.total)}`);
      if (res.offer) {
        line(`${t(lang, 'bankOffer')}: ${res.offer.text}`);
        line(`${t(lang, 'estimate')}: −${formatRupees(res.offer.estimatedSaving)} → ${formatRupees(res.estimatedPayable)}`);
        $('.box > .muted').textContent = t(lang, 'bankHint');
      } else {
        line(t(lang, 'noOffers'));
      }
    },
    destroy: () => host.remove(),
  };
}
