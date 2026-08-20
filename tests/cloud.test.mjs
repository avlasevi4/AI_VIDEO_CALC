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
      select() {
        return {
          order: async () => ({ data: rows.map(row => ({ ...row })), error: null })
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

await cloud.saveProject({
  id: 'project-1',
  name: 'Тест',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T01:00:00.000Z',
  items: [{ id: 'line-1', qty: 2, extraQty: 1 }],
  meta: { deliverableVideos: 1 },
  actualItems: []
});
assert.equal(rows[0].user_id, allowedUser.id);

const loaded = await cloud.loadProjects();
assert.equal(loaded[0].name, 'Тест');
assert.equal(loaded[0].items[0].extraQty, 1);

await cloud.deleteProject('project-1');
assert.equal(rows.length, 0);

console.log('cloud adapter tests OK');
