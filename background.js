/* ============================================================================
 * Promo-Flow — MV3 Service Worker
 *  - Pulls candidate coupons (cache-backed API)
 *  - Runs greedy Max-Heap pass against the live DOM via content script
 *  - Falls back to DP Knapsack + DAG for stacking
 *  - Alarms-driven expiry cleanup using Min-Heap
 * ==========================================================================*/
importScripts('src/dsa_engine.js');

const ENGINE       = new PromoFlowEngine();
const STATE_KEY    = 'promoFlowState';
const CLEANUP_ALARM = 'pf-cleanup';

/* ----------------------- Storage helpers --------------------------------- */
async function loadState() {
  const r = await chrome.storage.local.get(STATE_KEY);
  return r[STATE_KEY] || { sessions: {} };
}
async function saveState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

/* ----------------------- Mock API (replace w/ real fetch) ----------------- */
async function fetchCouponsForDomain(domain) {
  const cacheKey = `coupons:${domain}`;
  const cached = await chrome.storage.local.get(cacheKey);
  const now = Date.now();
  if (cached[cacheKey] && cached[cacheKey].some(c => c.expiry > now)) {
    return cached[cacheKey].filter(c => c.expiry > now);
  }

  // TODO: replace with real backend call. Sample payload:
  const coupons = [
    { code: 'WELCOME20', type: 'percent', value: 20, expectedDiscount: 20.00,
      expiry: now + 7 * 86400000, stackable: true,  weight: 1,
      conflictsWith: ['VIP10'] },
    { code: 'SAVE10',    type: 'percent', value: 10, expectedDiscount: 10.00,
      expiry: now + 14 * 86400000, stackable: true,  weight: 1,
      conflictsWith: [] },
    { code: 'FREESHIP',  type: 'fixed',   value: 8,  expectedDiscount:  8.00,
      expiry: now + 3 * 86400000, stackable: true,  weight: 1,
      conflictsWith: [] },
    { code: 'VIP10',     type: 'percent', value: 10, expectedDiscount: 10.00,
      expiry: now + 5 * 86400000, stackable: true,  weight: 1,
      conflictsWith: ['WELCOME20'] }
  ];

  await chrome.storage.local.set({ [cacheKey]: coupons });
  return coupons;
}

/* ----------------------- Lifecycle hooks ---------------------------------- */
chrome.runtime.onInstalled.addListener(async () => {
  await saveState({ sessions: {}, lastRun: null, version: 1 });
  chrome.alarms.create(CLEANUP_ALARM, { periodInMinutes: 30 });
  console.log('[Promo-Flow] Installed & alarm scheduled.');
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== CLEANUP_ALARM) return;
  const removed = ENGINE.cleanupExpired(Date.now());
  if (removed > 0) console.log(`[Promo-Flow] Purged ${removed} expired coupons.`);

  // Also purge from storage
  const all = await chrome.storage.local.get(null);
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('coupons:') && Array.isArray(v)) {
      const fresh = v.filter(c => c.expiry > Date.now());
      if (fresh.length !== v.length) await chrome.storage.local.set({ [k]: fresh });
    }
  }
});

/* ----------------------- Checkout auto-detection -------------------------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'PROMO_FLOW_CHECKOUT_DETECTED' && sender.tab?.id) {
    handleCheckoutDetected(sender.tab.id, msg.domain);
    sendResponse({ ok: true });
    return;
  }
  if (msg?.type === 'PROMO_FLOW_START_SESSION') {
    handleCheckoutDetected(msg.tabId, msg.domain).then(sendResponse);
    return true;
  }
});

/* ----------------------- Session orchestration ---------------------------- */
async function handleCheckoutDetected(tabId, domain) {
  // 1. Pre-flight check via content script
  let detect;
  try {
    detect = await chrome.tabs.sendMessage(tabId, { type: 'PROMO_FLOW_DETECT' });
  } catch {
    return { status: 'no-content-script' };
  }
  if (!detect?.isCheckout || !detect?.hasCouponInput) {
    return { status: 'no-checkout' };
  }

  // 2. Load coupons, populate engine structures
  const coupons = await fetchCouponsForDomain(domain);
  ENGINE.loadCoupons(domain, coupons);

  // 3. Greedy phase — pop Max-Heap until one succeeds
  const results = [];
  let bestSavings = 0;
  let winningCode = null;

  // Reset coupon field before starting
  await chrome.tabs.sendMessage(tabId, { type: 'PROMO_FLOW_RESET' });

  while (true) {
    const coupon = ENGINE.nextCandidate();
    if (!coupon) break;

    const res = await chrome.tabs.sendMessage(tabId,
      { type: 'PROMO_FLOW_APPLY', code: coupon.code });

    if (res?.success) {
      results.push({ code: coupon.code, applied: true,
                     savings: res.savings || 0 });
      if ((res.savings || 0) > bestSavings) {
        bestSavings = res.savings || 0;
        winningCode = coupon.code;
      }
      // Stop the greedy pass at first success — proceed to stacking phase
      break;
    } else {
      ENGINE.markFailed(coupon.code);
      results.push({ code: coupon.code, applied: false,
                     reason: res?.reason || 'unknown' });
    }
  }

  // 4. Stacking phase — DP Knapsack + DAG over remaining coupons
  const remaining = (ENGINE.domainMap.get(domain) || [])
    .filter(c => !ENGINE.failedSet.has(c.code) && c.stackable);

  const dag = new CombinabilityDAG();
  remaining.forEach(c => dag.addNode(c.code,
    { weight: c.expectedDiscount, coupon: c }));

  // Build DAG edges respecting conflicts (A->B iff compatible & A first)
  for (let i = 0; i < remaining.length; i++) {
    for (let j = 0; j < remaining.length; j++) {
      if (i === j) continue;
      const a = remaining[i], b = remaining[j];
      const conflicts = (a.conflictsWith || []).includes(b.code) ||
                        (b.conflictsWith || []).includes(a.code);
      if (!conflicts) dag.addEdge(a.code, b.code);
    }
  }

  const stack = dag.maxWeightPath();

  // Knapsack: capacity = number of stackable slots merchant allows (here: 3)
  const knapItems = remaining.map(c => ({
    id: c.code, value: c.expectedDiscount, weight: c.weight || 1, coupon: c
  }));
  const knap = knapsackStackable(knapItems, 3);

  // 5. Persist + notify UI
  const state = await loadState();
  state.sessions[domain] = {
    results, bestSavings, winningCode,
    stackPath: stack.path, knapsackSelection: knap.selected.map(s => s.id),
    timestamp: Date.now()
  };
  state.lastRun = Date.now();
  await saveState(state);

  chrome.runtime.sendMessage({
    type: 'PROMO_FLOW_RESULT',
    domain, results, bestSavings, winningCode,
    stackPath: stack.path, knapsack: knap.selected.map(s => s.id)
  }).catch(() => {}); // popup may not be open

  return { status: 'complete', bestSavings, winningCode };
}