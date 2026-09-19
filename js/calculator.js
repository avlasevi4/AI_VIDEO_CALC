(function () {
  'use strict';

  function safeNumber(value, fallback = 0) {
    const n = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : fallback;
  }

  function unitPriceRub(providerId, settings, pricing) {
    const provider = pricing.providers[providerId];
    if (!provider) throw new Error('Неизвестный провайдер');

    if (providerId === 'kling') {
      const usd = safeNumber(settings.klingPackageUsd, provider.package.price);
      const units = Math.max(1, safeNumber(settings.klingPackageCredits, provider.package.units));
      return (usd / units) * safeNumber(settings.usdRub, 75.05);
    }

    if (providerId === 'syntex') {
      const rub = safeNumber(settings.syntexPackageRub, provider.package.price);
      const units = Math.max(1, safeNumber(settings.syntexPackageTokens, provider.package.units));
      return rub / units;
    }

    if (providerId === 'dreamina') {
      const usd = safeNumber(settings.dreaminaPackageUsd, provider.package.price);
      const units = Math.max(1, safeNumber(settings.dreaminaPackageTokens, provider.package.units));
      return (usd / units) * safeNumber(settings.usdRub, 75.05);
    }

    if (providerId === 'dreamina-plus') {
      return safeNumber(provider.package.price, 100) / Math.max(1, safeNumber(provider.package.units, 10500));
    }

    throw new Error('Не поддерживается цена единицы провайдера');
  }

  function billableUnits(billing, duration, manualUnits) {
    const d = safeNumber(duration, 5);
    switch (billing.type) {
      case 'rate_per_second':
        {
          const units = safeNumber(billing.unitsPerSecond) * d;
          if (billing.roundDigits == null) return units;
          const precision = Math.max(0, Math.min(4, Math.round(safeNumber(billing.roundDigits, 1))));
          const factor = 10 ** precision;
          return Math.round((units + Number.EPSILON) * factor) / factor;
        }
      case 'duration_table': {
        const key = String(d);
        if (!(key in billing.unitsByDuration)) throw new Error('Для этой длительности нет тарифа');
        return safeNumber(billing.unitsByDuration[key]);
      }
      case 'duration_curve': {
        const points = Object.entries(billing.unitsByDuration || {})
          .map(([seconds, units]) => [safeNumber(seconds), safeNumber(units)])
          .filter(([seconds, units]) => seconds > 0 && units > 0)
          .sort((a, b) => a[0] - b[0]);
        const exact = points.find(([seconds]) => seconds === d);
        if (exact) return exact[1];
        const lower = [...points].reverse().find(([seconds]) => seconds < d);
        const upper = points.find(([seconds]) => seconds > d);
        if (!lower || !upper) throw new Error('Для этой длительности нет тарифа');
        const interpolated = lower[1] + ((d - lower[0]) / (upper[0] - lower[0])) * (upper[1] - lower[1]);
        const precision = Math.max(0, Math.min(4, Math.round(safeNumber(billing.roundDigits, 1))));
        const factor = 10 ** precision;
        return Math.round((interpolated + Number.EPSILON) * factor) / factor;
      }
      case 'fixed_generation':
        return safeNumber(billing.units);
      case 'manual_required': {
        const units = safeNumber(manualUnits, 0);
        if (!(units > 0)) throw new Error('Для этой модели тариф пока не внесён. Укажите расход токенов за выбранную генерацию.');
        return units;
      }
      default:
        throw new Error('Неизвестный тип биллинга: ' + billing.type);
    }
  }

  function calculateSelection(pricing, settings, modelId, variantId, duration, manualUnits) {
    const model = pricing.models.find(m => m.id === modelId);
    if (!model) throw new Error('Модель не найдена');
    const variant = model.variants.find(v => v.id === variantId) || model.variants[0];
    const tariffKey = `${model.id}::${variant.id}`;
    const storedTariff = settings.manualTokenTariffs?.[tariffKey];
    const manualTokensPerSecond = Math.max(0, safeNumber(typeof storedTariff === 'object' ? storedTariff?.unitsPerSecond : storedTariff, 0));
    const normalizedDuration = safeNumber(duration, 5);
    const manualDurationUnits = Math.max(0, safeNumber(storedTariff?.unitsByDuration?.[String(normalizedDuration)], 0));
    if (model.provider === 'syntex' && manualDurationUnits > 0) {
      const unitRub = unitPriceRub(model.provider, settings, pricing);
      return {
        model,
        variant,
        duration: normalizedDuration,
        units: manualDurationUnits,
        unitRub,
        rub: manualDurationUnits * unitRub,
        usd: null,
        manualUnits: safeNumber(manualUnits, 0),
        pricingMode: 'manual_duration_override'
      };
    }
    if (model.provider === 'syntex' && variant.billing.type === 'manual_required' && manualTokensPerSecond > 0) {
      const units = manualTokensPerSecond * normalizedDuration;
      const unitRub = unitPriceRub(model.provider, settings, pricing);
      const rub = units * unitRub;
      return {
        model,
        variant,
        duration: normalizedDuration,
        units,
        unitRub,
        rub,
        usd: null,
        manualUnits: safeNumber(manualUnits, 0),
        pricingMode: 'manual_tokens_per_second',
        manualTokensPerSecond
      };
    }
    const units = billableUnits(variant.billing, duration, manualUnits);
    const unitRub = unitPriceRub(model.provider, settings, pricing);
    const rub = units * unitRub;
    const usd = ['kling', 'dreamina'].includes(model.provider) ? rub / safeNumber(settings.usdRub, 75.05) : null;
    return { model, variant, duration: normalizedDuration, units, unitRub, rub, usd, manualUnits: safeNumber(manualUnits, 0), pricingMode: 'provider_units' };
  }

  function calculateProject(items, meta = {}, actualItems = []) {
    const normalized = items.map(item => ({
      ...item,
      qty: Math.max(1, Math.round(safeNumber(item.qty, 1))),
      generationsPerVideo: Math.max(1, Math.min(30, Math.round(safeNumber(item.generationsPerVideo ?? item.extraQty, 1)))),
      rub: Math.max(0, safeNumber(item.rub, 0))
    }));

    const base = normalized.reduce((sum, item) => sum + item.rub * item.qty, 0);
    const plannedGenerations = normalized.reduce((sum, item) => sum + item.qty, 0);
    const extraGenerations = normalized.reduce((sum, item) => sum + item.qty * (item.generationsPerVideo - 1), 0);
    const totalGenerations = normalized.reduce((sum, item) => sum + item.qty * item.generationsPerVideo, 0);
    const reserve = normalized.reduce((sum, item) => sum + item.rub * item.qty * (item.generationsPerVideo - 1), 0);

    const includeImages = Boolean(meta.includeImages);
    const plannedImages = includeImages ? Math.max(0, Math.round(safeNumber(meta.plannedImages, 0))) : 0;
    const actualImages = includeImages ? Math.max(0, Math.round(safeNumber(meta.actualImages, 0))) : 0;
    const imageUnitRub = Math.max(0, safeNumber(meta.imageUnitRub, 5));
    const plannedImageCost = plannedImages * imageUnitRub;
    const actualImageCost = actualImages * imageUnitRub;

    const videoEstimate = base + reserve;
    const estimateCost = videoEstimate + plannedImageCost;
    const readyVideos = plannedGenerations;
    const laborPerVideoRub = Math.max(0, safeNumber(meta.laborPerVideoRub, 250));
    const laborCost = readyVideos * laborPerVideoRub;
    const calculatedPrice = estimateCost + laborCost;
    const priceMode = meta.priceMode === 'custom' ? 'custom' : 'calculated';
    const customQuotedPrice = Math.max(0, safeNumber(meta.customQuotedPrice, 0));
    const priceBeforeRounding = priceMode === 'custom' && customQuotedPrice > 0 ? customQuotedPrice : calculatedPrice;
    const priceRounding = ['up', 'down'].includes(meta.priceRounding) ? meta.priceRounding : 'none';
    const quotedPrice = priceRounding === 'up'
      ? Math.ceil(priceBeforeRounding / 100) * 100
      : priceRounding === 'down'
        ? Math.floor(priceBeforeRounding / 100) * 100
        : priceBeforeRounding;

    const actualVideoCost = actualItems.reduce((sum, item) => sum + Math.max(0, safeNumber(item.rub, 0)), 0);
    const actualVideoGenerations = actualItems.length;
    const actualCost = actualVideoCost + actualImageCost;
    const variance = actualCost - estimateCost;
    const actualProfit = quotedPrice - actualCost;

    return {
      base,
      reserve,
      videoEstimate,
      estimateCost,
      plannedGenerations,
      extraGenerations,
      totalGenerations,
      includeImages,
      plannedImages,
      actualImages,
      imageUnitRub,
      plannedImageCost,
      actualImageCost,
      readyVideos,
      laborPerVideoRub,
      laborCost,
      calculatedPrice,
      priceMode,
      customQuotedPrice,
      priceBeforeRounding,
      priceRounding,
      quotedPrice,
      actualVideoCost,
      actualVideoGenerations,
      actualCost,
      variance,
      plannedProfit: laborCost,
      actualProfit
    };
  }

  window.AIVideoCalculator = { safeNumber, unitPriceRub, billableUnits, calculateSelection, calculateProject };
})();
