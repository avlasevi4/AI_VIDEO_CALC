(function () {
  'use strict';

  let client = null;
  let session = null;

  function config() {
    return window.AIVideoCloudConfig || {};
  }

  function isConfigured() {
    const value = config();
    return Boolean(value.supabaseUrl && value.supabasePublishableKey && value.ownerUserId && window.supabase?.createClient);
  }

  function isAllowedUser(user) {
    const ownerUserId = String(config().ownerUserId || '').trim().toLowerCase();
    return Boolean(user?.id && ownerUserId && user.id.toLowerCase() === ownerUserId);
  }

  async function init(onAuthChange) {
    if (!isConfigured()) return { configured: false, session: null };
    client = window.supabase.createClient(config().supabaseUrl, config().supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    session = data.session && isAllowedUser(data.session.user) ? data.session : null;
    if (data.session && !session) await client.auth.signOut();

    client.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession && isAllowedUser(nextSession.user) ? nextSession : null;
      if (nextSession && !session) client.auth.signOut();
      if (typeof onAuthChange === 'function') onAuthChange(session);
    });
    return { configured: true, session };
  }

  async function signIn(email, password) {
    if (!client) throw new Error('Облачное хранилище пока не настроено.');
    const { data, error } = await client.auth.signInWithPassword({ email: String(email).trim(), password });
    if (error) throw error;
    if (!isAllowedUser(data.user)) {
      await client.auth.signOut();
      throw new Error('Для этого аккаунта доступ к проектам не разрешён.');
    }
    session = data.session;
    return session;
  }

  async function signOut() {
    if (client) await client.auth.signOut();
    session = null;
  }

  function requireSession() {
    if (!client || !session || !isAllowedUser(session.user)) throw new Error('Войдите в разрешённый аккаунт.');
    return session;
  }

  function fromRow(row) {
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items: row.payload?.items || [],
      meta: row.payload?.meta || {},
      actualItems: row.payload?.actualItems || []
    };
  }

  async function loadProjects() {
    requireSession();
    const { data, error } = await client.from('projects').select('id,name,payload,created_at,updated_at').order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(fromRow);
  }

  async function saveProject(project) {
    const current = requireSession();
    const row = {
      id: project.id,
      user_id: current.user.id,
      name: project.name,
      payload: { items: project.items || [], meta: project.meta || {}, actualItems: project.actualItems || [] },
      created_at: project.createdAt,
      updated_at: project.updatedAt
    };
    const { error } = await client.from('projects').upsert(row, { onConflict: 'id' });
    if (error) throw error;
  }

  async function deleteProject(id) {
    requireSession();
    const { error } = await client.from('projects').delete().eq('id', id);
    if (error) throw error;
  }

  async function synchronize(localProjects) {
    const remoteProjects = await loadProjects();
    const remoteById = new Map(remoteProjects.map(project => [project.id, project]));
    const merged = [];

    for (const local of localProjects) {
      const remote = remoteById.get(local.id);
      if (!remote || new Date(local.updatedAt) >= new Date(remote.updatedAt)) {
        await saveProject(local);
        merged.push(local);
      } else {
        merged.push(remote);
      }
      remoteById.delete(local.id);
    }

    merged.push(...remoteById.values());
    return merged.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  window.AIVideoCloud = {
    isConfigured,
    isAllowedUser,
    init,
    signIn,
    signOut,
    loadProjects,
    saveProject,
    deleteProject,
    synchronize,
    getSession: () => session
  };
})();
