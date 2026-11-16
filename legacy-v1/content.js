/* ============================================================================
 * Promo-Flow — Content Script (SPA & Amazon/Flipkart Patched)
 * ==========================================================================*/
(() => {
  'use strict';

  const CHECKOUT_URL_PATTERNS = [
    /\/checkout\b/i, /\/cart\b/i, /\/order\b/i,
    /\/payment\b/i, /\/billing\b/i, /\/shop\/(review|confirm)\b/i,
    /\/gp\/cart\b/i, /\/gp\/buy\b/i // Amazon specific
  ];

  // Added Amazon & Flipkart specific names/IDs
  const COUPON_INPUT_SELECTORS = [
    'input[name="claimCode"]', // Amazon
    'input#spc-gcpromoinput', // Amazon checkout
    'input[name="giftCardPromotion"]', // Amazon
    'input[name="couponCode"]', // Flipkart
    'input[placeholder*="coupon" i]',
    'input[placeholder*="promo" i]',
    'input[placeholder*="gift card" i]',
    'input[placeholder*="discount" i]',
    'input[placeholder*="voucher" i]',
    'input[name*="coupon" i]', 'input[name*="promo" i]',
    'input[id*="coupon" i]', 'input[id*="promo" i]'
  ];

  // Added Amazon & Flipkart total selectors
  const TOTAL_SELECTORS = [
    '#sc-subtotal-amount-active-cart', // Amazon cart
    '#subtotals-marketplace-table', // Amazon checkout
    '.summary-row .value', // Flipkart
    '[class*="grand-total" i]', '[class*="order-total" i]',
    '[id*="grandTotal" i]', '[id*="orderTotal" i]',
    '[data-total]', '[class*="total" i]'
  ];

  const ERROR_REGEX =
    /invalid|expired|not (?:applicable|valid|available)|does not (?:apply|exist|match)|already (?:applied|in use)|cannot be (?:applied|combined)|incompatible|no longer valid|i didn't understand that|please enter a valid/i;

  const SUCCESS_REGEX =
    /applied|success|discount (?:applied|added)|coupon (?:accepted|applied)|code (?:accepted|applied)|you saved|saving of|-\$|-₹/i;

  /* ----------------------- DOM helpers ------------------------------------- */

  function isCheckoutPage() {
    const url = location.href.toLowerCase();
    return CHECKOUT_URL_PATTERNS.some(p => p.test(url));
  }

  // Amazon/Flipkart hide the input inside an accordion. We must click it.
  function expandHiddenInputs() {
    // Amazon's "Enter a gift card or promotional code" accordion
    const amazonAccordion = document.querySelector('#gc-redemption-expander, .a-expander-header[data-a-expander-collapsed]');
    if (amazonAccordion) {
      amazonAccordion.click();
      return true;
    }
    // Flipkart's "Apply Coupon" button
    const flipkartApplyBtn = document.querySelector('._2K8N2e, button:has(span:contains("Apply Coupon"))');
    if (flipkartApplyBtn) {
      flipkartApplyBtn.click();
      return true;
    }
    return false;
  }

  // Look for the input
  function findCouponInput() {
    for (const sel of COUPON_INPUT_SELECTORS) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        // If it's hidden inside an accordion, try to expand it first
        if (el.offsetParent === null) {
          expandHiddenInputs();
          // Wait a moment for DOM to update after click
          setTimeout(() => {}, 500);
        }
        if (el) return el; 
      }
    }
    return null;
  }

  // SPA-aware polling: Wait up to 5 seconds for the input to appear
  function findCouponInputWithRetry(retries = 10, interval = 500) {
    return new Promise((resolve) => {
      let attempts = 0;
      const check = () => {
        const input = findCouponInput();
        if (input) return resolve(input);
        if (attempts++ >= retries) return resolve(null);
        setTimeout(check, interval);
      };
      check();
    });
  }

  function findApplyButton(input) {
    // Amazon & Flipkart specific buttons
    const specificBtns = document.querySelectorAll(
      '#gc-redemption-apply-button, #spc-gcpromoapply, .sc-apply-gc-promo-button, ._2K8N2e'
    );
    for (const b of specificBtns) {
      if (b.offsetParent !== null) return b;
    }

    const scope = input.form || input.closest('form, fieldset, .coupon, .promo') || input.parentElement || document.body;
    const candidates = scope.querySelectorAll('button, input[type="submit"], a[role="button"], [type="button"]');
    for (const b of candidates) {
      const t = ((b.textContent || '') + ' ' + (b.value || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase();
      if (/(apply|redeem|submit|promo|coupon|validate|use code)/i.test(t)) return b;
    }
    
    if (input.form) {
      const s = input.form.querySelector('button[type="submit"], input[type="submit"]');
      if (s) return s;
    }
    return null;
  }

  function readCartTotal() {
    for (const sel of TOTAL_SELECTORS) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        // Parse $ and ₹ formats
        const m = (el.textContent || '').match(/-?\s*₹?\s*\$?\s*([\d,]+\.?\d{2})/);
        if (m) {
          const val = parseFloat(m[1].replace(/,/g, ''));
          if (!Number.isNaN(val)) return val;
        }
      }
    }
    return null;
  }

  function collectMessages() {
    const out = [];
    const nodes = document.querySelectorAll(
      '.error, .message, .alert, [role="alert"], .toast, .notice, ' +
      '.validation, [class*="error" i], [class*="message" i], [class*="toast" i], ' +
      '#gc-redemption-error-message, .a-alert-content, .fk-error'
    );
    nodes.forEach(n => {
      const t = (n.textContent || '').trim();
      if (t.length > 0 && t.length < 400) out.push(t);
    });
    return out;
  }

  /* ----------------------- Apply + observe --------------------------------- */

  function applyCoupon(code) {
    return new Promise(async (resolve) => {
      // Wait for input to appear (crucial for Amazon/Flipkart SPAs)
      const input = await findCouponInputWithRetry();
      if (!input) return resolve({ success: false, reason: 'no-input', code });

      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, code);
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      // Wait a tick for React to register the input
      await new Promise(r => setTimeout(r, 300));

      const button = findApplyButton(input);
      const baselineTotal = readCartTotal();
      let settled = false;

      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        observer.disconnect();
        resolve(payload);
      };

      const observer = new MutationObserver(() => {
        const msgs = collectMessages();
        const currentTotal = readCartTotal();

        if (msgs.some(m => ERROR_REGEX.test(m))) {
          return finish({ success: false, reason: 'rejected', code, message: msgs.join(' | ') });
        }
        if (currentTotal != null && baselineTotal != null && currentTotal < baselineTotal - 0.005) {
          return finish({
            success: true, code,
            savings: +(baselineTotal - currentTotal).toFixed(2),
            total: currentTotal
          });
        }
        if (msgs.some(m => SUCCESS_REGEX.test(m))) {
          return finish({ success: true, code, savings: 0, total: currentTotal, message: 'banner-detected' });
        }
      });
      
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });

      const timer = setTimeout(() => {
        finish({ success: false, reason: 'timeout', code });
      }, 6000);

      if (button) button.click();
      else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
  }

  /* ----------------------- Message router ---------------------------------- */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'PROMO_FLOW_DETECT') {
      findCouponInputWithRetry(4, 500).then(input => {
        sendResponse({
          isCheckout:    isCheckoutPage(),
          hasCouponInput: !!input,
          domain:        location.hostname,
          url:           location.href,
          cartTotal:     readCartTotal()
        });
      });
      return true; // Keep channel open for async
    }

    if (msg.type === 'PROMO_FLOW_APPLY') {
      applyCoupon(msg.code).then(sendResponse);
      return true; 
    }

    if (msg.type === 'PROMO_FLOW_RESET') {
      findCouponInputWithRetry(4, 500).then(input => {
        if (input) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        sendResponse({ ok: true });
      });
      return true;
    }
  });
})();