// Opt-in sharing of a code the shopper typed in themselves.
import { t } from '../i18n/i18n.js';

/** Shares a code the shopper typed in, only after it measurably lowered the total, and only with consent. */
export function offerShare(ui, s, { host, lang, shareMode, send = (m) => chrome.runtime.sendMessage(m) }) {
  // Only after it measurably lowered the total on this page, and never without consent ('ask' prompts; 'always' was chosen by the user).
  if (shareMode === 'never' || !s.coupon || !s.finalApplied || s.coupon.origin !== 'user' || !(s.coupon.saving > 0)) return false;
  const share = () => send({ type: 'PF_SHARE', domain: host, code: s.coupon.code })
    .then((r) => { if (r?.ok) ui.note(t(lang, 'sharedThanks')); })
    .catch(() => {});
  if (shareMode === 'always') { share(); return true; }
  ui.sharePrompt({
    code: s.coupon.code,
    onAnswer: (a) => {
      if (a === 'always') send({ type: 'PF_SET_SHARE_MODE', mode: 'always' }).catch(() => {});
      if (a === 'yes' || a === 'always') share();
    },
  });
  return true;
}
