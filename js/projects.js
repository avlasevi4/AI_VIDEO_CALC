(function () {
  'use strict';

  const STORAGE_KEY = 'ai-video-calc-v2-project-library';
  const LEGACY_PROJECT_KEY = 'ai-video-calc-v2-project';
  const LEGACY_META_KEY = 'ai-video-calc-v2-project-meta';
  const LEGACY_ACTUAL_KEY = 'ai-video-calc-v2-actual';
  const SCHEMA_VERSION = 2;

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
    const meta = { ...clone(defaultMeta), ...(project?.meta || {}) };
    delete meta.retryPercent;
    delete meta.retryGenerations;
    return {
      id: String(project?.id || makeId()),
      name: normalizeName(project?.name),
      createdAt: project?.createdAt || now,
      updatedAt: project?.updatedAt || project?.createdAt || now,
      items: Array.isArray(project?.items) ? clone(project.items).map(item => ({
        ...item,
        qty: Math.max(1, Math.round(Number(item.qty) || 1)),
        extraQty: Math.max(1, Math.min(30, Math.round(Number(item.extraQty) || 1)))
      })) : [],
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

  function load(defaultMeta) {
    const saved = readJson(STORAGE_KEY, null);
    if (saved && Number(saved.schemaVersion) >= 1 && Number(saved.schemaVersion) <= SCHEMA_VERSION && Array.isArray(saved.projects)) {
      const projects = saved.projects.map(project => normalizeProject(project, defaultMeta));
      const activeProjectId = projects.some(project => project.id === saved.activeProjectId)
        ? saved.activeProjectId
        : (projects[0]?.id || '');
      const library = { schemaVersion: SCHEMA_VERSION, projects, activeProjectId };
      if (saved.schemaVersion !== SCHEMA_VERSION) save(library.projects, library.activeProjectId);
      return library;
    }

    const legacyItems = readJson(LEGACY_PROJECT_KEY, []);
    const legacyMeta = readJson(LEGACY_META_KEY, null);
    const legacyActual = readJson(LEGACY_ACTUAL_KEY, []);
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return payload;
  }

  function clear() {
    [STORAGE_KEY, LEGACY_PROJECT_KEY, LEGACY_META_KEY, LEGACY_ACTUAL_KEY].forEach(key => localStorage.removeItem(key));
  }

  window.AIVideoProjectStore = {
    STORAGE_KEY,
    SCHEMA_VERSION,
    normalizeName,
    normalizeProject,
    createProject,
    load,
    save,
    clear
  };
})();
