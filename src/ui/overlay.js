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
.muted{color:#57606a;font-size:12px;margin-top:6px}.warn{color:#9a6700}
ul{margin:8px 0 0;padding:0;list-style:none;max-height:140px;overflow:auto}li{display:flex;justify-content:space-between;font-size:12px;padding:2px 0}
@media (prefers-color-scheme:dark){.box{background:#161b22;color:#e6edf3;border-color:#30363d}button{background:#21262d;color:inherit;border-color:#30363d}.muted{color:#8b949e}.big{color:#3fb950}}
`;

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
        line(`${t(lang, 'before')} ${formatRupees(s.baseline)} → ${t(lang, 'after')} ${formatRupees(s.coupon.payable)}`);
        if (!s.finalApplied) line(`⚠ ${formatRupees(s.coupon.payable)}`, 'warn');
        line(`${t(lang, 'youSave')} ${formatRupees(s.coupon.saving)}`, 'big');
      }
      if (s.offer) {
        line(`${t(lang, 'bankOffer')}: ${s.offer.text}`);
        line(`${t(lang, 'estimate')}: −${formatRupees(s.offer.estimatedSaving)} → ${formatRupees(s.estimatedPayable)}`);
        $('.muted').textContent = t(lang, 'bankHint');
      }
      if (s.stopped === 'blocked_captcha') line(t(lang, 'captcha'), 'warn');
      else if (s.stopped === 'aborted') line(t(lang, 'stopped'), 'warn');
      if (unverified) $('.muted').textContent += ` ${t(lang, 'unverifiedSite')}`;
    },
    destroy: () => host.remove(),
  };
}
