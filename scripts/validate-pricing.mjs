import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pricing = JSON.parse(await readFile(new URL('../data/pricing.json', import.meta.url), 'utf8'));
const billingTypes = new Set(['rate_per_second', 'duration_table', 'fixed_generation', 'manual_required']);
const statuses = new Set(['verified', 'manual', 'unverified']);

assert.equal(pricing.schemaVersion, 2, 'Ожидалась schemaVersion 2');
assert.match(pricing.updated, /^\d{4}-\d{2}-\d{2}$/, 'updated должен быть датой YYYY-MM-DD');
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

assert.equal(pricing.providers.kling.package.price, 10, 'Изменился ручной пакет Kling из v1.2');
assert.equal(pricing.providers.kling.package.units, 660, 'Изменилось число credits Kling из v1.2');
assert.equal(pricing.providers.syntex.package.price, 1690, 'Изменился ручной пакет SYNTX из v1.2');
assert.equal(pricing.providers.syntex.package.units, 680, 'Изменилось число tokens SYNTX из v1.2');

console.log(`pricing.json OK: ${pricing.models.length} моделей, ${pricing.updated}`);
