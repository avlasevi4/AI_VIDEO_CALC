import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pricing = JSON.parse(await readFile(new URL('../data/pricing.json', import.meta.url), 'utf8'));
const billingTypes = new Set(['rate_per_second', 'duration_table', 'duration_curve', 'fixed_generation', 'manual_required']);
const statuses = new Set(['verified', 'manual', 'unverified']);

assert.equal(pricing.schemaVersion, 2, 'Ожидалась schemaVersion 2');
assert.match(pricing.updated, /^\d{4}-\d{2}-\d{2}$/, 'updated должен быть датой YYYY-MM-DD');
assert.match(pricing.baseTariffDate, /^\d{4}-\d{2}-\d{2}$/, 'baseTariffDate должен быть датой YYYY-MM-DD');
assert.ok(pricing.providers && typeof pricing.providers === 'object', 'providers обязателен');
assert.ok(Array.isArray(pricing.models) && pricing.models.length > 0, 'models не должен быть пустым');

const modelIds = new Set();
for (const [providerId, provider] of Object.entries(pricing.providers)) {
  assert.ok(provider.name, `providers.${providerId}.name обязателен`);
  assert.ok(['credits', 'tokens'].includes(provider.unit), `Некорректная единица ${providerId}`);
  assert.ok(provider.package?.price > 0 && provider.package?.units > 0, `Некорректный пакет ${providerId}`);
  assert.ok(statuses.has(provider.status), `Некорректный статус провайдера ${providerId}`);
}

for (const model of pricing.models) {
  assert.ok(model.id && !modelIds.has(model.id), `Неуникальный model.id: ${model.id}`);
  modelIds.add(model.id);
  assert.ok(pricing.providers[model.provider], `Неизвестный provider у ${model.id}`);
  assert.ok(statuses.has(model.status), `Некорректный статус модели ${model.id}`);
  assert.ok(Array.isArray(model.variants) && model.variants.length, `Нет variants у ${model.id}`);

  const variantIds = new Set();
  for (const variant of model.variants) {
    assert.ok(variant.id && !variantIds.has(variant.id), `Неуникальный variant.id ${model.id}/${variant.id}`);
    variantIds.add(variant.id);
    assert.ok(variant.label, `Нет label у ${model.id}/${variant.id}`);
    assert.ok(billingTypes.has(variant.billing?.type), `Неизвестный billing.type у ${model.id}/${variant.id}`);
    const status = variant.status || model.status;
    assert.ok(statuses.has(status), `Некорректный статус ${model.id}/${variant.id}`);

    if (variant.billing.type === 'rate_per_second') assert.ok(variant.billing.unitsPerSecond > 0, `Нет unitsPerSecond у ${model.id}/${variant.id}`);
    if (variant.billing.type === 'fixed_generation') assert.ok(variant.billing.units > 0, `Нет units у ${model.id}/${variant.id}`);
    if (variant.billing.type === 'duration_table') assert.ok(Object.keys(variant.billing.unitsByDuration || {}).length, `Пустая duration table у ${model.id}/${variant.id}`);
    if (variant.billing.type === 'duration_curve') assert.ok(Object.keys(variant.billing.unitsByDuration || {}).length >= 2, `Недостаточно точек duration curve у ${model.id}/${variant.id}`);
    assert.ok(variant.billing.allowedDurations?.length || variant.billing.durationRange, `Не задана длительность у ${model.id}/${variant.id}`);
  }
}

const kling30 = pricing.models.find(model => model.id === 'kling-30');
assert.ok(kling30, 'Kling 3.0 отсутствует');
const expectedKlingRates = { '720-na': 6, '1080-na': 8, '720-a': 9, '1080-a': 12 };
for (const [variantId, rate] of Object.entries(expectedKlingRates)) {
  const variant = kling30.variants.find(item => item.id === variantId);
  assert.equal(variant?.billing?.unitsPerSecond, rate, `Изменилась контрольная ставка Kling 3.0 ${variantId}`);
  assert.equal(variant?.status, 'verified', `Контрольная ставка Kling 3.0 ${variantId} должна быть verified`);
}

assert.equal(pricing.providers.kling.package.price, 8.8, 'Kling Standard должен стоить 8,80 USD при ежемесячном продлении');
assert.equal(pricing.providers.kling.package.units, 660, 'Kling Standard должен содержать 660 credits');
assert.equal(pricing.providers.syntex.package.price, 1690, 'SYNTX Pro должен стоить 1 690 ₽ в месяц');
assert.equal(pricing.providers.syntex.package.units, 680, 'SYNTX Pro должен содержать 680 токенов');
assert.equal(pricing.providers['dreamina-plus'].package.price, 100, 'Dreamina Plus должен стоить 100 ₽');
assert.equal(pricing.providers['dreamina-plus'].package.units, 10500, 'В пакете Dreamina Plus должно быть 10 500 токенов');
assert.equal(pricing.providers.dreamina.package.price, 15, 'Dreamina Basic должен стоить 15 USD');
assert.equal(pricing.providers.dreamina.package.units, 1575, 'Dreamina Basic должен содержать 1 575 кредитов');

const expectedDreaminaRates = {
  'dreamina-seedance-20-mini': { '720p': 12 },
  'dreamina-seedance-20-fast': { '720p': 14 },
  'dreamina-seedance-20': { '720p': 17, '1080p': 41, '4k': 78 },
  'dreamina-seedance-25': {
    '480p': 17,
    '720p': 37,
    '1080p': 91,
    'omni-reference-480p': 28,
    'omni-reference-720p': 74,
    'omni-reference-1080p': 546
  }
};
for (const [modelId, variants] of Object.entries(expectedDreaminaRates)) {
  for (const provider of ['dreamina', 'dreamina-plus']) {
    const effectiveId = provider === 'dreamina' ? modelId : modelId.replace('dreamina-', 'dreamina-plus-');
    const model = pricing.models.find(item => item.id === effectiveId && item.provider === provider);
    assert.ok(model, `Отсутствует модель ${effectiveId}`);
    for (const [variantId, rate] of Object.entries(variants)) {
      const variant = model.variants.find(item => item.id === variantId);
      assert.equal(variant?.billing?.unitsPerSecond, rate, `Неверный тариф ${effectiveId}/${variantId}`);
    }
  }
}

console.log(`pricing.json OK: ${pricing.models.length} моделей, ${pricing.updated}`);
