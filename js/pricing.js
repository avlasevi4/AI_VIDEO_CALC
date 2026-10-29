(function () {
  'use strict';
  const CACHE_KEY = 'ai-video-calc-v2-pricing-cache';
  const PRICING_URL = './data/pricing.json?v=4.1.0';
  const DREAMINA_SEEDANCE_25_MODELS = new Set([
    'dreamina-seedance-25',
    'dreamina-plus-seedance-25'
  ]);
  const DREAMINA_SEEDANCE_25_VARIANTS = new Set([
    '480p',
    '720p',
    '1080p',
    'omni-reference-480p',
    'omni-reference-720p',
    'omni-reference-1080p'
  ]);

  function normalizePricing(data) {
    if (!data || !Array.isArray(data.models)) return data;

    data.models.forEach(model => {
      if (!DREAMINA_SEEDANCE_25_MODELS.has(model?.id) || !Array.isArray(model.variants)) return;
      model.variants.forEach(variant => {
        if (!DREAMINA_SEEDANCE_25_VARIANTS.has(variant?.id) || !variant.billing) return;
        if (variant.billing.durationRange) {
          variant.billing.durationRange.min = 4;
        } else if (Array.isArray(variant.billing.allowedDurations)) {
          variant.billing.allowedDurations = [...new Set([4, ...variant.billing.allowedDurations.map(Number)])]
            .filter(Number.isFinite)
            .sort((a, b) => a - b);
        }
      });
    });

    return data;
  }

  async function loadPricing(forceNetwork = false) {
    if (window.__INLINE_PRICING__ && !forceNetwork) {
      return { data: normalizePricing(window.__INLINE_PRICING__), source: 'embedded' };
    }

    try {
      const response = await fetch(PRICING_URL + (forceNetwork ? `&t=${Date.now()}` : ''), { cache: forceNetwork ? 'no-store' : 'default' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = normalizePricing(await response.json());
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      return { data, source: 'online' };
    } catch (error) {
      try {
        const cached = normalizePricing(JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'));
        if (cached) {
          localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
          return { data: cached, source: 'cached', warning: error.message };
        }
      } catch (_) {}
      if (window.__INLINE_PRICING__) return { data: normalizePricing(window.__INLINE_PRICING__), source: 'embedded', warning: error.message };
      throw error;
    }
  }

  window.AIVideoPricing = { loadPricing, normalizePricing };
})();
