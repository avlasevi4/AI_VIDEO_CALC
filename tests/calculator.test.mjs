import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window = {};
await import('../js/calculator.js');
const calc = globalThis.window.AIVideoCalculator;

assert.equal(calc.billableUnits({ type: 'rate_per_second', unitsPerSecond: 8 }, 5), 40);
assert.equal(calc.billableUnits({ type: 'duration_table', unitsByDuration: { 5: 17, 10: 31 } }, 10), 31);
assert.equal(calc.billableUnits({ type: 'fixed_generation', units: 24 }, 99), 24);
assert.equal(calc.billableUnits({ type: 'manual_required' }, 5, 13.5), 13.5);
assert.throws(() => calc.billableUnits({ type: 'manual_required' }, 5, 0), /Укажите расход/);

const pricing = JSON.parse(await readFile(new URL('../data/pricing.json', import.meta.url), 'utf8'));
const settings = {
  usdRub: 75,
  klingPackageUsd: 10,
  klingPackageCredits: 660,
  syntexPackageRub: 1690,
  syntexPackageTokens: 680
};

const kling = calc.calculateSelection(pricing, settings, 'kling-30', '1080-na', 5);
assert.equal(kling.units, 40);
assert.ok(Math.abs(kling.usd - (40 * 10 / 660)) < 1e-12);
assert.ok(Math.abs(kling.rub - (40 * 10 / 660 * 75)) < 1e-12);

const manualRateSettings = {
  ...settings,
  manualRubTariffs: {
    'syntx-seedance-25::omni-reference-720': {
      pricePerSecond: 30,
      sourceDuration: 10,
      sourceRub: 300
    }
  }
};
const manualRate = calc.calculateSelection(pricing, manualRateSettings, 'syntx-seedance-25', 'omni-reference-720', 15);
assert.equal(manualRate.pricingMode, 'manual_rub_per_second');
assert.equal(manualRate.manualRubPerSecond, 30);
assert.equal(manualRate.units, 0);
assert.equal(manualRate.rub, 450);

const project = calc.calculateProject([
  { rub: 100, qty: 6, generationsPerVideo: 3 }
], { laborPerVideoRub: 250 });
assert.equal(project.base, 600);
assert.equal(project.reserve, 1200);
assert.equal(project.estimateCost, 1800);
assert.equal(project.plannedGenerations, 6);
assert.equal(project.extraGenerations, 12);
assert.equal(project.totalGenerations, 18);
assert.equal(project.readyVideos, 6);
assert.equal(project.laborCost, 1500);
assert.equal(project.quotedPrice, 3300);

const customPrice = calc.calculateProject([
  { rub: 100, qty: 6, generationsPerVideo: 3 }
], { laborPerVideoRub: 250, priceMode: 'custom', customQuotedPrice: 3333, priceRounding: 'up' });
assert.equal(customPrice.calculatedPrice, 3300);
assert.equal(customPrice.priceBeforeRounding, 3333);
assert.equal(customPrice.quotedPrice, 3400);
assert.equal(customPrice.actualProfit, 3400);

const roundedDown = calc.calculateProject([
  { rub: 100, qty: 1, generationsPerVideo: 1 }
], { laborPerVideoRub: 250, priceRounding: 'down' });
assert.equal(roundedDown.quotedPrice, 300);

console.log('calculator tests OK');
