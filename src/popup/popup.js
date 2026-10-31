import { LANGS, t, pickLang } from '../i18n/i18n.js';

const $ = (id) => document.getElementById(id);
let lang = 'en';
const hasChrome = typeof chrome !== 'undefined' && chrome.storage;

function render() {
  $('title').textContent = t(lang, 'appName');
  $('tagline').textContent = t(lang, 'tagline');
  $('go').textContent = t(lang, 'find');
  $('codesL').textContent = t(lang, 'yourCodes');
  $('codesHint').textContent = t(lang, 'yourCodesHint');
  $('teleL').textContent = t(lang, 'telemetry');
  $('teleHint').textContent = t(lang, 'telemetryHint');
  $('apiL').textContent = t(lang, 'apiBase');
  $('save').textContent = t(lang, 'addCode');
  $('lang').setAttribute('aria-label', t(lang, 'language'));
  document.documentElement.lang = lang;
}

async function init() {
  const sel = $('lang');
  for (const [k, v] of Object.entries(LANGS)) sel.add(new Option(v, k));
  const s = await chrome.storage.local.get(['lang', 'userCodes', 'telemetry', 'apiBase']);
  lang = pickLang(s.lang, navigator.language);
  sel.value = lang;
  $('codes').value = (s.userCodes || []).join('\n');
  $('tele').checked = !!s.telemetry;
  $('api').value = s.apiBase || 'http://localhost:3000';
  render();

  sel.addEventListener('change', async () => { lang = sel.value; await chrome.storage.local.set({ lang }); render(); });
  $('tele').addEventListener('change', () => chrome.storage.local.set({ telemetry: $('tele').checked }));
  $('save').addEventListener('click', async () => {
    const codes = [...new Set($('codes').value.split(/[\s,]+/).map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z0-9_-]{3,32}$/.test(c)))].slice(0, 30);
    await chrome.storage.local.set({ userCodes: codes, apiBase: $('api').value.trim() || 'http://localhost:3000' });
    $('codes').value = codes.join('\n');
    $('status').textContent = '✓';
  });
  $('go').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/^https?:/.test(tab.url)) { $('status').textContent = t(lang, 'notCheckout'); return; }
    $('status').textContent = t(lang, 'working');
    const r = await chrome.runtime.sendMessage({ type: 'PF_RUN', tabId: tab.id, url: tab.url });
    if (r?.ok) window.close(); else $('status').textContent = r?.error || 'Error';
  });
}
if (hasChrome) init();
