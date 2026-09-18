(function () {
  'use strict';

  const STORAGE_KEY = 'ai-video-calc-v2-project-library';
  const GUEST_STORAGE_KEY = 'ai-video-calc-v2-project-library-guest';
  const LEGACY_PROJECT_KEY = 'ai-video-calc-v2-project';
  const LEGACY_META_KEY = 'ai-video-calc-v2-project-meta';
  const LEGACY_ACTUAL_KEY = 'ai-video-calc-v2-actual';
  const SCHEMA_VERSION = 7;
  let storageScope = 'guest';

  const clone = value => JSON.parse(JSON.stringify(value));

  function makeId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'project-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function normalizeName(value, fallback = 'Проект без названия') {
    const name = String(value || '').trim().replace(/\s+/g, ' ');
    return name.slice(0, 120) || fallback;
  }

  function normalizeProject(project, defaultMeta) {
    const now = new Date().toISOString();
    const status = project?.status === 'completed' ? 'completed' : 'active';
    const meta = { ...clone(defaultMeta), ...(project?.meta || {}) };
    delete meta.retryPercent;
    delete meta.retryGenerations;
    delete meta.deliverableVideos;
    return {
      id: String(project?.id || makeId()),
      name: normalizeName(project?.name),
      createdAt: project?.createdAt || now,
      updatedAt: project?.updatedAt || project?.createdAt || now,
      deletedAt: project?.deletedAt || null,
      status,
      completedAt: status === 'completed' ? (project?.completedAt || project?.updatedAt || now) : null,
      reopenedAt: project?.reopenedAt || null,
      items: Array.isArray(project?.items) ? clone(project.items).map(item => {
        const normalized = {
          ...item,
          qty: Math.max(1, Math.round(Number(item.qty) || 1)),
          generationsPerVideo: Math.max(1, Math.min(30, Math.round(Number(item.generationsPerVideo ?? item.extraQty) || 1)))
        };
        delete normalized.extraQty;
        return normalized;
      }) : [],
      meta,
      actualItems: Array.isArray(project?.actualItems) ? clone(project.actualItems) : []
    };
  }

  function createProject(name, defaultMeta, initialItem) {
    const now = new Date().toISOString();
    return normalizeProject({
      id: makeId(),
      name: normalizeName(name),
      createdAt: now,
      updatedAt: now,
      status: 'active',
      completedAt: null,
      reopenedAt: null,
      items: initialItem ? [initialItem] : [],
      meta: defaultMeta,
      actualItems: []
    }, defaultMeta);
  }

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      return parsed == null ? fallback : parsed;
    } catch (_) {
      return fallback;
    }
  }

  function setScope(scope) {
    storageScope = scope === 'owner' ? 'owner' : 'guest';
  }

  function activeStorageKey() {
    return storageScope === 'owner' ? STORAGE_KEY : GUEST_STORAGE_KEY;
  }

  function load(defaultMeta) {
    const saved = readJson(activeStorageKey(), null);
    if (saved && Number(saved.schemaVersion) >= 1 && Number(saved.schemaVersion) <= SCHEMA_VERSION && Array.isArray(saved.projects)) {
      const projects = saved.projects.map(project => normalizeProject(project, defaultMeta));
      const activeProjectId = saved.activeProjectId === ''
        ? ''
        : projects.some(project => project.id === saved.activeProjectId && !project.deletedAt)
          ? saved.activeProjectId
          : '';
      const library = { schemaVersion: SCHEMA_VERSION, projects, activeProjectId };
      if (saved.schemaVersion !== SCHEMA_VERSION) save(library.projects, library.activeProjectId);
      return library;
    }

    const legacyItems = storageScope === 'owner' ? readJson(LEGACY_PROJECT_KEY, []) : [];
    const legacyMeta = storageScope === 'owner' ? readJson(LEGACY_META_KEY, null) : null;
    const legacyActual = storageScope === 'owner' ? readJson(LEGACY_ACTUAL_KEY, []) : [];
    if ((Array.isArray(legacyItems) && legacyItems.length) || (Array.isArray(legacyActual) && legacyActual.length)) {
      const migrated = normalizeProject({
        name: 'Проект до обновления',
        items: legacyItems,
        meta: legacyMeta || defaultMeta,
        actualItems: legacyActual
      }, defaultMeta);
      const library = { schemaVersion: SCHEMA_VERSION, projects: [migrated], activeProjectId: migrated.id };
      save(library.projects, library.activeProjectId);
      return library;
    }

    return { schemaVersion: SCHEMA_VERSION, projects: [], activeProjectId: '' };
  }

  function save(projects, activeProjectId) {
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      activeProjectId: String(activeProjectId || ''),
      projects: Array.isArray(projects) ? projects : []
    };
    localStorage.setItem(activeStorageKey(), JSON.stringify(payload));
    return payload;
  }

  function clear() {
    localStorage.removeItem(activeStorageKey());
    if (storageScope === 'owner') {
      [LEGACY_PROJECT_KEY, LEGACY_META_KEY, LEGACY_ACTUAL_KEY].forEach(key => localStorage.removeItem(key));
    }
  }

  window.AIVideoProjectStore = {
    STORAGE_KEY,
    GUEST_STORAGE_KEY,
    SCHEMA_VERSION,
    setScope,
    getScope: () => storageScope,
    normalizeName,
    normalizeProject,
    createProject,
    load,
    save,
    clear
  };
})();
