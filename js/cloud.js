(function () {
  'use strict';

  let client = null;
  let session = null;
  const SETTINGS_ID = '__ai_video_calc_shared_tariffs__';

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
      deletedAt: row.payload?.deletedAt || null,
      status: row.payload?.status === 'completed' ? 'completed' : 'active',
      completedAt: row.payload?.completedAt || null,
      items: row.payload?.items || [],
      meta: row.payload?.meta || {},
      actualItems: row.payload?.actualItems || []
    };
  }

  async function loadProjects() {
    requireSession();
    const { data, error } = await client.from('projects').select('id,name,payload,created_at,updated_at').order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).filter(row => row.id !== SETTINGS_ID).map(fromRow);
  }

  async function loadSettings() {
    requireSession();
    const { data, error } = await client.from('projects').select('id,payload,created_at,updated_at')
      .eq('id', SETTINGS_ID).maybeSingle();
    if (error) throw error;
    if (!data?.payload || data.payload.kind !== 'shared_tariffs') return null;
    return { settings: data.payload.settings || {}, createdAt: data.created_at || null, updatedAt: data.updated_at || null };
  }

  async function saveSettings(settings, updatedAt = new Date().toISOString()) {
    const current = requireSession();
    const existing = await loadSettings();
    const row = {
      id: SETTINGS_ID,
      user_id: current.user.id,
      name: 'Системные тарифы AI VIDEO CALC',
      payload: { kind: 'shared_tariffs', settings: settings || {} },
      created_at: existing?.createdAt || updatedAt,
      updated_at: updatedAt
    };
    const { error } = await client.from('projects').upsert(row, { onConflict: 'id' });
    if (error) throw error;
    return { settings: row.payload.settings, updatedAt };
  }

  async function saveProject(project) {
    const current = requireSession();
    // Deletion wins over stale open editors, even when their clock is ahead.
    const remote = (await loadProjects()).find(item => item.id === project.id);
    if (remote?.deletedAt && !project.deletedAt) return remote;
    const row = {
      id: project.id,
      user_id: current.user.id,
      name: project.name,
      payload: {
        deletedAt: project.deletedAt || null,
        status: project.status === 'completed' ? 'completed' : 'active',
        completedAt: project.completedAt || null,
        items: project.items || [],
        meta: project.meta || {},
        actualItems: project.actualItems || []
      },
      created_at: project.createdAt,
      updated_at: project.updatedAt
    };
    if (remote && !project.deletedAt) {
      // Atomic predicate closes the gap between reading and writing a deletion.
      const { data, error } = await client.from('projects').update(row).eq('id', project.id)
        .is('payload->>deletedAt', null).select('id,name,payload,created_at,updated_at');
      if (error) throw error;
      if (!data?.length) return (await loadProjects()).find(item => item.id === project.id) || project;
      return fromRow(data[0]);
    }
    const { error } = await client.from('projects').upsert(row, { onConflict: 'id' });
    if (error) throw error;
    return project;
  }

  async function deleteProject(id) {
    requireSession();
    const project = (await loadProjects()).find(item => item.id === id);
    if (!project) return null;
    const deletedAt = new Date().toISOString();
    const tombstone = { ...project, deletedAt, updatedAt: deletedAt };
    await saveProject(tombstone);
    return tombstone;
  }

  async function synchronize(localProjects) {
    const remoteProjects = await loadProjects();
    const remoteById = new Map(remoteProjects.map(project => [project.id, project]));
    const merged = [];

    for (const local of localProjects) {
      const remote = remoteById.get(local.id);
      if (remote?.deletedAt) {
        merged.push(remote);
      } else if (local.deletedAt || !remote || new Date(local.updatedAt) >= new Date(remote.updatedAt)) {
        merged.push(await saveProject(local));
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
    loadSettings,
    saveSettings,
    saveProject,
    deleteProject,
    synchronize,
    getSession: () => session
  };
})();
