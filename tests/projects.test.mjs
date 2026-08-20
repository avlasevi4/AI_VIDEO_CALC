import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = {
  getItem: key => memory.has(key) ? memory.get(key) : null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: key => memory.delete(key)
};
globalThis.window = {};

await import('../js/projects.js');
const store = globalThis.window.AIVideoProjectStore;
const defaults = { retryPercent: 30 };

const first = store.createProject('  Ведущий   Попков — 25.08.2026  ', defaults, { id: 'line-1', qty: 2 });
assert.equal(first.name, 'Ведущий Попков — 25.08.2026');
assert.equal(first.items.length, 1);
assert.equal(first.meta.retryPercent, 30);

store.save([first], first.id);
const loaded = store.load(defaults);
assert.equal(loaded.projects.length, 1);
assert.equal(loaded.activeProjectId, first.id);
assert.equal(loaded.projects[0].name, first.name);

const second = store.createProject('Второй проект', defaults);
store.save([first, second], second.id);
const reloaded = store.load(defaults);
assert.equal(reloaded.projects.length, 2);
assert.equal(reloaded.activeProjectId, second.id);

store.clear();
assert.equal(store.load(defaults).projects.length, 0);

console.log('project store tests OK');
