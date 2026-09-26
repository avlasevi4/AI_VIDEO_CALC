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
const defaults = { laborPerVideoRub: 250 };

const first = store.createProject('  Ведущий   Попков — 25.08.2026  ', defaults, { id: 'line-1', qty: 2, generationsPerVideo: 3 });
assert.equal(first.name, 'Ведущий Попков — 25.08.2026');
assert.equal(first.items.length, 1);
assert.equal(first.items[0].generationsPerVideo, 3);
assert.equal(first.status, 'active');
assert.equal(first.completedAt, null);

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

store.setScope('owner');
memory.set(store.STORAGE_KEY, JSON.stringify({
  schemaVersion: 4,
  activeProjectId: 'legacy-project',
  projects: [{
    id: 'legacy-project',
    name: 'Старая процентная смета',
    items: [{ id: 'line-old', qty: 2, extraQty: 3, modelId: 'model-kept' }],
    meta: { retryPercent: 30, deliverableVideos: 7, laborPerVideoRub: 900 },
    actualItems: [{ id: 'actual-kept', rub: 123 }]
  }]
}));
const migrated = store.load(defaults);
assert.equal(migrated.schemaVersion, 7);
assert.equal(migrated.projects[0].items[0].generationsPerVideo, 3);
assert.equal('extraQty' in migrated.projects[0].items[0], false);
assert.equal('retryPercent' in migrated.projects[0].meta, false);
assert.equal('deliverableVideos' in migrated.projects[0].meta, false);
assert.equal(migrated.projects[0].items[0].modelId, 'model-kept');
assert.equal(migrated.projects[0].meta.laborPerVideoRub, 900);
assert.equal(migrated.projects[0].actualItems[0].id, 'actual-kept');
assert.equal(migrated.projects[0].actualItems[0].rub, 123);
assert.equal(migrated.projects[0].status, 'active');
assert.equal(migrated.projects[0].completedAt, null);

store.setScope('guest');
assert.equal(store.load(defaults).projects.length, 0, 'guest projects are isolated from the owner cache');
const guest = store.createProject('Гостевой проект', defaults);
store.save([guest], guest.id);
store.setScope('owner');
assert.equal(store.load(defaults).projects[0].id, 'legacy-project', 'owner cache remains intact after guest saves');

const completed = store.normalizeProject({
  id: 'completed-project',
  name: 'Завершённый',
  status: 'completed',
  completedAt: '2026-08-20T18:00:00.000Z',
  items: [{ id: 'line-complete', qty: 6, generationsPerVideo: 3 }],
  meta: { laborPerVideoRub: 250 },
  actualItems: [{ id: 'actual-complete', rub: 500 }]
}, defaults);
assert.equal(completed.status, 'completed');
assert.equal(completed.completedAt, '2026-08-20T18:00:00.000Z');
assert.equal(completed.items[0].qty, 6);
assert.equal(completed.actualItems[0].rub, 500);

store.save([completed], '');
const closedLibrary = store.load(defaults);
assert.equal(closedLibrary.activeProjectId, '');

const deleted = { ...completed, deletedAt: '2026-09-08T12:00:00.000Z' };
store.save([deleted], deleted.id);
const deletedLibrary = store.load(defaults);
assert.equal(deletedLibrary.activeProjectId, '');
assert.equal(deletedLibrary.projects[0].deletedAt, deleted.deletedAt);
assert.equal(deletedLibrary.projects[0].actualItems[0].rub, 500);

const syncStart = [{
  id: 'race-project',
  name: 'Гонка синхронизации',
  updatedAt: '2026-09-26T10:00:00.000Z',
  actualItems: [{ id: 'original' }]
}, {
  id: 'unchanged-project',
  name: 'До синхронизации',
  updatedAt: '2026-09-26T10:00:00.000Z',
  actualItems: []
}];
const currentDuringSync = [{
  ...syncStart[0],
  updatedAt: '2026-09-26T10:00:01.000Z',
  actualItems: [{ id: 'original' }, { id: 'repeat-1' }, { id: 'repeat-2' }]
}, syncStart[1], {
  id: 'created-during-sync',
  name: 'Новый локальный проект',
  updatedAt: '2026-09-26T10:00:01.000Z',
  actualItems: []
}];
const staleCloudResult = [{
  ...syncStart[0],
  actualItems: [{ id: 'original' }]
}, {
  ...syncStart[1],
  name: 'Обновлено в облаке',
  updatedAt: '2026-09-26T10:00:02.000+00:00'
}];
const reconciled = store.reconcileCloudProjects(
  currentDuringSync,
  staleCloudResult,
  { 'race-project': 0, 'unchanged-project': 0 },
  { 'race-project': 2, 'unchanged-project': 0, 'created-during-sync': 1 }
);
assert.equal(reconciled.find(project => project.id === 'race-project').actualItems.length, 3, 'late cloud response cannot remove two repeated generations');
assert.equal(reconciled.find(project => project.id === 'unchanged-project').name, 'Обновлено в облаке', 'unchanged project accepts a newer cloud copy');
assert.ok(reconciled.some(project => project.id === 'created-during-sync'), 'project created during synchronization is preserved');

assert.equal(store.cloudProjectResponseWins(
  { updatedAt: '2026-09-26T10:00:00.000Z', status: 'active', completedAt: null },
  { updatedAt: '2026-09-26T10:00:00.000+00:00', status: 'active', completedAt: null }
), false, 'equivalent timestamp formats do not make the cloud response newer');
assert.equal(store.cloudProjectResponseWins(
  { updatedAt: '2026-09-26T10:00:00.000Z', status: 'active', completedAt: null },
  { updatedAt: '2026-09-26T10:00:01.000Z', status: 'active', completedAt: null }
), true, 'a genuinely newer cloud response wins');
console.log('project store tests OK');
