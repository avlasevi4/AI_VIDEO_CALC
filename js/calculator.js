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

    throw new Error('Не поддерживается цена единицы провайдера');
  }

  function billableUnits(billing, duration, manualUnits) {
    const d = safeNumber(duration, 5);
    switch (billing.type) {
      case 'rate_per_second':
        return safeNumber(billing.unitsPerSecond) * d;
      case 'duration_table': {
        const key = String(d);
        if (!(key in billing.unitsByDuration)) throw new Error('Для этой длительности нет тарифа');
        return safeNumber(billing.unitsByDuration[key]);
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
    const units = billableUnits(variant.billing, duration, manualUnits);
    const unitRub = unitPriceRub(model.provider, settings, pricing);
    const rub = units * unitRub;
    const usd = model.provider === 'kling' ? rub / safeNumber(settings.usdRub, 75.05) : null;
    return { model, variant, duration: safeNumber(duration, 5), units, unitRub, rub, usd, manualUnits: safeNumber(manualUnits, 0) };
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
