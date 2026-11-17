// Shadow-DOM panel so the page's CSS cannot restyle it (and ours cannot leak into the page).
import { t } from '../i18n/i18n.js';
import { formatRupees } from '../lib/money.js';

const CSS = `
/* Glass panel. Direction: calm, exact. One accent (blue) for actions and focus; green only for money saved.
   Spacing on a 4px grid, one easing curve, motion limited to opacity and transform. */
:host{all:initial}
.box{--ease:cubic-bezier(.22,1,.36,1);--fg:rgba(0,0,0,.88);--fg2:rgba(60,60,67,.72);--fg3:rgba(60,60,67,.56);--line:rgba(0,0,0,.08);
 --glass:rgba(255,255,255,.64);--edge:rgba(255,255,255,.72);--ctl:rgba(120,120,128,.12);--ctl-h:rgba(120,120,128,.2);--ac:#0a6cdc;--ok:#1f7a3d;--warn:#8a5a00;
 position:fixed;right:16px;top:16px;z-index:2147483647;box-sizing:border-box;width:336px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow:auto;
 font:14px/20px -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI Variable Text","Segoe UI",Roboto,"Noto Sans","Noto Sans Devanagari","Noto Sans Tamil","Noto Sans Telugu",sans-serif;
 color:var(--fg);padding:16px;border-radius:20px;background:var(--glass);border:1px solid var(--edge);
 box-shadow:inset 0 1px 0 rgba(255,255,255,.7),0 0 0 .5px var(--line),0 12px 32px rgba(0,0,0,.14),0 2px 6px rgba(0,0,0,.06);
 -webkit-backdrop-filter:blur(28px) saturate(180%);backdrop-filter:blur(28px) saturate(180%);
 animation:in 320ms var(--ease) both}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.box{background:rgba(250,250,252,.98)}}
@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:32px}
h1{font-size:16px;line-height:20px;font-weight:600;margin:0}
button{font:inherit;color:var(--fg);border:0;background:var(--ctl);border-radius:10px;min-height:32px;padding:4px 12px;cursor:pointer;
 box-shadow:inset 0 1px 0 rgba(255,255,255,.35);transition:background-color 150ms var(--ease),transform 150ms var(--ease),opacity 150ms var(--ease)}
button:hover{background:var(--ctl-h)}button:active{transform:scale(.98)}
button:focus-visible{outline:2px solid var(--ac);outline-offset:2px}button:disabled{opacity:.5;cursor:default;transform:none}
.msg{margin:12px 0 0}.msg>div+div{margin-top:4px}
.big{font-size:24px;line-height:28px;font-weight:500;color:var(--ok);font-variant-numeric:tabular-nums;margin:12px 0!important}
.muted{color:var(--fg2);font-size:12px;line-height:16px;margin-top:8px}.msg .muted{margin-top:2px}.warn{color:var(--warn)}
ul{margin:12px 0 0;padding:4px 0 0;list-style:none;max-height:160px;overflow:auto;border-top:1px solid var(--line)}
li{display:flex;justify-content:space-between;align-items:center;min-height:32px;font-size:13px;line-height:20px;gap:8px;font-variant-numeric:tabular-nums}
li+li{border-top:1px solid var(--line)}
li .tag{color:var(--fg3);font-size:12px;margin-left:8px}li .fail{color:var(--fg3)}
.acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.acts button:first-child:not(:only-child),.acts button[data-more]{background:var(--ac);color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.25)}
.acts button[data-more]:disabled{background:var(--ctl);color:var(--fg2)}
@media (prefers-color-scheme:dark){.box{--fg:rgba(255,255,255,.92);--fg2:rgba(235,235,245,.68);--fg3:rgba(235,235,245,.56);--line:rgba(255,255,255,.1);
 --glass:rgba(32,32,36,.68);--edge:rgba(255,255,255,.16);--ctl:rgba(255,255,255,.1);--ctl-h:rgba(255,255,255,.16);--ac:#0a84ff;--ok:#4cc38a;--warn:#e0a030;
 box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 0 0 .5px rgba(0,0,0,.4),0 16px 40px rgba(0,0,0,.4)}}
@media (prefers-reduced-motion:reduce){.box{animation:none}button{transition:none}}
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
      const b = doc.createElement('span'); b.textContent = e.outcome === 'applied' ? `−${formatRupees(e.saving)}` : '✕'; if (e.outcome !== 'applied') b.className = 'fail';
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
