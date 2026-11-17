// Source adapter for a JSON coupon feed (an affiliate network's coupon API, for example).
// Every network names its fields differently, so the mapping lives in the config, not in code:
//   {
//     "type": "jsonFeed", "name": "my-network", "source": "feed", "enabled": true,
//     "url": "https://api.example.com/v1/coupons?country=IN",
//     "apiKeyEnv": "MY_NETWORK_KEY", "apiKeyHeader": "Authorization", "apiKeyPrefix": "Token ",
//     "itemsPath": "data.offers",
//     "fields": { "code": "coupon_code", "url": "merchant_url", "expiresAt": "end_date", "description": "title", "startedAt": "start_date" },
//     "domains": ["myntra.com", "ajio.com", "nykaa.com"]
//   }
// The API key is read from the environment, never from the config file.

export const MAX_BYTES = 5 * 1024 * 1024;

/** getPath({a:{b:[{c:1}]}}, 'a.b.0.c') -> 1 */
export function getPath(obj, path) {
  if (!path) return obj;
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Maps one feed item to the raw shape normalizeItem() expects. */
export function mapItem(item, fields = {}) {
  const pick = (k) => (fields[k] ? getPath(item, fields[k]) : item[k]);
  return { code: pick('code'), domain: pick('domain'), url: pick('url'), expiresAt: pick('expiresAt'), description: pick('description'), startedAt: pick('startedAt') };
}

export async function fetchJsonFeed(cfg, { fetchImpl = fetch, env = process.env, timeoutMs = 15_000 } = {}) {
  if (!/^https:\/\//.test(cfg.url || '')) throw new Error(`${cfg.name}: url must be https`);
  const headers = { Accept: 'application/json' };
  if (cfg.apiKeyEnv) {
    const key = env[cfg.apiKeyEnv];
    if (!key) throw new Error(`${cfg.name}: environment variable ${cfg.apiKeyEnv} is not set`);
    headers[cfg.apiKeyHeader || 'Authorization'] = `${cfg.apiKeyPrefix ?? ''}${key}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(cfg.url, { headers, signal: ctrl.signal });
    if (!r.ok) throw new Error(`${cfg.name}: HTTP ${r.status}`);
    const text = await r.text();
    if (text.length > MAX_BYTES) throw new Error(`${cfg.name}: response larger than ${MAX_BYTES} bytes`);
    const items = getPath(JSON.parse(text), cfg.itemsPath);
    if (!Array.isArray(items)) throw new Error(`${cfg.name}: itemsPath "${cfg.itemsPath}" is not a list`);
    return items.map((it) => mapItem(it, cfg.fields));
  } finally {
    clearTimeout(timer);
  }
}
