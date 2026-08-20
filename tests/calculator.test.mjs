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

const project = calc.calculateProject([
  { rub: 100, qty: 2 },
  { rub: 50, qty: 3 }
], { retryPercent: 30 });
assert.equal(project.base, 350);
assert.equal(project.reserve, 105);
assert.equal(project.estimateCost, 455);
assert.equal(project.plannedGenerations, 5);

console.log('calculator tests OK');
