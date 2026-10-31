import en from './en.json';
import hi from './hi.json';
import mr from './mr.json';
import ta from './ta.json';
import te from './te.json';

export const LANGS = { en: 'English', hi: 'हिन्दी', mr: 'मराठी', ta: 'தமிழ்', te: 'తెలుగు' };
const TABLES = { en, hi, mr, ta, te };

/** t(lang, key, vars) falls back to English, then to the key itself. */
export function t(lang, key, vars = {}) {
  const s = TABLES[lang]?.[key] ?? en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

export function pickLang(saved, navLang = 'en') {
  if (saved && TABLES[saved]) return saved;
  const base = String(navLang).toLowerCase().split('-')[0];
  return TABLES[base] ? base : 'en';
}
