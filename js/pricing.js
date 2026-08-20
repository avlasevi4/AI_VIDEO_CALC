(function () {
  'use strict';
  const CACHE_KEY = 'ai-video-calc-v2-pricing-cache';

  async function loadPricing(forceNetwork = false) {
    if (window.__INLINE_PRICING__ && !forceNetwork) {
      return { data: window.__INLINE_PRICING__, source: 'embedded' };
    }

    try {
      const response = await fetch('./data/pricing.json' + (forceNetwork ? `?t=${Date.now()}` : ''), { cache: forceNetwork ? 'no-store' : 'default' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      return { data, source: 'online' };
    } catch (error) {
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (cached) return { data: cached, source: 'cached', warning: error.message };
      } catch (_) {}
      if (window.__INLINE_PRICING__) return { data: window.__INLINE_PRICING__, source: 'embedded', warning: error.message };
      throw error;
    }
  }

  window.AIVideoPricing = { loadPricing };
})();
