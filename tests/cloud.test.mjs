import assert from 'node:assert/strict';

const rows = [];
const allowedUser = { id: 'ee7d2005-b775-46a0-835a-3974563eb597', email: 'owner@example.com' };
let authListener = null;

const client = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: callback => { authListener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    signInWithPassword: async ({ email }) => {
      const user = email === allowedUser.email
        ? { ...allowedUser }
        : { id: '18d639ee-df0d-4c6d-8965-6fc574d19b42', email };
      return { data: { user, session: { user } }, error: null };
    },
    signOut: async () => ({ error: null })
  },
  from() {
    return {
      update(row) {
        return { eq: (_field, id) => ({ is: () => ({ select: async () => {
          const index = rows.findIndex(item => item.id === id && !item.payload.deletedAt);
          if (index < 0) return { data: [], error: null };
          rows[index] = row;
          return { data: [row], error: null };
        } }) }) };
      },
      select() {
        return {
          order: async () => ({ data: rows.map(row => ({ ...row })), error: null }),
          eq: (_field, id) => ({ maybeSingle: async () => ({ data: rows.find(row => row.id === id) || null, error: null }) })
        };
      },
      async upsert(row) {
        const index = rows.findIndex(item => item.id === row.id);
        if (index >= 0) rows[index] = row;
        else rows.push(row);
        return { error: null };
      },
      delete() {
        return {
          eq: async (_field, id) => {
            const index = rows.findIndex(item => item.id === id);
            if (index >= 0) rows.splice(index, 1);
            return { error: null };
          }
        };
      }
    };
  }
};

globalThis.window = {
  AIVideoCloudConfig: {
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'publishable-test-key',
    ownerUserId: allowedUser.id
  },
  supabase: { createClient: () => client }
};

await import('../js/cloud.js');
const cloud = globalThis.window.AIVideoCloud;

assert.equal(cloud.isConfigured(), true);
await cloud.init(() => {});
assert.equal(typeof authListener, 'function');
await assert.rejects(() => cloud.signIn('other@example.com', 'password'), /не разрешён/);
await cloud.signIn(allowedUser.email, 'password');

await cloud.saveSettings({ usdRub: 88.25, manualTokenTariffs: { 'seedance::pro': { unitsPerSecond: 12 } } }, '2026-09-09T07:00:00.000Z');
const cloudSettings = await cloud.loadSettings();
assert.equal(cloudSettings.settings.usdRub, 88.25);
assert.equal(cloudSettings.settings.manualTokenTariffs['seedance::pro'].unitsPerSecond, 12);
assert.equal((await cloud.loadProjects()).length, 0, 'tariff record never appears as a project');
const projectRow = () => rows.find(row => row.id === 'project-1');

await cloud.saveProject({
  id: 'project-1',
  name: 'Тест',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T01:00:00.000Z',
  status: 'completed',
  completedAt: '2026-08-20T02:00:00.000Z',
  items: [{ id: 'line-1', qty: 2, generationsPerVideo: 3 }],
  meta: { laborPerVideoRub: 250 },
  actualItems: []
});
assert.equal(projectRow().user_id, allowedUser.id);
assert.equal(projectRow().payload.status, 'completed');
assert.equal(projectRow().payload.completedAt, '2026-08-20T02:00:00.000Z');

const loaded = await cloud.loadProjects();
await cloud.saveProject({ ...loaded[0], name: 'Обновлённый тест' });
assert.equal(projectRow().name, 'Обновлённый тест');
assert.equal(loaded[0].name, 'Тест');
assert.equal(loaded[0].items[0].generationsPerVideo, 3);
assert.equal(loaded[0].status, 'completed');
assert.equal(loaded[0].completedAt, '2026-08-20T02:00:00.000Z');

await cloud.deleteProject('project-1');
assert.equal(rows.filter(row => row.id === 'project-1').length, 1, 'keep a deletion record for other devices');
assert.ok(projectRow().payload.deletedAt);
const staleDevice = { ...loaded[0], updatedAt: '2099-01-01T00:00:00.000Z' };
const merged = await cloud.synchronize([staleDevice]);
assert.ok(merged[0].deletedAt, 'deletion wins even against a clock-ahead stale device');
await cloud.saveProject(staleDevice);
assert.ok(projectRow().payload.deletedAt, 'autosave from an open editor cannot resurrect a deleted project');
rows.length = 0;
await cloud.synchronize(merged);
assert.ok(projectRow().payload.deletedAt, 'offline deletion uploads when reconnecting');

console.log('cloud adapter tests OK');
