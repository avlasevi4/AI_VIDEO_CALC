import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/pricing.js', import.meta.url), 'utf8');
const context = {
  window: {},
  localStorage: {
    getItem() { return null; },
    setItem() {}
  },
  fetch() { throw new Error('network is not used in this test'); },
  Set,
  Number,
  Array,
  JSON,
  Date,
  Error
};
vm.runInNewContext(source, context);

const stalePricing = {
  models: ['dreamina-seedance-25', 'dreamina-plus-seedance-25'].map(id => ({
    id,
    variants: [
      '480p',
      '720p',
      '1080p',
      'omni-reference-480p',
      'omni-reference-720p',
      'omni-reference-1080p'
    ].map(variantId => ({
      id: variantId,
      billing: { type: 'rate_per_second', durationRange: { min: 5, max: 30, step: 1 } }
    }))
  }))
};

const migrated = context.window.AIVideoPricing.normalizePricing(stalePricing);
for (const model of migrated.models) {
  for (const variant of model.variants) {
    assert.equal(variant.billing.durationRange.min, 4, `${model.id}/${variant.id} migrates from 5 to 4 seconds`);
  }
}

const unrelated = { models: [{ id: 'other-model', variants: [{ id: '720p', billing: { durationRange: { min: 5, max: 10, step: 1 } } }] }] };
context.window.AIVideoPricing.normalizePricing(unrelated);
assert.equal(unrelated.models[0].variants[0].billing.durationRange.min, 5, 'unrelated models keep their own duration limits');

console.log('pricing cache migration tests passed');
