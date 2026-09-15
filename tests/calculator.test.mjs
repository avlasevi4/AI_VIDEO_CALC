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
  syntexPackageTokens: 680,
  dreaminaPackageUsd: 11,
  dreaminaPackageTokens: 3885
};

const kling = calc.calculateSelection(pricing, settings, 'kling-30', '1080-na', 5);
assert.equal(kling.units, 40);
assert.ok(Math.abs(kling.usd - (40 * 10 / 660)) < 1e-12);
assert.ok(Math.abs(kling.rub - (40 * 10 / 660 * 75)) < 1e-12);

const dreamina = calc.calculateSelection(pricing, settings, 'dreamina-seedance-25', '720p', 5);
assert.equal(dreamina.units, 185);
assert.ok(Math.abs(dreamina.usd - (185 * 11 / 3885)) < 1e-12);
assert.ok(Math.abs(dreamina.rub - (185 * 11 / 3885 * 75)) < 1e-12);

const dreaminaPlus = calc.calculateSelection(pricing, settings, 'dreamina-plus-seedance-25', '1080p', 30);
assert.equal(dreaminaPlus.units, 2730);
assert.equal(dreaminaPlus.usd, null);
assert.ok(Math.abs(dreaminaPlus.unitRub - (100 / 10500)) < 1e-12);
assert.ok(Math.abs(dreaminaPlus.rub - 26) < 1e-12);

const omni480 = calc.calculateSelection(pricing, settings, 'dreamina-plus-seedance-25', 'omni-reference-480p', 30);
const omni720 = calc.calculateSelection(pricing, settings, 'dreamina-plus-seedance-25', 'omni-reference-720p', 30);
const omni1080 = calc.calculateSelection(pricing, settings, 'dreamina-plus-seedance-25', 'omni-reference-1080p', 6);
assert.equal(omni480.units, 840);
assert.equal(omni720.units, 2220);
assert.equal(omni1080.units, 3276);
assert.ok(Math.abs(omni480.rub - 8) < 1e-12);
assert.ok(Math.abs(omni720.rub - (2220 * 100 / 10500)) < 1e-12);
assert.ok(Math.abs(omni1080.rub - 31.2) < 1e-12);

const manualRateSettings = {
  ...settings,
  manualTokenTariffs: {
    'syntx-seedance-25::omni-reference-720': {
      unitsPerSecond: 30,
      sourceDuration: 10,
      sourceUnits: 300
    }
  }
};
const manualRate = calc.calculateSelection(pricing, manualRateSettings, 'syntx-seedance-25', 'omni-reference-720', 15);
assert.equal(manualRate.pricingMode, 'manual_tokens_per_second');
assert.equal(manualRate.manualTokensPerSecond, 30);
assert.equal(manualRate.units, 450);
assert.equal(manualRate.rub, 450 * (1690 / 680));

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
