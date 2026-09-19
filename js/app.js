(function () {
  'use strict';

  const STORAGE_KEY = 'ai-video-calc-v2-settings';
  const PROVIDER_IDS = ['kling', 'syntex', 'dreamina', 'dreamina-plus'];
  const PRIVATE_PROVIDER_ID = 'dreamina-plus';
  const DREAMINA_PACKAGE_PRESETS = {
    'basic-monthly': { usd: 15, tokens: 1575 },
    'standard-monthly': { usd: 36, tokens: 3885 },
    'advanced-monthly': { usd: 79, tokens: 8645 }
  };
  const DREAMINA_PACKAGE_CATALOG_VERSION = '2026-09-19-official-usd';
  let pricing = null;
  let pricingSource = '—';
  let currentProvider = 'kling';
  let projects = [];
  let activeProjectId = '';
  let projectItems = [];
  let actualItems = [];
  let projectMeta = defaultProjectMeta();
  let actualDraft = { provider: 'kling', modelId: '', variantId: '', duration: 5, manualUnits: '' };
  let projectDialogMode = 'create';
  let cloudConfigured = false;
  let cloudSession = null;
  let projectAccess = true;
  const projectSyncTimers = new Map();
  let tariffSyncTimer = null;
  let lastCloudProjectSyncAt = 0;
  let foregroundSyncPromise = null;

  let settings = {
    usdRub: 75.05,
    klingPackageUsd: 10,
    klingPackageCredits: 660,
    syntexPackageRub: 1690,
    syntexPackageTokens: 680,
    dreaminaPackageUsd: 15,
    dreaminaPackageTokens: 1575,
    dreaminaPackagePreset: 'basic-monthly',
    dreaminaPackageCatalogVersion: DREAMINA_PACKAGE_CATALOG_VERSION,
    syntexManualUnits: {},
    manualTokenTariffs: {},
    sharedTariffsUpdatedAt: '',
    lastProjectModelByProvider: { kling: 'kling-30' },
    lastCalculatorModelByProvider: { kling: 'kling-30' },
    lastProjectSelectionByProvider: {},
    lastCalculatorSelectionByProvider: {},
    lastProjectProvider: 'kling',
    lastCalculatorProvider: 'kling',
    lastActualProvider: 'kling',
    lastActualSelectionByProvider: {},
    lastPricingCheck: ''
  };

  const $ = id => document.getElementById(id);
  const fmtRub = n => Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
  const fmtRub0 = n => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
  const fmtUsd = n => Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';
  const fmtNum = (n, d = 2) => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: d });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function defaultProjectMeta() {
    return {
      laborPerVideoRub: 250,
      priceMode: 'calculated',
      customQuotedPrice: 0,
      priceRounding: 'none',
      showWorkPrice: false,
      includeImages: false,
      plannedImages: 0,
      actualImages: 0,
      imageUnitRub: 5
    };
  }

  function loadLocal() {
    let oldSettings = {};
    try {
      const savedV2 = localStorage.getItem(STORAGE_KEY);
      oldSettings = JSON.parse(savedV2 || '{}') || {};
      if (!savedV2) {
        const legacy = JSON.parse(localStorage.getItem('ai-price-calculator-user-data') || localStorage.getItem('video-cost-calculator-v05') || 'null');
        if (legacy && typeof legacy === 'object') {
          oldSettings = {
            usdRub: Number(legacy.usdRub) || settings.usdRub,
            klingPackageUsd: Number(legacy.tariffs?.klingUsd) || settings.klingPackageUsd,
            klingPackageCredits: Number(legacy.tariffs?.klingTokens) || settings.klingPackageCredits,
            syntexPackageRub: Number(legacy.tariffs?.syntexRub) || settings.syntexPackageRub,
            syntexPackageTokens: Number(legacy.tariffs?.syntexTokens) || settings.syntexPackageTokens
          };
        }
      }
      settings = { ...settings, ...oldSettings };
      normalizeDreaminaPackageSettings();
      if (!settings.syntexManualUnits || typeof settings.syntexManualUnits !== 'object') settings.syntexManualUnits = {};
      if (!settings.manualTokenTariffs || typeof settings.manualTokenTariffs !== 'object') settings.manualTokenTariffs = {};
      // Сохраняем значения, введённые в предыдущем формате (₽/сек), в эквиваленте токенов.
      if (settings.manualRubTariffs && typeof settings.manualRubTariffs === 'object') {
        const tokenRub = Number(settings.syntexPackageRub) / Math.max(1, Number(settings.syntexPackageTokens));
        Object.entries(settings.manualRubTariffs).forEach(([key, value]) => {
          if (settings.manualTokenTariffs[key] || !(tokenRub > 0)) return;
          const rubPerSecond = Number(typeof value === 'object' ? value.pricePerSecond : value);
          if (!(rubPerSecond > 0)) return;
          const sourceDuration = Number(typeof value === 'object' ? value.sourceDuration : 1) || 1;
          settings.manualTokenTariffs[key] = {
            unitsPerSecond: rubPerSecond / tokenRub,
            sourceDuration,
            sourceUnits: (rubPerSecond / tokenRub) * sourceDuration,
            updatedAt: new Date().toISOString()
          };
        });
      }
      if (!settings.lastProjectModelByProvider || typeof settings.lastProjectModelByProvider !== 'object') settings.lastProjectModelByProvider = { kling: 'kling-30' };
      if (!settings.lastCalculatorModelByProvider || typeof settings.lastCalculatorModelByProvider !== 'object') settings.lastCalculatorModelByProvider = { kling: 'kling-30' };
      if (!settings.lastProjectSelectionByProvider || typeof settings.lastProjectSelectionByProvider !== 'object') settings.lastProjectSelectionByProvider = {};
      if (!settings.lastCalculatorSelectionByProvider || typeof settings.lastCalculatorSelectionByProvider !== 'object') settings.lastCalculatorSelectionByProvider = {};
    } catch (_) {}

    window.AIVideoProjectStore.setScope('guest');
    const library = window.AIVideoProjectStore.load(defaultProjectMeta());
    projects = library.projects;
    activeProjectId = library.activeProjectId;
    loadActiveProjectState();

    projectItems = projectItems.map(item => ({
      ...item,
      qty: Math.max(1, Math.round(Number(item.qty) || 1)),
      generationsPerVideo: Math.max(1, Math.min(30, Math.round(Number(item.generationsPerVideo ?? item.extraQty) || 1)))
    }));
    projectItems.forEach(item => { delete item.extraQty; });

    delete projectMeta.retryPercent;
    delete projectMeta.retryGenerations;
    delete projectMeta.deliverableVideos;
    projectMeta.laborPerVideoRub = Math.max(0, Number(projectMeta.laborPerVideoRub) || 250);
    projectMeta.priceMode = projectMeta.priceMode === 'custom' ? 'custom' : 'calculated';
    projectMeta.customQuotedPrice = Math.max(0, Number(projectMeta.customQuotedPrice) || 0);
    projectMeta.priceRounding = ['none', 'up', 'down'].includes(projectMeta.priceRounding) ? projectMeta.priceRounding : 'none';
    projectMeta.showWorkPrice = Boolean(projectMeta.showWorkPrice);
    projectMeta.includeImages = Boolean(projectMeta.includeImages);
    projectMeta.plannedImages = Math.max(0, Math.round(Number(projectMeta.plannedImages) || 0));
    projectMeta.actualImages = Math.max(0, Math.round(Number(projectMeta.actualImages) || 0));
    projectMeta.imageUnitRub = Math.max(0, Number(projectMeta.imageUnitRub) || 5);

    actualItems = actualItems.map(item => ({
      ...item,
      rub: Math.max(0, Number(item.rub) || 0),
      duration: Math.max(0, Number(item.duration) || 0),
      units: Math.max(0, Number(item.units) || 0)
    }));

    if ('retryPercent' in settings) delete settings.retryPercent;
    if ('retryGenerations' in settings) delete settings.retryGenerations;
  }

  function saveLocal({ touchProject = true, syncProject = true } = {}) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      syncActiveProjectState(touchProject);
      window.AIVideoProjectStore.save(projects, activeProjectId);
      if (syncProject) scheduleActiveProjectSync();
    } catch (_) {}
  }

  function sharedTariffs() {
    return {
      usdRub: settings.usdRub,
      klingPackageUsd: settings.klingPackageUsd,
      klingPackageCredits: settings.klingPackageCredits,
      syntexPackageRub: settings.syntexPackageRub,
      syntexPackageTokens: settings.syntexPackageTokens,
      dreaminaPackageUsd: settings.dreaminaPackageUsd,
      dreaminaPackageTokens: settings.dreaminaPackageTokens,
      dreaminaPackagePreset: settings.dreaminaPackagePreset,
      dreaminaPackageCatalogVersion: settings.dreaminaPackageCatalogVersion,
      manualTokenTariffs: settings.manualTokenTariffs,
      syntexManualUnits: settings.syntexManualUnits
    };
  }

  function saveTariffSettings() {
    settings.sharedTariffsUpdatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    if (!cloudSession) return;
    clearTimeout(tariffSyncTimer);
    tariffSyncTimer = setTimeout(() => synchronizeCloudTariffs(), 650);
  }

  function applySharedTariffs(value, updatedAt) {
    const allowed = sharedTariffs();
    Object.keys(allowed).forEach(key => {
      if (value && Object.prototype.hasOwnProperty.call(value, key)) settings[key] = value[key];
    });
    normalizeDreaminaPackageSettings();
    settings.sharedTariffsUpdatedAt = updatedAt || settings.sharedTariffsUpdatedAt || '';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function normalizeDreaminaPackageSettings() {
    if (settings.dreaminaPackagePreset === 'custom') {
      settings.dreaminaPackageCatalogVersion = DREAMINA_PACKAGE_CATALOG_VERSION;
      return;
    }
    if (settings.dreaminaPackageCatalogVersion !== DREAMINA_PACKAGE_CATALOG_VERSION || !DREAMINA_PACKAGE_PRESETS[settings.dreaminaPackagePreset]) {
      const basic = DREAMINA_PACKAGE_PRESETS['basic-monthly'];
      settings.dreaminaPackagePreset = 'basic-monthly';
      settings.dreaminaPackageUsd = basic.usd;
      settings.dreaminaPackageTokens = basic.tokens;
      settings.dreaminaPackageCatalogVersion = DREAMINA_PACKAGE_CATALOG_VERSION;
    }
  }

  async function synchronizeCloudTariffs() {
    if (!cloudSession) return;
    try {
      const remote = await window.AIVideoCloud.loadSettings();
      const localTime = new Date(settings.sharedTariffsUpdatedAt || 0).getTime() || 0;
      const remoteTime = new Date(remote?.updatedAt || 0).getTime() || 0;
      if (!remote || localTime > remoteTime) {
        const saved = await window.AIVideoCloud.saveSettings(sharedTariffs(), settings.sharedTariffsUpdatedAt || new Date().toISOString());
        settings.sharedTariffsUpdatedAt = saved.updatedAt;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } else if (remoteTime > localTime) {
        applySharedTariffs(remote.settings, remote.updatedAt);
      }
      hydrateSettings();
      renderHeadlineRate();
      renderManualTariffEditor();
      renderManualUnits();
      renderResult();
      renderProject();
      if ($('manualTariffMessage')) $('manualTariffMessage').textContent = 'Тарифы синхронизированы с вашим облаком и доступны на других устройствах.';
    } catch (_) {
      // The local tariff set stays usable until the next successful sync.
    }
  }

  function activeProject() {
    return projects.find(project => project.id === activeProjectId && !project.deletedAt) || null;
  }

  function loadActiveProjectState() {
    const project = activeProject();
    if (!project) {
      activeProjectId = '';
      projectItems = [];
      actualItems = [];
      projectMeta = defaultProjectMeta();
      return;
    }
    projectItems = JSON.parse(JSON.stringify(project.items || []));
    actualItems = JSON.parse(JSON.stringify(project.actualItems || []));
    projectMeta = { ...defaultProjectMeta(), ...(project.meta || {}) };
    projectMeta.showWorkPrice = Boolean(projectMeta.showWorkPrice);
  }

  function syncActiveProjectState(touch = true) {
    const project = activeProject();
    if (!project) return;
    project.items = JSON.parse(JSON.stringify(projectItems));
    project.actualItems = JSON.parse(JSON.stringify(actualItems));
    project.meta = JSON.parse(JSON.stringify(projectMeta));
    if (touch) project.updatedAt = new Date().toISOString();
  }

  async function init() {
    loadLocal();
    releaseOrientationLock();
    actualDraft.provider = settings.lastActualProvider || 'kling';
    bind();
    setView(viewFromLocation(), false);
    hydrateSettings();
    renderHeadlineRate();

    const loaded = await window.AIVideoPricing.loadPricing(false);
    pricing = loaded.data;
    pricingSource = loaded.source;
    renderDataStatus(loaded.warning);
    renderSourceLinks();
    renderManualTariffEditor();
    setProvider(PROVIDER_IDS.includes(settings.lastCalculatorProvider) ? settings.lastCalculatorProvider : 'kling', false);
    await initCloudAccess();
    renderProject();
    runPricingCheck(false);

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    // При открытии пытаемся освежить курс. Если сеть недоступна, остаётся последнее сохранённое значение.
    refreshRate(true);
  }

  function releaseOrientationLock() {
    try {
      window.screen?.orientation?.unlock?.();
    } catch (_) {
      // Некоторые браузеры разрешают управление ориентацией только в полноэкранном режиме.
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      releaseOrientationLock();
      refreshProjectsOnForeground();
    }
  });
  window.addEventListener('pageshow', () => refreshProjectsOnForeground());

  function viewFromLocation() {
    const hash = String(location.hash || '').replace('#', '').toLowerCase();
    if (hash === 'projects' || hash === 'actualexpenses') return 'projects';
    if (hash === 'tariffs' || hash === 'settings') return 'tariffs';
    return 'calculator';
  }

  function setView(view, updateHash = true) {
    const allowed = ['calculator', 'projects', 'tariffs'];
    const next = allowed.includes(view) ? view : 'calculator';
    // The library opens as a dashboard. A workspace remains open only after the
    // user explicitly selects a project in this visit to the Projects section.
    if (next === 'projects' && activeProject()) {
      syncActiveProjectState(false);
      activeProjectId = '';
      projectItems = [];
      actualItems = [];
      projectMeta = defaultProjectMeta();
      window.AIVideoProjectStore.save(projects, activeProjectId);
    }
    document.querySelectorAll('.view-panel').forEach(panel => panel.classList.toggle('hidden', panel.dataset.view !== next));
    document.querySelectorAll('.app-tab').forEach(button => {
      const active = button.dataset.appView === next;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    document.querySelector('.app')?.setAttribute('data-active-view', next);
    if (updateHash) {
      const nextHash = next === 'calculator' ? '' : '#' + next;
      if (location.hash !== nextHash) history.replaceState(null, '', location.pathname + location.search + nextHash);
    }
  }

  function bind() {
    document.querySelectorAll('.app-tab').forEach(button => button.addEventListener('click', () => setView(button.dataset.appView)));
    window.addEventListener('hashchange', () => setView(viewFromLocation(), false));
    window.addEventListener('online', async () => {
      await synchronizeCloudProjects();
      await synchronizeCloudTariffs();
      renderProject();
    });
    document.querySelectorAll('.provider-tab').forEach(btn => btn.addEventListener('click', () => setProvider(btn.dataset.provider)));
    $('modelSelect').addEventListener('change', () => {
      settings.lastCalculatorModelByProvider[currentProvider] = $('modelSelect').value;
      renderVariants(); renderDuration(); renderManualUnits(); renderResult();
      rememberCalculatorSelection();
      saveLocal();
    });
    $('variantSelect').addEventListener('change', () => { renderDuration(); renderManualUnits(); renderResult(); rememberCalculatorSelection(); saveLocal(); });
    $('durationRange').addEventListener('input', () => { $('durationNumber').value = $('durationRange').value; renderManualUnits(); renderResult(); rememberCalculatorSelection(); saveLocal(); });
    $('durationNumber').addEventListener('input', () => { $('durationRange').value = $('durationNumber').value; renderManualUnits(); renderResult(); rememberCalculatorSelection(); saveLocal(); });
    $('manualUnits').addEventListener('input', () => { setStoredManualUnits($('manualUnits').value); renderResult(); });
    $('compareCalculatorSyntex').addEventListener('click', () => toggleSyntexComparison(
      $('compareCalculatorSyntex'),
      $('calculatorSyntexComparison'),
      () => syntexComparison(currentModel()?.id, currentVariant()?.id, currentDuration(), 1, getStoredManualUnits())
    ));

    $('createProject').addEventListener('click', createNewProject);
    $('newProjectFromWorkspace').addEventListener('click', createNewProject);
    $('closeProject').addEventListener('click', closeActiveProject);
    $('renameProject').addEventListener('click', () => openProjectNameDialog('rename'));
    $('completeProject').addEventListener('click', toggleProjectCompletion);
    $('projectNameForm').addEventListener('submit', saveProjectName);
    $('cancelProjectName').addEventListener('click', closeProjectNameDialog);
    $('projectNameDialog').addEventListener('cancel', event => { event.preventDefault(); closeProjectNameDialog(); });
    $('authForm').addEventListener('submit', signInToProjects);
    $('authSignOut').addEventListener('click', signOutOfProjects);
    $('ownerAccessToggle').addEventListener('click', toggleOwnerAccessPanel);
    $('addProjectLine').addEventListener('click', () => { projectItems.push(defaultProjectItem()); saveLocal(); renderProject(); });
    $('calculateWorkPrice').addEventListener('click', () => {
      projectMeta.showWorkPrice = true;
      saveLocal();
      renderTotals();
    });
    $('compareEstimateSyntex').addEventListener('click', () => toggleSyntexComparison(
      $('compareEstimateSyntex'), $('estimateSyntexComparison'), () => syntexItemsComparison(projectItems, true)
    ));
    $('compareActualSyntex').addEventListener('click', () => toggleSyntexComparison(
      $('compareActualSyntex'), $('actualSyntexComparison'), () => syntexItemsComparison(actualItems, false)
    ));

    ['laborPerVideoRub', 'plannedImages', 'actualImages', 'imageUnitRub', 'customQuotedPrice'].forEach(id => {
      $(id).addEventListener('input', () => {
        if (id === 'laborPerVideoRub') projectMeta.laborPerVideoRub = Math.max(0, Number($(id).value) || 0);
        if (id === 'plannedImages') projectMeta.plannedImages = Math.max(0, Math.round(Number($(id).value) || 0));
        if (id === 'actualImages') projectMeta.actualImages = Math.max(0, Math.round(Number($(id).value) || 0));
        if (id === 'imageUnitRub') projectMeta.imageUnitRub = Math.max(0, Number($(id).value) || 0);
        if (id === 'customQuotedPrice') projectMeta.customQuotedPrice = Math.max(0, Number($(id).value) || 0);
        saveLocal();
        renderTotals();
      });
    });
    document.querySelectorAll('input[name="priceMode"]').forEach(input => input.addEventListener('change', () => {
      projectMeta.priceMode = input.value === 'custom' ? 'custom' : 'calculated';
      saveLocal();
      renderProjectMeta();
      renderTotals();
    }));
    $('priceRounding').addEventListener('change', () => {
      projectMeta.priceRounding = ['up', 'down'].includes($('priceRounding').value) ? $('priceRounding').value : 'none';
      saveLocal();
      renderTotals();
    });
    $('includeImages').addEventListener('change', () => {
      projectMeta.includeImages = $('includeImages').checked;
      saveLocal();
      renderProjectMeta();
      renderTotals();
    });

    $('actualProvider').addEventListener('change', () => {
      actualDraft.provider = $('actualProvider').value;
      actualDraft.modelId = '';
      actualDraft.variantId = '';
      actualDraft.manualUnits = '';
      renderActualDraft();
    });
    $('actualModel').addEventListener('change', () => {
      actualDraft.modelId = $('actualModel').value;
      actualDraft.variantId = '';
      actualDraft.manualUnits = '';
      renderActualDraft();
    });
    $('actualVariant').addEventListener('change', () => {
      actualDraft.variantId = $('actualVariant').value;
      actualDraft.manualUnits = '';
      renderActualDraft();
    });
    $('actualDurationRange').addEventListener('input', () => {
      actualDraft.duration = durationFromSlider($('actualDurationRange'));
      $('actualDurationValue').textContent = `${actualDraft.duration} сек`;
      actualDraft.manualUnits = '';
      syncActualManualFromStored();
      renderActualDraftResult();
    });
    $('actualManualUnits').addEventListener('input', () => {
      const n = Number(String($('actualManualUnits').value).replace(',', '.'));
      actualDraft.manualUnits = n > 0 ? n : '';
      renderActualDraftResult();
    });
    $('addActualGeneration').addEventListener('click', addActualGeneration);
    ['actualProvider', 'actualModel', 'actualVariant', 'actualDurationRange'].forEach(id => {
      $(id).addEventListener(id === 'actualDurationRange' ? 'input' : 'change', () => {
        settings.lastActualProvider = actualDraft.provider;
        settings.lastActualSelectionByProvider ||= {};
        settings.lastActualSelectionByProvider[actualDraft.provider] = {
          modelId: actualDraft.modelId, variantId: actualDraft.variantId, duration: actualDraft.duration
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      });
    });

    ['usdRub', 'klingPackageUsd', 'klingPackageCredits', 'syntexPackageRub', 'syntexPackageTokens', 'dreaminaPackageUsd', 'dreaminaPackageTokens'].forEach(id => {
      $(id).addEventListener('input', () => {
        settings[id] = Number($(id).value) || 0;
        if (id === 'dreaminaPackageUsd' || id === 'dreaminaPackageTokens') {
          settings.dreaminaPackagePreset = 'custom';
          settings.dreaminaPackageCatalogVersion = DREAMINA_PACKAGE_CATALOG_VERSION;
          $('dreaminaPackagePreset').value = 'custom';
        }
        saveTariffSettings();
        saveLocal();
        renderHeadlineRate();
        renderResult();
        renderProject();
        renderUnitPrices();
      });
    });
    $('dreaminaPackagePreset').addEventListener('change', () => {
      const id = $('dreaminaPackagePreset').value;
      settings.dreaminaPackagePreset = id;
      settings.dreaminaPackageCatalogVersion = DREAMINA_PACKAGE_CATALOG_VERSION;
      const preset = DREAMINA_PACKAGE_PRESETS[id];
      if (preset) {
        settings.dreaminaPackageUsd = preset.usd;
        settings.dreaminaPackageTokens = preset.tokens;
        $('dreaminaPackageUsd').value = preset.usd;
        $('dreaminaPackageTokens').value = preset.tokens;
      }
      saveTariffSettings();
      saveLocal();
      renderResult();
      renderProject();
      renderUnitPrices();
    });

    $('refreshPricing').addEventListener('click', refreshPricing);
    $('manualTariffProvider').addEventListener('change', () => renderManualTariffModels());
    $('manualTariffModel').addEventListener('change', () => renderManualTariffVariants());
    $('manualTariffVariant').addEventListener('change', () => renderManualTariffDuration());
    $('manualTariffDuration').addEventListener('change', () => {
      const model = manualTariffModel();
      const variant = manualTariffVariant();
      const duration = Number($('manualTariffDuration').value);
      const units = model && variant ? manualTokenTariffFor(model.id, variant.id, duration) : 0;
      $('manualTariffTokens').value = units > 0 ? units : '';
    });
    $('saveManualTariff').addEventListener('click', saveManualTokenTariff);
    $('resetManualTariffs').addEventListener('click', resetManualTokenTariffs);
    $('checkPricing').addEventListener('click', () => runPricingCheck(true));
    $('refreshRate').addEventListener('click', () => refreshRate(false));
    $('quickRefreshRate').addEventListener('click', () => refreshRate(false));
    $('exportData').addEventListener('click', exportData);
    $('importData').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', importData);
    $('resetData').addEventListener('click', resetData);
  }

  function hydrateSettings() {
    ['usdRub', 'klingPackageUsd', 'klingPackageCredits', 'syntexPackageRub', 'syntexPackageTokens', 'dreaminaPackageUsd', 'dreaminaPackageTokens'].forEach(k => {
      if ($(k)) $(k).value = settings[k];
    });
    if ($('dreaminaPackagePreset')) $('dreaminaPackagePreset').value = DREAMINA_PACKAGE_PRESETS[settings.dreaminaPackagePreset] ? settings.dreaminaPackagePreset : 'custom';
  }

  function isLocalDevelopment() {
    return ['localhost', '127.0.0.1'].includes(location.hostname) || location.protocol === 'file:';
  }

  async function initCloudAccess() {
    try {
      const state = await window.AIVideoCloud.init(session => {
        cloudSession = session;
        projectAccess = true;
        switchProjectLibrary(session ? 'owner' : 'guest');
        renderAuthState();
        renderProject();
      });
      cloudConfigured = state.configured;
      cloudSession = state.session;
      projectAccess = true;
      switchProjectLibrary(cloudSession ? 'owner' : 'guest');
      if (cloudSession) {
        await synchronizeCloudProjects();
        await synchronizeCloudTariffs();
      }
    } catch (error) {
      cloudConfigured = window.AIVideoCloud.isConfigured();
      cloudSession = null;
      projectAccess = true;
      switchProjectLibrary('guest');
      $('authError').textContent = 'Не удалось подключить личные проекты: ' + error.message;
    }
    renderAuthState();
  }

  function renderAuthState() {
    const localMode = !cloudConfigured && isLocalDevelopment();
    $('authLoading').classList.add('hidden');
    $('authForm').classList.toggle('hidden', !cloudConfigured || Boolean(cloudSession));
    $('authAccount').classList.toggle('hidden', !cloudSession);
    $('authSetup').classList.toggle('hidden', cloudConfigured || Boolean(cloudSession));
    $('projectPrivateContent').classList.toggle('hidden', !projectAccess);
    $('createProject').classList.toggle('hidden', !projectAccess);
    $('ownerAccessToggle').classList.toggle('connected', Boolean(cloudSession));
    $('ownerAccessToggle').setAttribute('aria-label', cloudSession ? 'Открыть состояние облачной синхронизации' : 'Открыть вход владельца');

    if (localMode) {
      $('authSetup').querySelector('strong').textContent = 'Локальный режим разработки';
      $('authSetup').querySelector('span').textContent = 'История доступна только в этом браузере. После подключения Supabase на GitHub потребуется вход владельца.';
    }
    if (cloudSession) {
      $('authAccountEmail').textContent = cloudSession.user.email;
    }
    refreshProviderAccess();
  }

  function toggleOwnerAccessPanel() {
    const panel = $('ownerAccessPanel');
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !opening);
    $('ownerAccessToggle').setAttribute('aria-expanded', String(opening));
    if (opening && !cloudSession && !$('authForm').classList.contains('hidden')) {
      $('authEmail').focus();
    }
  }

  async function signInToProjects(event) {
    event.preventDefault();
    const button = $('authSubmit');
    $('authError').classList.add('hidden');
    button.disabled = true;
    button.textContent = 'Входим…';
    try {
      cloudSession = await window.AIVideoCloud.signIn($('authEmail').value, $('authPassword').value);
      projectAccess = true;
      switchProjectLibrary('owner');
      $('authPassword').value = '';
      renderAuthState();
      await synchronizeCloudProjects();
      await synchronizeCloudTariffs();
      renderProject();
    } catch (error) {
      $('authError').textContent = error.message;
      $('authError').classList.remove('hidden');
    } finally {
      button.disabled = false;
      button.textContent = 'Войти';
    }
  }

  async function signOutOfProjects() {
    $('syncStatus').textContent = 'Завершаем сессию…';
    await window.AIVideoCloud.signOut();
    cloudSession = null;
    projectAccess = true;
    switchProjectLibrary('guest');
    renderAuthState();
    renderProject();
  }

  function switchProjectLibrary(scope) {
    if (window.AIVideoProjectStore.getScope() === scope) return;
    window.AIVideoProjectStore.setScope(scope);
    const library = window.AIVideoProjectStore.load(defaultProjectMeta());
    projects = library.projects;
    activeProjectId = library.activeProjectId;
    loadActiveProjectState();
    actualDraft = { provider: settings.lastActualProvider || 'kling', modelId: '', variantId: '', duration: 5, manualUnits: '' };
  }

  async function synchronizeCloudProjects() {
    if (!cloudSession) return;
    $('syncStatus').textContent = 'Синхронизация…';
    try {
      syncActiveProjectState(false);
      const merged = await window.AIVideoCloud.synchronize(projects);
      projects = merged.map(project => window.AIVideoProjectStore.normalizeProject(project, defaultProjectMeta()));
      if (activeProjectId && !projects.some(project => project.id === activeProjectId && !project.deletedAt)) {
        activeProjectId = '';
      }
      loadActiveProjectState();
      window.AIVideoProjectStore.save(projects, activeProjectId);
      lastCloudProjectSyncAt = Date.now();
      $('syncStatus').textContent = `Синхронизировано ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (error) {
      $('syncStatus').textContent = 'Offline: изменения сохранены локально';
    }
  }

  function refreshProjectsOnForeground() {
    if (!cloudSession || document.hidden || Date.now() - lastCloudProjectSyncAt < 1500 || foregroundSyncPromise) return;
    foregroundSyncPromise = synchronizeCloudProjects()
      .then(() => renderProject())
      .finally(() => { foregroundSyncPromise = null; });
  }

  function scheduleActiveProjectSync() {
    if (!cloudSession || !activeProject()) return;
    clearTimeout(projectSyncTimers.get(activeProjectId));
    $('syncStatus').textContent = 'Есть несинхронизированные изменения…';
    const pendingProject = JSON.parse(JSON.stringify(activeProject()));
    projectSyncTimers.set(pendingProject.id, setTimeout(async () => {
      projectSyncTimers.delete(pendingProject.id);
      try {
        const saved = await window.AIVideoCloud.saveProject(pendingProject);
        const remoteWon = saved && (
          saved.updatedAt !== pendingProject.updatedAt
          || saved.status !== pendingProject.status
          || saved.completedAt !== pendingProject.completedAt
        );
        if (saved?.deletedAt || remoteWon) {
          projects = projects.map(project => project.id === saved.id ? saved : project);
          loadActiveProjectState();
          window.AIVideoProjectStore.save(projects, activeProjectId);
          renderProject();
        }
        $('syncStatus').textContent = `Синхронизировано ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
      } catch (_) {
        $('syncStatus').textContent = 'Offline: изменения сохранены локально';
      }
    }, 700));
  }

  function renderHeadlineRate() {
    if ($('headlineRate')) $('headlineRate').textContent = `1 $ = ${fmtNum(settings.usdRub, 2)} ₽`;
  }

  function canUseProvider(provider) {
    return provider !== PRIVATE_PROVIDER_ID || Boolean(cloudSession);
  }

  function availableProviderIds() {
    return PROVIDER_IDS.filter(id => pricing?.providers?.[id] && canUseProvider(id));
  }

  function safeProvider(provider) {
    return PROVIDER_IDS.includes(provider) && canUseProvider(provider) ? provider : 'kling';
  }

  function refreshProviderAccess() {
    if (!pricing) return;
    const plusAvailable = canUseProvider(PRIVATE_PROVIDER_ID);
    document.querySelectorAll(`[data-private-provider="${PRIVATE_PROVIDER_ID}"]`).forEach(element => {
      element.classList.toggle('hidden', !plusAvailable);
    });

    if (!canUseProvider(currentProvider)) setProvider('kling', false);

    if ($('actualProvider')) {
      actualDraft.provider = safeProvider(actualDraft.provider);
      $('actualProvider').innerHTML = providerOptions(actualDraft.provider);
      if (projectAccess && activeProject()) renderActualDraft();
    }
  }

  function modelsForProvider(provider) {
    if (!canUseProvider(provider)) return [];
    return pricing.models.filter(model => model.provider === provider);
  }

  function providerOptions(selected) {
    return availableProviderIds()
      .map(id => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(pricing.providers[id].name)}</option>`)
      .join('');
  }

  function savedCalculatorSelection(provider) {
    const saved = settings.lastCalculatorSelectionByProvider?.[provider]
      || settings.lastProjectSelectionByProvider?.[provider]
      || {};
    return {
      modelId: saved.modelId || settings.lastCalculatorModelByProvider?.[provider] || (provider === 'kling' ? 'kling-30' : ''),
      variantId: saved.variantId || '',
      duration: Number(saved.duration) || 5
    };
  }

  function rememberCalculatorSelection() {
    const model = currentModel();
    const variant = currentVariant();
    if (!model || !variant) return;
    settings.lastCalculatorModelByProvider[model.provider] = model.id;
    const selection = {
      modelId: model.id,
      variantId: variant.id,
      duration: currentDuration()
    };
    settings.lastCalculatorSelectionByProvider[model.provider] = selection;
    settings.lastProjectSelectionByProvider[model.provider] = { ...selection };
    settings.lastProjectProvider = model.provider;
  }

  function setProvider(provider, persist = true) {
    provider = safeProvider(provider);
    currentProvider = provider;
    if (persist) {
      settings.lastCalculatorProvider = provider;
      settings.lastProjectProvider = provider;
      saveLocal();
    }
    document.querySelectorAll('.provider-tab').forEach(button => button.classList.toggle('active', button.dataset.provider === provider));
    renderModels();
  }

  function renderModels() {
    const models = modelsForProvider(currentProvider);
    const saved = savedCalculatorSelection(currentProvider);
    const selected = models.find(model => model.id === saved.modelId) || models[0];
    $('modelSelect').innerHTML = models.map(model => `<option value="${esc(model.id)}" ${model.id === selected?.id ? 'selected' : ''}>${esc(model.name)}</option>`).join('');
    renderVariants(saved.variantId);
    renderDuration(saved.duration);
    renderManualUnits();
    renderResult();
  }

  function currentModel() {
    return pricing.models.find(model => model.id === $('modelSelect').value) || modelsForProvider(currentProvider)[0];
  }

  function currentVariant() {
    const model = currentModel();
    return model?.variants.find(variant => variant.id === $('variantSelect').value) || model?.variants[0];
  }

  function renderVariants(preferredVariantId = '') {
    const model = currentModel();
    if (!model) return;
    const selected = model.variants.find(variant => variant.id === preferredVariantId) || model.variants[0];
    $('variantSelect').innerHTML = model.variants.map(variant => `<option value="${esc(variant.id)}" ${variant.id === selected?.id ? 'selected' : ''}>${esc(variant.label)}</option>`).join('');
    $('variantField').classList.toggle('hidden', model.variants.length === 1 && /^(Стандартный режим|Hailuo MiniMax|Pika|Topaz AI 2\.5|Lip Sync|Act-One|Аватар)$/.test(model.variants[0].label));
  }

  function initialDurationForVariant(variant, preferred = 5) {
    const billing = variant?.billing || {};
    if (Array.isArray(billing.allowedDurations) && billing.allowedDurations.length) {
      return billing.allowedDurations.includes(Number(preferred)) ? Number(preferred) : Number(billing.allowedDurations[0]);
    }
    const range = billing.durationRange || { min: 1, max: 60, step: 1 };
    return Math.min(Number(range.max), Math.max(Number(range.min), Number(preferred) || 5));
  }

  function configureDurationSlider(input, output, variant, preferred = 5) {
    const billing = variant?.billing || {};
    const next = initialDurationForVariant(variant, preferred);
    if (Array.isArray(billing.allowedDurations) && billing.allowedDurations.length) {
      const values = billing.allowedDurations.map(Number);
      const index = Math.max(0, values.indexOf(Number(next)));
      input.min = 0;
      input.max = Math.max(0, values.length - 1);
      input.step = 1;
      input.value = index;
      input.dataset.values = JSON.stringify(values);
      if (output) output.textContent = `${values[index]} сек`;
      return values[index];
    }
    const range = billing.durationRange || { min: 1, max: 60, step: 1 };
    input.min = range.min;
    input.max = range.max;
    input.step = range.step;
    input.value = next;
    delete input.dataset.values;
    if (output) output.textContent = `${next} сек`;
    return next;
  }

  function durationFromSlider(input) {
    if (input.dataset.values) {
      try {
        const values = JSON.parse(input.dataset.values);
        return Number(values[Math.max(0, Math.min(values.length - 1, Math.round(Number(input.value) || 0)))]) || 5;
      } catch (_) {}
    }
    return Number(input.value) || 5;
  }

  function renderDuration(preferredDuration = 5) {
    const variant = currentVariant();
    if (!variant) return;
    const billing = variant.billing;
    const chips = $('durationChips');
    const rangeWrap = $('durationRangeWrap');
    const hint = $('durationHint');
    chips.innerHTML = '';
    hint.classList.add('hidden');
    hint.textContent = '';

    if (Array.isArray(billing.allowedDurations)) {
      rangeWrap.classList.add('hidden');
      chips.classList.remove('hidden');
      const selectedDuration = initialDurationForVariant(variant, preferredDuration);
      billing.allowedDurations.forEach((duration, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'duration-chip' + (Number(duration) === selectedDuration ? ' active' : '');
        button.textContent = duration + ' сек';
        button.dataset.duration = duration;
        button.onclick = () => {
          chips.querySelectorAll('button').forEach(x => x.classList.remove('active'));
          button.classList.add('active');
          renderManualUnits();
          renderResult();
          rememberCalculatorSelection();
          saveLocal();
        };
        chips.appendChild(button);
      });
    } else {
      chips.classList.add('hidden');
      rangeWrap.classList.remove('hidden');
      const range = billing.durationRange || { min: 1, max: 60, step: 1 };
      $('durationRange').min = range.min;
      $('durationRange').max = range.max;
      $('durationRange').step = range.step;
      const next = initialDurationForVariant(variant, preferredDuration);
      $('durationRange').value = next;
      $('durationNumber').value = next;
      $('durationNumber').min = range.min;
      $('durationNumber').max = range.max;
      $('durationNumber').step = range.step;
      if (range.generic) {
        hint.textContent = 'Диапазон длительности здесь служебный для расчёта. Допустимую длину выбранного режима проверь в SYNTX.';
        hint.classList.remove('hidden');
      }
    }
  }

  function currentDuration() {
    const active = $('durationChips').querySelector('.active');
    return active ? Number(active.dataset.duration) : Number($('durationNumber').value) || 5;
  }

  function manualKeyFor(modelId, variantId, duration) {
    return `${modelId}::${variantId}::${duration}`;
  }

  function manualTariffKeyFor(modelId, variantId) {
    return `${modelId}::${variantId}`;
  }

  function manualTokenTariffFor(modelId, variantId, duration) {
    const stored = settings.manualTokenTariffs?.[manualTariffKeyFor(modelId, variantId)];
    const exact = Number(stored?.unitsByDuration?.[String(duration)]);
    if (exact > 0) return exact;
    const model = pricing?.models?.find(item => item.id === modelId);
    const variant = model?.variants?.find(item => item.id === variantId);
    const legacyRate = Number(typeof stored === 'object' ? stored.unitsPerSecond : stored);
    return variant?.billing?.type === 'manual_required' && legacyRate > 0 && Number(duration) > 0
      ? legacyRate * Number(duration)
      : 0;
  }

  function hasManualTokenTariff(modelId, variantId, duration) {
    return manualTokenTariffFor(modelId, variantId, duration) > 0;
  }

  function tariffDurationsForVariant(variant) {
    const billing = variant?.billing || {};
    if (Array.isArray(billing.allowedDurations) && billing.allowedDurations.length) return billing.allowedDurations.map(Number);
    const range = billing.durationRange || { min: 1, max: 60, step: 1 };
    const min = Math.max(1, Number(range.min) || 1);
    const max = Math.max(min, Number(range.max) || 60);
    const step = Math.max(1, Number(range.step) || 1);
    const values = [];
    for (let value = min; value <= max; value += step) values.push(value);
    return values;
  }

  function manualTariffModel() {
    const provider = $('manualTariffProvider')?.value || 'syntex';
    return modelsForProvider(provider).find(model => model.id === $('manualTariffModel')?.value) || modelsForProvider(provider)[0];
  }

  function manualTariffVariant() {
    const model = manualTariffModel();
    const variants = model?.variants || [];
    return variants.find(variant => variant.id === $('manualTariffVariant')?.value) || variants[0];
  }

  function renderManualTariffEditor() {
    if (!pricing || !$('manualTariffProvider')) return;
    if ($('baseTariffDate')) {
      const date = pricing.baseTariffDate || pricing.updated;
      $('baseTariffDate').textContent = `Базовые тарифы: ${new Date(date + 'T00:00:00').toLocaleDateString('ru-RU')}`;
    }
    const availableProviders = ['syntex'].filter(provider => pricing.providers?.[provider] && modelsForProvider(provider).length);
    const previous = $('manualTariffProvider').value;
    const provider = availableProviders.includes(previous) ? previous : (availableProviders.includes('syntex') ? 'syntex' : availableProviders[0]);
    $('manualTariffProvider').innerHTML = availableProviders.map(id => `<option value="${esc(id)}" ${id === provider ? 'selected' : ''}>${esc(pricing.providers[id].name)}</option>`).join('');
    renderManualTariffModels();
    renderManualTariffList();
  }

  function renderManualTariffModels() {
    if (!pricing || !$('manualTariffModel')) return;
    const provider = $('manualTariffProvider').value;
    const models = modelsForProvider(provider);
    const previous = $('manualTariffModel').value;
    const preferred = provider === 'syntex' ? 'syntx-seedance-25' : models[0]?.id;
    const selected = models.some(model => model.id === previous) ? previous : (models.some(model => model.id === preferred) ? preferred : models[0]?.id);
    $('manualTariffModel').innerHTML = models.map(model => `<option value="${esc(model.id)}" ${model.id === selected ? 'selected' : ''}>${esc(model.name)}</option>`).join('');
    renderManualTariffVariants();
  }

  function renderManualTariffVariants() {
    const model = manualTariffModel();
    if (!model) return;
    const variants = model.variants;
    const previous = $('manualTariffVariant').value;
    const selected = variants.some(variant => variant.id === previous) ? previous : variants[0]?.id;
    $('manualTariffVariant').innerHTML = variants.map(variant => `<option value="${esc(variant.id)}" ${variant.id === selected ? 'selected' : ''}>${esc(variant.label)}</option>`).join('');
    renderManualTariffDuration();
  }

  function renderManualTariffDuration() {
    const variant = manualTariffVariant();
    if (!variant) return;
    const values = tariffDurationsForVariant(variant);
    const previous = Number($('manualTariffDuration').value);
    const selected = values.includes(previous) ? previous : values[0];
    $('manualTariffDuration').innerHTML = values.map(value => `<option value="${value}" ${value === selected ? 'selected' : ''}>${value} сек</option>`).join('');
    const model = manualTariffModel();
    const savedUnits = manualTokenTariffFor(model.id, variant.id, selected);
    $('manualTariffTokens').value = savedUnits > 0 ? Number(savedUnits.toFixed(2)) : '';
  }

  function saveManualTokenTariff() {
    const model = manualTariffModel();
    const variant = manualTariffVariant();
    const duration = Number($('manualTariffDuration').value);
    const units = Number(String($('manualTariffTokens').value).replace(',', '.'));
    if (!model || !variant || !(duration > 0) || !(units > 0)) {
      $('manualTariffMessage').textContent = 'Укажите модель, режим, длительность и расход токенов больше нуля.';
      return;
    }
    const key = manualTariffKeyFor(model.id, variant.id);
    const previous = settings.manualTokenTariffs[key];
    settings.manualTokenTariffs[key] = {
      unitsByDuration: {
        ...(previous?.unitsByDuration || {}),
        [String(duration)]: units
      },
      updatedAt: new Date().toISOString()
    };
    saveTariffSettings();
    saveLocal();
    $('manualTariffMessage').textContent = `Пользовательский тариф сохранён: ${model.name} · ${variant.label}: ${fmtNum(units, 2)} токенов за ${duration} сек.`;
    renderManualTariffList();
    renderManualUnits();
    renderResult();
    renderProject();
  }

  function renderManualTariffList() {
    const list = $('manualTariffList');
    if (!list || !pricing) return;
    const entries = Object.entries(settings.manualTokenTariffs || {})
      .flatMap(([key, saved]) => {
        const [modelId, variantId] = key.split('::');
        const model = pricing.models.find(item => item.id === modelId);
        const variant = model?.variants.find(item => item.id === variantId);
        const durationEntries = Object.entries(saved?.unitsByDuration || {});
        if (durationEntries.length) {
          return durationEntries.map(([duration, units]) => ({ key, duration: Number(duration), units: Number(units), model, variant, legacy: false }));
        }
        const unitsPerSecond = Number(typeof saved === 'object' ? saved.unitsPerSecond : saved);
        const sourceDuration = Number(typeof saved === 'object' ? saved.sourceDuration : 1);
        const sourceUnits = Number(typeof saved === 'object' ? saved.sourceUnits : saved);
        return unitsPerSecond > 0 ? [{ key, duration: sourceDuration, units: sourceUnits, unitsPerSecond, model, variant, legacy: true }] : [];
      })
      .filter(item => item.units > 0)
      .sort((a, b) => `${a.model?.name || a.key} ${a.duration}`.localeCompare(`${b.model?.name || b.key} ${b.duration}`, 'ru'));

    if (!entries.length) {
      list.innerHTML = '<div class="manual-tariff-empty">Сохранённых ручных тарифов пока нет.</div>';
      return;
    }
    list.innerHTML = entries.map(item => `
      <article class="manual-tariff-row" data-key="${esc(item.key)}" data-duration="${item.duration}" data-legacy="${item.legacy ? 'true' : 'false'}">
        <div><strong>${esc(item.model?.name || item.key)}</strong><span>${esc(item.variant?.label || 'Режим из прежней базы')} · ${item.duration} сек</span></div>
        <strong>${fmtNum(item.units, 2)} токенов</strong>
        <button class="manual-tariff-remove" type="button" aria-label="Удалить ручной тариф ${esc(item.model?.name || item.key)}">×</button>
      </article>`).join('');
    list.querySelectorAll('.manual-tariff-remove').forEach(button => button.addEventListener('click', () => {
      const key = button.closest('.manual-tariff-row')?.dataset.key;
      const duration = button.closest('.manual-tariff-row')?.dataset.duration;
      const legacy = button.closest('.manual-tariff-row')?.dataset.legacy === 'true';
      if (!key) return;
      if (legacy) {
        delete settings.manualTokenTariffs[key];
      } else {
        const saved = settings.manualTokenTariffs[key];
        if (saved?.unitsByDuration) delete saved.unitsByDuration[String(duration)];
        if (!Object.keys(saved?.unitsByDuration || {}).length) delete settings.manualTokenTariffs[key];
      }
      saveTariffSettings();
      saveLocal();
      $('manualTariffMessage').textContent = 'Ручной тариф удалён. Для этой комбинации снова будет использоваться расчёт по токенам.';
      renderManualTariffList();
      renderManualTariffDuration();
      renderManualUnits();
      renderResult();
      renderProject();
    }));
  }

  function resetManualTokenTariffs() {
    if (!confirm('Удалить все пользовательские тарифы и вернуться к базовым значениям? Проекты и настройки пакетов не изменятся.')) return;
    settings.manualTokenTariffs = {};
    settings.syntexManualUnits = {};
    saveTariffSettings();
    saveLocal();
    $('manualTariffMessage').textContent = 'Пользовательские поправки удалены. Используются базовые тарифы.';
    renderManualTariffEditor();
    renderManualUnits();
    renderResult();
    renderProject();
  }

  function manualKey() {
    const model = currentModel();
    const variant = currentVariant();
    return model && variant ? manualKeyFor(model.id, variant.id, currentDuration()) : '';
  }

  function getStoredManualUnits() {
    return settings.syntexManualUnits?.[manualKey()] ?? '';
  }

  function setStoredManualUnits(value) {
    const key = manualKey();
    if (!key) return;
    const n = Number(String(value).replace(',', '.'));
    if (n > 0) settings.syntexManualUnits[key] = n;
    else delete settings.syntexManualUnits[key];
    saveTariffSettings();
  }

  function renderManualUnits() {
    const model = currentModel();
    const variant = currentVariant();
    if (!variant) return;
    const needed = variant.billing.type === 'manual_required' && !hasManualTokenTariff(model?.id, variant.id, currentDuration());
    $('manualUnitsField').classList.toggle('hidden', !needed);
    $('manualUnits').value = needed ? getStoredManualUnits() : '';
  }

  function calculate() {
    return window.AIVideoCalculator.calculateSelection(pricing, settings, currentModel().id, currentVariant().id, currentDuration(), getStoredManualUnits());
  }

  function effectiveStatus(result) {
    return result.variant.status || result.model.status || 'manual';
  }

  function syntexEquivalent(modelId, variantId) {
    const sourceModel = pricing?.models?.find(model => model.id === modelId);
    if (!sourceModel) return null;
    if (sourceModel.provider === 'syntex') return { modelId, variantId };

    if (/^dreamina(?:-plus)?-seedance-25$/.test(modelId)) {
      const resolution = String(variantId).match(/(480|720|1080)p?$/)?.[1];
      if (!resolution) return null;
      return {
        modelId: 'syntx-seedance-25',
        variantId: String(variantId).startsWith('omni-reference-')
          ? `omni-reference-${resolution}`
          : `k-frames-${resolution}`
      };
    }

    const seedance20 = String(modelId).match(/^dreamina(?:-plus)?-seedance-20(?:-(mini|fast))?$/);
    if (seedance20) {
      const resolution = String(variantId).match(/(480|720|1080|4k)p?$/i)?.[1]?.toLowerCase();
      if (!resolution) return null;
      return { modelId: 'syntx-seedance-20', variantId: `${seedance20[1] || 'pro'}-${resolution}` };
    }

    if (modelId === 'kling-30' && ['1080-na', '1080-a'].includes(variantId)) {
      return { modelId: 'syntx-kling', variantId: `30-${variantId}` };
    }
    return null;
  }

  function syntexComparison(modelId, variantId, duration, count = 1, manualUnits = 0) {
    const equivalent = syntexEquivalent(modelId, variantId);
    if (!equivalent) return { error: 'Для этой модели точный аналог SYNTX пока не сопоставлен.' };
    try {
      const result = window.AIVideoCalculator.calculateSelection(pricing, settings, equivalent.modelId, equivalent.variantId, duration, manualUnits);
      const quantity = Math.max(1, Number(count) || 1);
      return {
        rub: result.rub * quantity,
        units: result.units * quantity,
        count: quantity,
        label: `${result.model.name} · ${result.variant.label}`
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  function syntexItemsComparison(items, estimate) {
    let rub = 0;
    let units = 0;
    let compared = 0;
    let missing = 0;
    (items || []).forEach(item => {
      const count = estimate ? Math.max(1, Number(item.qty) || 1) * Math.max(1, Number(item.generationsPerVideo) || 1) : 1;
      const sourceModel = pricing?.models?.find(model => model.id === item.modelId);
      const manualUnits = Number(item.manualUnits) > 0 ? Number(item.manualUnits) : sourceModel?.provider === 'syntex' ? Number(item.units) || 0 : 0;
      const result = syntexComparison(item.modelId, item.variantId, item.duration, count, manualUnits);
      if (result.error) missing += 1;
      else {
        rub += result.rub;
        units += result.units;
        compared += 1;
      }
    });
    if (!compared) return { error: items?.length ? 'Для позиций нет заполненных точных аналогов SYNTX.' : 'Сначала добавьте генерации.' };
    return { rub, units, count: compared, missing, label: `${compared} ${compared === 1 ? 'позиция' : 'позиций'}` };
  }

  function toggleSyntexComparison(button, output, calculateComparison) {
    if (!button || !output) return;
    const opening = output.classList.contains('hidden');
    if (!opening) {
      output.classList.add('hidden');
      button.setAttribute('aria-expanded', 'false');
      return;
    }
    const result = calculateComparison();
    output.classList.remove('hidden');
    button.setAttribute('aria-expanded', 'true');
    output.classList.toggle('has-error', Boolean(result.error));
    output.textContent = result.error
      ? result.error
      : `${result.label}: ${fmtRub(result.rub)} · ${fmtNum(result.units, 2)} токенов${result.missing ? ` · без аналога: ${result.missing}` : ''}`;
  }

  function syntexCompareMarkup(className = '') {
    return `<div class="syntex-compare-wrap ${className}"><button class="syntex-compare" type="button" aria-expanded="false"><span class="syntex-mark" aria-hidden="true">SX</span>В SYNTX</button><span class="syntex-comparison hidden"></span></div>`;
  }

  function bindInlineSyntexComparison(container, calculateComparison) {
    const button = container?.querySelector('.syntex-compare');
    const output = container?.querySelector('.syntex-comparison');
    if (button && output) button.addEventListener('click', () => toggleSyntexComparison(button, output, calculateComparison));
  }

  function renderResult() {
    if (!pricing || !currentModel() || !currentVariant()) return;
    $('calculatorSyntexComparison')?.classList.add('hidden');
    $('compareCalculatorSyntex')?.setAttribute('aria-expanded', 'false');
    let result;
    try {
      result = calculate();
    } catch (error) {
      $('resultPrice').textContent = '—';
      $('calculatorSummaryPrice').textContent = '—';
      $('resultMeta').innerHTML = `<span>${esc(error.message)}</span><span>Модель присутствует в каталоге, но расход токенов нужно подтвердить.</span>`;
      $('resultStatus').className = 'status unverified';
      $('resultStatus').textContent = '⚠ тариф не внесён';
      return;
    }

    $('resultPrice').textContent = fmtRub(result.rub);
    $('calculatorSummaryPrice').textContent = fmtRub(result.rub);
    const unitName = pricing.providers[result.model.provider].unit === 'credits' ? 'credits' : 'токенов';
    $('resultMeta').innerHTML = result.pricingMode === 'manual_duration_override'
      ? `<span>Пользовательский тариф: ${fmtNum(result.units, 2)} токенов за ${fmtNum(result.duration, 2)} сек</span><span>1 токен = ${fmtRub(result.unitRub)}</span><span>${cloudSession ? 'Поправка синхронизирована с личным облаком.' : 'Поправка хранится только в этом браузере.'}</span>`
      : result.pricingMode === 'manual_tokens_per_second'
      ? `<span>Ручной тариф: ${fmtNum(result.manualTokensPerSecond, 2)} токенов / сек</span><span>${fmtNum(result.duration, 2)} сек × ${fmtNum(result.manualTokensPerSecond, 2)} токенов / сек</span><span>1 токен = ${fmtRub(result.unitRub)} · ${cloudSession ? 'тариф синхронизирован с личным облаком.' : 'тариф будет синхронизирован после входа.'}</span>`
      : `<span>${fmtNum(result.units, 2)} ${unitName}</span>${result.usd !== null ? `<span>≈ ${fmtUsd(result.usd)}</span>` : ''}<span>1 ${result.model.provider === 'kling' ? 'credit' : 'токен'} = ${fmtRub(result.unitRub)}</span>${result.model.provider === 'dreamina-plus' ? '<span>Спецкурс: 100 ₽ / 10 500 токенов</span>' : result.model.provider === 'syntex' ? '<span>Расчёт по пакету SYNTX</span>' : `<span>Курс: ${fmtNum(settings.usdRub, 2)} ₽/$</span>`}<span>Тарифная база: ${esc(pricing.updated)}</span>`;
    const status = effectiveStatus(result);
    $('resultStatus').className = 'status ' + status;
    $('resultStatus').textContent = ['manual_duration_override', 'manual_tokens_per_second'].includes(result.pricingMode) ? '● свой тариф' : status === 'verified' ? '✓ verified' : status === 'unverified' ? '⚠ unverified' : '● manual';
  }

  function createNewProject() {
    openProjectNameDialog('create');
  }

  function openProjectNameDialog(mode) {
    projectDialogMode = mode;
    const project = activeProject();
    $('projectNameTitle').textContent = mode === 'rename' ? 'Переименовать проект' : 'Новый проект';
    $('saveProjectName').textContent = mode === 'rename' ? 'Сохранить название' : 'Создать проект';
    $('projectNameInput').value = mode === 'rename' && project ? project.name : '';
    $('projectNameError').classList.add('hidden');
    const dialog = $('projectNameDialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    setTimeout(() => $('projectNameInput').focus(), 0);
  }

  function closeProjectNameDialog() {
    const dialog = $('projectNameDialog');
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function saveProjectName(event) {
    event.preventDefault();
    const name = window.AIVideoProjectStore.normalizeName($('projectNameInput').value, '');
    if (!name) {
      $('projectNameError').classList.remove('hidden');
      $('projectNameInput').focus();
      return;
    }

    if (projectDialogMode === 'rename') {
      const project = activeProject();
      if (project) {
        project.name = name;
        project.updatedAt = new Date().toISOString();
      }
    } else {
      saveLocal();
      const project = window.AIVideoProjectStore.createProject(name, defaultProjectMeta(), defaultProjectItem());
      projects.unshift(project);
      activeProjectId = project.id;
      loadActiveProjectState();
      $('projectHistory').open = false;
    }

    actualDraft = { provider: settings.lastActualProvider || 'kling', modelId: '', variantId: '', duration: 5, manualUnits: '' };
    closeProjectNameDialog();
    saveLocal();
    renderProject();
  }

  function openSavedProject(id) {
    if (id === activeProjectId) return;
    saveLocal();
    activeProjectId = id;
    loadActiveProjectState();
    actualDraft = { provider: settings.lastActualProvider || 'kling', modelId: '', variantId: '', duration: 5, manualUnits: '' };
    window.AIVideoProjectStore.save(projects, activeProjectId);
    $('projectHistory').open = false;
    renderProject();
  }

  function closeActiveProject() {
    if (!activeProject()) return;
    // Сворачивание не является изменением проекта и не должно выигрывать конфликт синхронизации.
    syncActiveProjectState(false);
    activeProjectId = '';
    projectItems = [];
    actualItems = [];
    projectMeta = defaultProjectMeta();
    window.AIVideoProjectStore.save(projects, activeProjectId);
    $('projectHistory').open = true;
    renderProject();
  }

  async function toggleProjectCompletion() {
    const project = activeProject();
    if (!project) return;

    syncActiveProjectState(false);
    clearTimeout(projectSyncTimers.get(project.id));
    projectSyncTimers.delete(project.id);
    const completing = project.status !== 'completed';
    const now = new Date().toISOString();
    project.status = completing ? 'completed' : 'active';
    project.completedAt = completing ? now : null;
    project.reopenedAt = completing ? null : now;
    project.updatedAt = now;
    window.AIVideoProjectStore.save(projects, activeProjectId);

    if (cloudSession) {
      $('syncStatus').textContent = completing ? 'Сохраняем завершённый проект…' : 'Возвращаем проект в работу…';
      try {
        await window.AIVideoCloud.saveProject(project);
        $('syncStatus').textContent = `Синхронизировано ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
      } catch (_) {
        $('syncStatus').textContent = 'Offline: статус сохранён локально';
      }
    }

    if (completing) {
      activeProjectId = '';
      loadActiveProjectState();
      window.AIVideoProjectStore.save(projects, activeProjectId);
      $('projectHistory').open = true;
    }
    renderProject();
  }

  async function deleteSavedProject(id) {
    const project = projects.find(item => item.id === id);
    if (!project || !confirm(`Удалить проект «${project.name}»? Это действие нельзя отменить.`)) return;
    clearTimeout(projectSyncTimers.get(id));
    projectSyncTimers.delete(id);
    const deletedAt = new Date().toISOString();
    project.deletedAt = deletedAt;
    project.updatedAt = deletedAt;
    if (activeProjectId === id) {
      activeProjectId = '';
      loadActiveProjectState();
    }
    window.AIVideoProjectStore.save(projects, activeProjectId);
    renderProject();
    if (cloudSession) {
      try {
        await window.AIVideoCloud.saveProject(project);
        $('syncStatus').textContent = 'Проект удалён из облака';
      } catch (_) {
        $('syncStatus').textContent = 'Удалён на устройстве. Синхронизируем при подключении.';
      }
    }
  }

  function savedProjectSelection(provider) {
    const saved = settings.lastProjectSelectionByProvider?.[provider]
      || settings.lastCalculatorSelectionByProvider?.[provider]
      || {};
    return {
      modelId: saved.modelId || settings.lastProjectModelByProvider?.[provider] || (provider === 'kling' ? 'kling-30' : ''),
      variantId: saved.variantId || '',
      duration: Number(saved.duration) || 5
    };
  }

  function rememberProjectSelection(item) {
    const model = getProjectModel(item);
    const variant = getProjectVariant(item, model);
    if (!model || !variant) return;
    settings.lastProjectModelByProvider[model.provider] = model.id;
    const selection = {
      modelId: model.id,
      variantId: variant.id,
      duration: initialDurationForVariant(variant, item.duration)
    };
    settings.lastProjectSelectionByProvider[model.provider] = selection;
    settings.lastCalculatorSelectionByProvider[model.provider] = { ...selection };
    settings.lastProjectProvider = model.provider;
  }

  function defaultProjectItem(provider = settings.lastProjectProvider || settings.lastCalculatorProvider || 'kling') {
    provider = safeProvider(provider);
    const models = modelsForProvider(provider);
    const saved = savedProjectSelection(provider);
    const model = models.find(item => item.id === saved.modelId) || models[0];
    const variant = model?.variants.find(item => item.id === saved.variantId) || model?.variants?.[0];
    return {
      id: 'p-' + Date.now() + '-' + Math.random().toString(16).slice(2),
      provider,
      modelId: model?.id || '',
      variantId: variant?.id || '',
      duration: variant ? initialDurationForVariant(variant, saved.duration) : 5,
      manualUnits: '',
      qty: 1,
      generationsPerVideo: 1,
      rub: 0,
      units: 0
    };
  }

  function getProjectModel(item) {
    return pricing.models.find(model => model.id === item.modelId && model.provider === item.provider) || modelsForProvider(item.provider)[0];
  }

  function getProjectVariant(item, model = getProjectModel(item)) {
    return model?.variants.find(variant => variant.id === item.variantId) || model?.variants?.[0];
  }

  function normalizeProjectItem(item) {
    if (!PROVIDER_IDS.includes(item.provider)) item.provider = 'kling';
    const model = getProjectModel(item);
    if (!model) return item;
    item.modelId = model.id;
    const variant = getProjectVariant(item, model);
    if (!variant) return item;
    item.variantId = variant.id;
    item.duration = initialDurationForVariant(variant, item.duration);
    item.qty = Math.max(1, Math.round(Number(item.qty) || 1));
    item.generationsPerVideo = Math.max(1, Math.min(30, Math.round(Number(item.generationsPerVideo ?? item.extraQty) || 1)));
    delete item.extraQty;
    if (variant.billing.type === 'manual_required' && !hasManualTokenTariff(model.id, variant.id, item.duration) && !(Number(item.manualUnits) > 0)) {
      const saved = settings.syntexManualUnits?.[manualKeyFor(model.id, variant.id, item.duration)];
      if (Number(saved) > 0) item.manualUnits = Number(saved);
    }
    return item;
  }

  function recalcProjectItem(item) {
    normalizeProjectItem(item);
    item.calcError = '';
    try {
      const result = window.AIVideoCalculator.calculateSelection(pricing, settings, item.modelId, item.variantId, item.duration, item.manualUnits);
      item.rub = result.rub;
      item.units = result.units;
      item.name = result.model.name;
      item.variant = result.variant.label;
    } catch (error) {
      item.rub = 0;
      item.units = 0;
      item.calcError = error.message;
    }
    return item;
  }

  function projectDurationControl(item, variant) {
    const billing = variant.billing || {};
    if (Array.isArray(billing.allowedDurations) && billing.allowedDurations.length) {
      const values = billing.allowedDurations.map(Number);
      const normalized = initialDurationForVariant(variant, item.duration);
      const index = Math.max(0, values.indexOf(Number(normalized)));
      return `<div class="project-duration-slider"><input class="project-duration-range" type="range" min="0" max="${Math.max(0, values.length - 1)}" step="1" value="${index}" data-values="${esc(JSON.stringify(values))}"><output class="project-duration-value">${esc(values[index])} сек</output></div>`;
    }
    const range = billing.durationRange || { min: 1, max: 60, step: 1 };
    const normalized = initialDurationForVariant(variant, item.duration);
    return `<div class="project-duration-slider"><input class="project-duration-range" type="range" min="${esc(range.min)}" max="${esc(range.max)}" step="${esc(range.step)}" value="${esc(normalized)}"><output class="project-duration-value">${esc(normalized)} сек</output></div>`;
  }

  function projectRow(item, index) {
    normalizeProjectItem(item);
    const model = getProjectModel(item);
    const variant = getProjectVariant(item, model);
    const providerModels = modelsForProvider(item.provider);
    const manualNeeded = variant?.billing?.type === 'manual_required' && !hasManualTokenTariff(model.id, variant.id, item.duration);
    const rowBase = item.rub * item.qty;
    const rowExtraCount = item.qty * (item.generationsPerVideo - 1);
    const rowExtra = item.rub * rowExtraCount;
    const rowGenerationCount = item.qty * item.generationsPerVideo;

    const row = document.createElement('article');
    row.className = 'project-editor';
    row.dataset.id = item.id;
    row.innerHTML = `
      <div class="project-editor-head">
        <strong>Позиция ${index + 1}</strong>
        <button class="remove" type="button" aria-label="Удалить позицию">×</button>
      </div>
      <div class="project-editor-grid">
        <div class="field">
          <label>Провайдер</label>
          <select class="project-provider">
            ${providerOptions(item.provider)}
          </select>
        </div>
        <div class="field">
          <label>Модель</label>
          <select class="project-model">${providerModels.map(m => `<option value="${esc(m.id)}" ${m.id === model.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
        </div>
        <div class="field project-wide">
          <label>Режим / качество</label>
          <select class="project-variant">${model.variants.map(v => `<option value="${esc(v.id)}" ${v.id === variant.id ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label>Длительность</label>
          ${projectDurationControl(item, variant)}
        </div>
        <div class="field">
          <label>Готовых видео</label>
          <div class="stepper">
            <button class="stepper-btn" type="button" data-stepper="qty" data-step="-1" aria-label="Уменьшить количество готовых видео">−</button>
            <input class="project-qty" type="number" min="1" step="1" inputmode="numeric" value="${esc(item.qty)}" aria-label="Количество готовых видео">
            <button class="stepper-btn" type="button" data-stepper="qty" data-step="1" aria-label="Увеличить количество готовых видео">+</button>
          </div>
        </div>
        <div class="field">
          <label>Генераций на 1 готовое видео</label>
          <div class="stepper">
            <button class="stepper-btn" type="button" data-stepper="generations" data-step="-1" aria-label="Уменьшить число генераций на видео">−</button>
            <input class="project-generations-per-video" type="number" min="1" max="30" step="1" inputmode="numeric" value="${esc(item.generationsPerVideo)}" aria-label="Генераций на одно готовое видео">
            <button class="stepper-btn" type="button" data-stepper="generations" data-step="1" aria-label="Увеличить число генераций на видео">+</button>
          </div>
        </div>
        <div class="field ${manualNeeded ? '' : 'hidden'} project-manual-field">
          <label>Токенов SYNTX / генерацию</label>
          <input class="project-manual" type="number" min="0.01" step="0.01" value="${manualNeeded ? esc(item.manualUnits || '') : ''}" placeholder="Указать расход">
        </div>
      </div>
      <div class="project-line-result ${item.calcError ? 'has-error' : ''}">
        ${item.calcError
          ? `<span>⚠ ${esc(item.calcError)}</span>`
          : `<span>${fmtRub(item.rub)} / генерация</span><span>Готовые: ${item.qty} шт. · ${fmtRub(rowBase)}</span><span>Повторы: ${rowExtraCount} шт. · ${fmtRub(rowExtra)}</span><strong>Всего ${rowGenerationCount} генераций: ${fmtRub(rowBase + rowExtra)}</strong>${syntexCompareMarkup('project-syntex-compare')}`}
      </div>`;

    bindInlineSyntexComparison(row, () => syntexComparison(item.modelId, item.variantId, item.duration, rowGenerationCount, item.manualUnits));

    row.querySelector('.remove').addEventListener('click', () => {
      projectItems = projectItems.filter(x => x.id !== item.id);
      saveLocal();
      renderProject();
    });

    row.querySelector('.project-provider').addEventListener('change', event => {
      item.provider = event.target.value;
      const saved = savedProjectSelection(item.provider);
      const nextModel = modelsForProvider(item.provider).find(model => model.id === saved.modelId) || modelsForProvider(item.provider)[0];
      item.modelId = nextModel.id;
      const nextVariant = nextModel.variants.find(variant => variant.id === saved.variantId) || nextModel.variants[0];
      item.variantId = nextVariant.id;
      item.duration = initialDurationForVariant(nextVariant, saved.duration);
      item.manualUnits = '';
      rememberProjectSelection(item);
      saveLocal();
      renderProject();
    });

    row.querySelector('.project-model').addEventListener('change', event => {
      item.modelId = event.target.value;
      settings.lastProjectModelByProvider[item.provider] = item.modelId;
      const nextModel = getProjectModel(item);
      item.variantId = nextModel.variants[0].id;
      item.duration = initialDurationForVariant(nextModel.variants[0], 5);
      item.manualUnits = '';
      rememberProjectSelection(item);
      saveLocal();
      renderProject();
    });

    row.querySelector('.project-variant').addEventListener('change', event => {
      item.variantId = event.target.value;
      const nextVariant = getProjectVariant(item);
      item.duration = initialDurationForVariant(nextVariant, 5);
      item.manualUnits = '';
      rememberProjectSelection(item);
      saveLocal();
      renderProject();
    });

    const durationRange = row.querySelector('.project-duration-range');
    const durationOutput = row.querySelector('.project-duration-value');
    durationRange.addEventListener('input', event => {
      item.duration = durationFromSlider(event.target);
      durationOutput.textContent = `${item.duration} сек`;
      const saved = settings.syntexManualUnits?.[manualKeyFor(item.modelId, item.variantId, item.duration)];
      item.manualUnits = Number(saved) > 0 ? Number(saved) : '';
      const manual = row.querySelector('.project-manual');
      if (manual) manual.value = item.manualUnits || '';
      rememberProjectSelection(item);
      recalcProjectItem(item);
      saveLocal();
      renderTotals();
      updateProjectLineResult(row, item);
    });

    row.querySelector('.project-qty').addEventListener('input', event => {
      item.qty = Math.max(1, Math.round(Number(event.target.value) || 1));
      saveLocal();
      recalcProjectItem(item);
      renderTotals();
      updateProjectLineResult(row, item);
    });

    row.querySelector('.project-generations-per-video').addEventListener('input', event => {
      item.generationsPerVideo = Math.max(1, Math.min(30, Math.round(Number(event.target.value) || 1)));
      saveLocal();
      recalcProjectItem(item);
      renderTotals();
      updateProjectLineResult(row, item);
    });

    row.querySelectorAll('.stepper-btn').forEach(button => button.addEventListener('click', () => {
      const step = Number(button.dataset.step) || 0;
      if (button.dataset.stepper === 'qty') {
        item.qty = Math.max(1, item.qty + step);
        row.querySelector('.project-qty').value = item.qty;
      } else {
        item.generationsPerVideo = Math.max(1, Math.min(30, item.generationsPerVideo + step));
        row.querySelector('.project-generations-per-video').value = item.generationsPerVideo;
      }
      recalcProjectItem(item);
      saveLocal();
      renderTotals();
      updateProjectLineResult(row, item);
    }));

    const manualInput = row.querySelector('.project-manual');
    if (manualInput) {
      manualInput.addEventListener('change', event => {
        const n = Number(String(event.target.value).replace(',', '.'));
        item.manualUnits = n > 0 ? n : '';
        if (n > 0) settings.syntexManualUnits[manualKeyFor(item.modelId, item.variantId, item.duration)] = n;
        saveLocal();
        saveTariffSettings();
        renderProject();
      });
    }

    return row;
  }

  function updateProjectLineResult(row, item) {
    const box = row.querySelector('.project-line-result');
    if (!box) return;
    if (item.calcError) {
      box.className = 'project-line-result has-error';
      box.innerHTML = `<span>⚠ ${esc(item.calcError)}</span>`;
      return;
    }
    box.className = 'project-line-result';
    const rowBase = item.rub * item.qty;
    const rowExtraCount = item.qty * (item.generationsPerVideo - 1);
    const rowExtra = item.rub * rowExtraCount;
    const rowGenerationCount = item.qty * item.generationsPerVideo;
    box.innerHTML = `<span>${fmtRub(item.rub)} / генерация</span><span>Готовые: ${item.qty} шт. · ${fmtRub(rowBase)}</span><span>Повторы: ${rowExtraCount} шт. · ${fmtRub(rowExtra)}</span><strong>Всего ${rowGenerationCount} генераций: ${fmtRub(rowBase + rowExtra)}</strong>${syntexCompareMarkup('project-syntex-compare')}`;
    bindInlineSyntexComparison(box, () => syntexComparison(item.modelId, item.variantId, item.duration, rowGenerationCount, item.manualUnits));
  }

  function renderProjectMeta() {
    if (!$('laborPerVideoRub')) return;
    $('laborPerVideoRub').value = projectMeta.laborPerVideoRub;
    $('priceModeCalculated').checked = projectMeta.priceMode !== 'custom';
    $('priceModeCustom').checked = projectMeta.priceMode === 'custom';
    $('customQuotedPrice').value = projectMeta.customQuotedPrice || '';
    $('priceRounding').value = projectMeta.priceRounding;
    $('calculateWorkPrice').textContent = projectMeta.showWorkPrice ? 'Пересчитать цену' : 'Показать цену';
    $('customPriceField').classList.toggle('hidden', projectMeta.priceMode !== 'custom');
    $('includeImages').checked = projectMeta.includeImages;
    $('plannedImages').value = projectMeta.plannedImages;
    $('actualImages').value = projectMeta.actualImages;
    $('imageUnitRub').value = projectMeta.imageUnitRub;
    $('imageEstimateFields').classList.toggle('hidden', !projectMeta.includeImages);
    $('actualImageFields').classList.toggle('hidden', !projectMeta.includeImages);
  }

  function actualModelForDraft() {
    const models = modelsForProvider(actualDraft.provider);
    return models.find(model => model.id === actualDraft.modelId) || models[0];
  }

  function actualVariantForDraft(model = actualModelForDraft()) {
    return model?.variants.find(variant => variant.id === actualDraft.variantId) || model?.variants?.[0];
  }

  function syncActualManualFromStored() {
    const model = actualModelForDraft();
    const variant = actualVariantForDraft(model);
    if (!model || !variant) return;
    const needed = variant.billing?.type === 'manual_required' && !hasManualTokenTariff(model.id, variant.id, actualDraft.duration);
    $('actualManualField').classList.toggle('hidden', !needed);
    if (!needed) {
      actualDraft.manualUnits = '';
      $('actualManualUnits').value = '';
      return;
    }
    const saved = settings.syntexManualUnits?.[manualKeyFor(model.id, variant.id, actualDraft.duration)];
    if (!(Number(actualDraft.manualUnits) > 0)) actualDraft.manualUnits = Number(saved) > 0 ? Number(saved) : '';
    $('actualManualUnits').value = actualDraft.manualUnits || '';
  }

  function renderActualDraft() {
    if (!pricing || !$('actualProvider')) return;
    actualDraft.provider = safeProvider(actualDraft.provider);
    $('actualProvider').innerHTML = providerOptions(actualDraft.provider);
    if (!actualDraft.modelId) {
      const saved = settings.lastActualSelectionByProvider?.[actualDraft.provider] || savedProjectSelection(actualDraft.provider);
      Object.assign(actualDraft, saved);
    }
    $('actualProvider').value = actualDraft.provider;

    const models = modelsForProvider(actualDraft.provider);
    const model = models.find(item => item.id === actualDraft.modelId) || models[0];
    if (!model) return;
    actualDraft.modelId = model.id;
    $('actualModel').innerHTML = models.map(item => `<option value="${esc(item.id)}" ${item.id === model.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('');

    const variant = model.variants.find(item => item.id === actualDraft.variantId) || model.variants[0];
    actualDraft.variantId = variant.id;
    $('actualVariant').innerHTML = model.variants.map(item => `<option value="${esc(item.id)}" ${item.id === variant.id ? 'selected' : ''}>${esc(item.label)}</option>`).join('');

    actualDraft.duration = configureDurationSlider($('actualDurationRange'), $('actualDurationValue'), variant, actualDraft.duration || 5);
    syncActualManualFromStored();
    renderActualDraftResult();
  }

  function renderActualDraftResult() {
    if (!pricing || !$('actualDraftResult')) return;
    const model = actualModelForDraft();
    const variant = actualVariantForDraft(model);
    if (!model || !variant) return;
    try {
      const result = window.AIVideoCalculator.calculateSelection(pricing, settings, model.id, variant.id, actualDraft.duration, actualDraft.manualUnits);
      $('actualDraftResult').className = 'actual-draft-result ready';
      const detail = result.pricingMode === 'manual_tokens_per_second'
        ? `Ручной тариф ${fmtNum(result.manualTokensPerSecond, 2)} токенов / сек · ${actualDraft.duration} сек`
        : `${fmtNum(result.units, 2)} ${pricing.providers[model.provider].unit === 'credits' ? 'credits' : 'токенов'} · ${actualDraft.duration} сек`;
      $('actualDraftResult').innerHTML = `<span>${detail}</span><strong>${fmtRub(result.rub)}</strong>${syntexCompareMarkup('actual-draft-syntex')}`;
      bindInlineSyntexComparison($('actualDraftResult'), () => syntexComparison(model.id, variant.id, actualDraft.duration, 1, actualDraft.manualUnits));
      $('addActualGeneration').disabled = false;
    } catch (error) {
      $('actualDraftResult').className = 'actual-draft-result has-error';
      $('actualDraftResult').textContent = '⚠ ' + error.message;
      $('addActualGeneration').disabled = true;
    }
  }

  function addActualGeneration() {
    const model = actualModelForDraft();
    const variant = actualVariantForDraft(model);
    if (!model || !variant) return;
    try {
      const result = window.AIVideoCalculator.calculateSelection(pricing, settings, model.id, variant.id, actualDraft.duration, actualDraft.manualUnits);
      if (result.pricingMode !== 'manual_tokens_per_second' && variant.billing?.type === 'manual_required' && Number(actualDraft.manualUnits) > 0) {
        settings.syntexManualUnits[manualKeyFor(model.id, variant.id, actualDraft.duration)] = Number(actualDraft.manualUnits);
      }
      actualItems.push({
        id: 'a-' + Date.now() + '-' + Math.random().toString(16).slice(2),
        provider: model.provider,
        modelId: model.id,
        modelName: model.name,
        variantId: variant.id,
        variantLabel: variant.label,
        duration: result.duration,
        units: result.units,
        unitRub: result.unitRub,
        rub: result.rub,
        usdRub: settings.usdRub,
        pricingMode: result.pricingMode,
        manualTokensPerSecond: result.manualTokensPerSecond || 0,
        recordedAt: new Date().toISOString()
      });
      saveLocal();
      renderActualList();
      renderTotals();
    } catch (error) {
      $('actualDraftResult').className = 'actual-draft-result has-error';
      $('actualDraftResult').textContent = '⚠ ' + error.message;
    }
  }

  function renderActualList() {
    if (!$('actualList')) return;
    $('actualEmpty').classList.toggle('hidden', actualItems.length > 0);
    const unitFor = provider => provider === 'kling' ? 'credits' : 'токенов';
    $('actualList').innerHTML = actualItems.map((item, index) => `
      <article class="actual-item" data-id="${esc(item.id)}">
        <div class="actual-index">${index + 1}</div>
        <div class="actual-copy">
          <strong>${esc(item.modelName || item.modelId)}</strong>
          <span>${esc(item.variantLabel || item.variantId)} · ${fmtNum(item.duration, 2)} сек · ${fmtNum(item.units, 2)} ${unitFor(item.provider)}</span>
        </div>
        <div class="actual-cost">${fmtRub(item.rub)}${syntexCompareMarkup('actual-syntex-compare')}</div>
        <button class="actual-action actual-repeat" type="button" title="Повторить" aria-label="Повторить фактическую генерацию">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
        </button>
        <button class="actual-action actual-remove" type="button" title="Удалить" aria-label="Удалить фактическую генерацию">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 8 8 8M16 8l-8 8"/></svg>
        </button>
      </article>`).join('');

    $('actualList').querySelectorAll('.actual-item').forEach(row => {
      const item = actualItems.find(value => value.id === row.dataset.id);
      if (item) bindInlineSyntexComparison(row, () => syntexComparison(item.modelId, item.variantId, item.duration, 1, item.provider === 'syntex' ? item.units : 0));
    });

    $('actualList').querySelectorAll('.actual-repeat').forEach(button => {
      button.addEventListener('click', () => {
        const id = button.closest('.actual-item')?.dataset.id;
        const source = actualItems.find(item => item.id === id);
        if (!source) return;
        actualItems.push({
          ...JSON.parse(JSON.stringify(source)),
          id: 'a-' + Date.now() + '-' + Math.random().toString(16).slice(2),
          recordedAt: new Date().toISOString()
        });
        saveLocal();
        renderActualList();
        renderTotals();
      });
    });

    $('actualList').querySelectorAll('.actual-remove').forEach(button => {
      button.addEventListener('click', () => {
        const id = button.closest('.actual-item')?.dataset.id;
        actualItems = actualItems.filter(item => item.id !== id);
        saveLocal();
        renderActualList();
        renderTotals();
      });
    });
  }

  function renderProject() {
    if (!pricing) return;
    $('projectPrivateContent').classList.toggle('hidden', !projectAccess);
    $('createProject').classList.toggle('hidden', !projectAccess);
    if (!projectAccess) return;
    if (activeProject()) {
      projectItems = projectItems.map(recalcProjectItem);
      syncActiveProjectState(false);
      window.AIVideoProjectStore.save(projects, activeProjectId);
    }

    renderProjectHistory();
    const hasProject = Boolean(activeProject());
    $('projectEmpty').classList.toggle('hidden', hasProject);
    if (!hasProject) {
      $('projectEmpty').textContent = projects.some(project => !project.deletedAt)
        ? 'Выберите активный проект или откройте завершённый проект для просмотра.'
        : 'Сохранённых проектов пока нет. Нажми «Новый проект», введи название и начни расчёт.';
    }
    $('projectBuilder').classList.toggle('hidden', !hasProject);

    if (!hasProject) return;
    $('activeProjectName').textContent = activeProject().name;
    $('activeProjectUpdated').textContent = `Изменён ${formatProjectDate(activeProject().updatedAt)}`;
    renderProjectMeta();
    const list = $('projectList');
    list.innerHTML = '';
    projectItems.forEach((item, index) => list.appendChild(projectRow(item, index)));
    renderActualDraft();
    renderActualList();
    renderTotals();
    renderProjectCompletionState();
  }

  function renderProjectCompletionState() {
    const project = activeProject();
    if (!project) return;
    const completed = project.status === 'completed';
    const builder = $('projectBuilder');
    builder.classList.toggle('project-builder-completed', completed);
    const completionPanel = builder.querySelector('.project-completion-panel');
    const overview = $('completedOverview');
    overview.classList.toggle('hidden', !completed);
    if (completed) {
      const totals = window.AIVideoCalculator.calculateProject(projectItems, projectMeta, actualItems);
      overview.innerHTML = [['Цена заказчику', totals.quotedPrice], ['Себестоимость', totals.actualCost], ['Прибыль', totals.actualProfit]]
        .map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${fmtRub(value)}</strong></div>`).join('');
      builder.appendChild(completionPanel);
    } else {
      $('actualExpenses').querySelector('.project-subbody').appendChild(completionPanel);
    }
    $('activeProjectStatus').textContent = completed ? 'Завершённый проект' : 'Открытый черновик';
    $('activeProjectUpdated').textContent = completed
      ? `Завершён ${formatProjectDate(project.completedAt)}`
      : `Изменён ${formatProjectDate(project.updatedAt)}`;
    $('renameProject').classList.toggle('hidden', completed);
    $('completeProject').textContent = completed ? 'Вернуть в работу' : 'Завершить проект';
    $('completeProject').className = completed ? 'btn secondary complete-project-btn' : 'btn complete-project-btn';
    $('completionPanelKicker').textContent = completed ? 'Проект сохранён' : 'Финальный шаг';
    $('completionPanelTitle').textContent = completed ? 'Проект завершён' : 'Завершить проект';
    $('completionPanelText').textContent = completed
      ? 'Расчёт находится в истории и защищён от изменений. При необходимости верните проект в работу.'
      : 'Проверьте фактические расходы. После завершения проект сохранится в истории и будет доступен только для просмотра.';

    if (completed) {
      $('estimateDetails').open = false;
      $('actualExpenses').open = false;
      builder.querySelectorAll('input, select, button').forEach(control => {
        if (control.id === 'completeProject' || control.id === 'closeProject' || control.id === 'newProjectFromWorkspace' || control.classList.contains('syntex-compare') || control.disabled) return;
        control.disabled = true;
        control.dataset.completionDisabled = 'true';
      });
    } else {
      builder.querySelectorAll('[data-completion-disabled="true"]').forEach(control => {
        control.disabled = false;
        delete control.dataset.completionDisabled;
      });
    }
  }

  function formatProjectDate(value) {
    const date = new Date(value || Date.now());
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function renderProjectHistory() {
    const visibleProjects = projects.filter(project => !project.deletedAt);
    const count = visibleProjects.length;
    const ending = count % 100 >= 11 && count % 100 <= 14 ? 'проектов' : count % 10 === 1 ? 'проект' : count % 10 >= 2 && count % 10 <= 4 ? 'проекта' : 'проектов';
    $('projectCount').textContent = `${count} ${ending}`;
    $('projectHistory').classList.toggle('hidden', count === 0);
    const activeProjects = visibleProjects.filter(project => project.status !== 'completed');
    const completedProjects = visibleProjects.filter(project => project.status === 'completed');
    $('activeProjectCount').textContent = String(activeProjects.length);
    $('completedProjectCount').textContent = String(completedProjects.length);
    $('activeProjectsGroup').classList.toggle('hidden', activeProjects.length === 0);
    $('completedProjectsGroup').classList.toggle('hidden', completedProjects.length === 0);
    if (!activeProject() && count) $('projectHistory').open = true;

    const renderGroup = (listId, group) => {
      const list = $(listId);
      list.innerHTML = '';
      [...group]
        .sort((a, b) => new Date(b.completedAt || b.updatedAt) - new Date(a.completedAt || a.updatedAt))
        .forEach(project => {
        const totals = window.AIVideoCalculator.calculateProject(project.items || [], project.meta || defaultProjectMeta(), project.actualItems || []);
        const completed = project.status === 'completed';
        const card = document.createElement('article');
        card.className = 'history-item' + (project.id === activeProjectId ? ' active' : '') + (completed ? ' completed' : '');
        card.innerHTML = `
          <div class="history-copy">
            <strong>${esc(project.name)}</strong>
            <span>${completed ? 'Завершён ' + formatProjectDate(project.completedAt) : 'Изменён ' + formatProjectDate(project.updatedAt)} · ${(project.items || []).length} позиций</span>
          </div>
          <div class="history-finance">
            <div><span>Смета</span><strong>${fmtRub(totals.estimateCost)}</strong></div>
            ${project.meta?.showWorkPrice ? `<div class="client-price"><span>Заказчику</span><strong>${fmtRub(totals.quotedPrice)}</strong></div>` : ''}
            <div><span>Факт</span><strong>${fmtRub(totals.actualCost)}</strong></div>
            <div class="profit"><span>Прибыль</span><strong>${fmtRub(totals.actualProfit)}</strong></div>
          </div>
          <div class="history-actions">
            <button class="btn secondary history-open" type="button" ${project.id === activeProjectId ? 'disabled' : ''}>${project.id === activeProjectId ? 'Открыт' : completed ? 'Посмотреть' : 'Открыть'}</button>
            <button class="history-delete" type="button" aria-label="Удалить проект ${esc(project.name)}">×</button>
          </div>`;
        card.querySelector('.history-open').addEventListener('click', () => openSavedProject(project.id));
        card.querySelector('.history-delete').addEventListener('click', () => deleteSavedProject(project.id));
        list.appendChild(card);
      });
    };

    renderGroup('activeProjectList', activeProjects);
    renderGroup('completedProjectList', completedProjects);
  }

  function renderTotals() {
    if (!pricing) return;
    $('estimateSyntexComparison')?.classList.add('hidden');
    $('actualSyntexComparison')?.classList.add('hidden');
    $('compareEstimateSyntex')?.setAttribute('aria-expanded', 'false');
    $('compareActualSyntex')?.setAttribute('aria-expanded', 'false');
    const totals = window.AIVideoCalculator.calculateProject(projectItems, projectMeta, actualItems);
    $('baseTotal').textContent = fmtRub(totals.base);
    $('retryTotal').textContent = fmtRub(totals.reserve);
    $('grandTotal').textContent = fmtRub(totals.estimateCost);
    $('baseCount').textContent = `${totals.plannedGenerations} шт.`;
    $('retryCount').textContent = `${totals.extraGenerations} шт.`;
    $('grandCount').textContent = `${totals.totalGenerations} генераций`;
    $('estimateSummary').textContent = fmtRub(totals.estimateCost);

    $('plannedImageCost').textContent = fmtRub(totals.plannedImageCost);
    $('estimateImageTotal').textContent = fmtRub(totals.plannedImageCost);
    $('estimateImageCount').textContent = totals.includeImages ? `${totals.plannedImages} × ${fmtRub(projectMeta.imageUnitRub)}` : 'выключено';

    if (projectMeta.showWorkPrice && totals.estimateCost >= 0) {
      $('workPriceResult').classList.remove('hidden');
      $('workPrice').textContent = fmtRub(totals.quotedPrice);
      $('activeProjectPrice').textContent = 'Цена для заказчика · ' + fmtRub(totals.quotedPrice);
      $('activeProjectPrice').classList.remove('hidden');
      $('workPriceLabel').textContent = 'Цена для заказчика';
      const source = totals.priceMode === 'custom'
        ? `Своя цена ${fmtRub(totals.priceBeforeRounding)}`
        : `Себестоимость ${fmtRub(totals.estimateCost)} + ${totals.readyVideos} готовых видео × ${fmtRub(totals.laborPerVideoRub)}`;
      const rounding = totals.priceRounding === 'up' ? ' · округлено вверх до 100 ₽' : totals.priceRounding === 'down' ? ' · округлено вниз до 100 ₽' : '';
      $('workPriceMeta').textContent = `${source} = ${fmtRub(totals.quotedPrice)}${rounding}.`;
    } else {
      $('workPriceResult').classList.add('hidden');
      $('activeProjectPrice').classList.add('hidden');
    }

    $('actualSummary').textContent = fmtRub(totals.actualCost);
    $('actualVideoTotal').textContent = fmtRub(totals.actualVideoCost);
    $('actualVideoCount').textContent = `${totals.actualVideoGenerations} шт.`;
    $('actualImageCost').textContent = fmtRub(totals.actualImageCost);
    $('actualImagesTotal').textContent = fmtRub(totals.actualImageCost);
    $('actualImagesCount').textContent = totals.includeImages ? `${totals.actualImages} × ${fmtRub(projectMeta.imageUnitRub)}` : 'выключено';
    $('actualTotal').textContent = fmtRub(totals.actualCost);

    $('compareEstimate').textContent = fmtRub(totals.estimateCost);
    $('compareActual').textContent = fmtRub(totals.actualCost);
    $('plannedProfit').textContent = fmtRub(totals.plannedProfit);
    const hasActual = totals.actualVideoGenerations > 0 || (totals.includeImages && totals.actualImages > 0);
    if (!hasActual) {
      $('varianceLabel').textContent = 'Отклонение';
      $('varianceValue').textContent = '—';
      $('varianceValue').className = '';
      $('actualProfit').textContent = '—';
      $('actualProfit').className = '';
      $('actualProfitMeta').textContent = 'Добавь фактические генерации, чтобы сравнить план и факт.';
      return;
    }

    const varianceAbs = Math.abs(totals.variance);
    if (totals.variance > 0.005) {
      $('varianceLabel').textContent = 'Перерасход';
      $('varianceValue').textContent = fmtRub(varianceAbs);
      $('varianceValue').className = 'negative-value';
    } else if (totals.variance < -0.005) {
      $('varianceLabel').textContent = 'Экономия (пока)';
      $('varianceValue').textContent = fmtRub(varianceAbs);
      $('varianceValue').className = 'positive-value';
    } else {
      $('varianceLabel').textContent = 'Отклонение';
      $('varianceValue').textContent = fmtRub(0);
      $('varianceValue').className = '';
    }
    $('actualProfit').textContent = fmtRub(totals.actualProfit);
    $('actualProfit').className = totals.actualProfit < 0 ? 'negative-value' : 'positive-value';
    $('actualProfitMeta').textContent = `${totals.priceMode === 'custom' ? 'Цена для заказчика' : 'Расчётная цена'} ${fmtRub(totals.quotedPrice)} − текущий фактический расход ${fmtRub(totals.actualCost)}. До завершения проекта результат предварительный.`;
  }

  function renderUnitPrices() {
    if (!pricing) return;
    $('klingUnitPrice').textContent = fmtRub(window.AIVideoCalculator.unitPriceRub('kling', settings, pricing));
    $('syntexUnitPrice').textContent = fmtRub(window.AIVideoCalculator.unitPriceRub('syntex', settings, pricing));
    $('dreaminaUnitPrice').textContent = fmtRub(window.AIVideoCalculator.unitPriceRub('dreamina', settings, pricing));
    $('dreaminaPlusUnitPrice').textContent = fmtRub(window.AIVideoCalculator.unitPriceRub('dreamina-plus', settings, pricing));
  }

  function renderDataStatus(warning) {
    if (!pricing) return;
    $('dataStatus').textContent = `pricing.json: ${pricing.dataVersion} · ${pricing.updated} · источник загрузки: ${pricingSource}${warning ? ' · fallback: ' + warning : ''}`;
    renderUnitPrices();
  }

  function renderSourceLinks() {
    const box = $('sourceLinks');
    if (!pricing?.verification?.sources) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = pricing.verification.sources.map(source => `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)}</a>`).join('');
  }

  function addCheck(rows, type, title, detail) {
    rows.push({ type, title, detail });
  }

  function ageDays(dateText) {
    const t = Date.parse(dateText + 'T00:00:00Z');
    return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : 9999;
  }

  function localPricingChecks() {
    const rows = [];
    const verification = pricing.verification || {};
    const age = ageDays(pricing.updated);
    addCheck(rows, age <= 30 ? 'pass' : 'warn', 'Дата тарифной базы', `${pricing.updated} · ${age < 0 ? 0 : age} дн. назад`);

    const kling = pricing.models.find(model => model.id === 'kling-30');
    const expected = verification.kling30Rates || [];
    let klingOk = !!kling;
    for (const ref of expected) {
      const variant = kling?.variants.find(x => x.id === ref.variantId);
      if (!variant || Number(variant.billing?.unitsPerSecond) !== Number(ref.unitsPerSecond)) klingOk = false;
    }
    addCheck(rows, klingOk ? 'pass' : 'fail', 'Kling 3.0 · контрольные ставки', klingOk ? '720p/1080p совпадают с контрольным официальным снимком от 19.08.2026.' : 'Есть расхождение с контрольными значениями.');

    const ids = new Set(pricing.models.filter(model => model.provider === 'syntex').map(model => model.id));
    const required = verification.requiredSyntexModelIds || [];
    const missing = required.filter(id => !ids.has(id));
    addCheck(rows, missing.length ? 'fail' : 'pass', 'Каталог SYNTX', missing.length ? `Не хватает ${missing.length} групп: ${missing.join(', ')}` : `В базе ${ids.size} групп видеомоделей/инструментов; контрольный список присутствует полностью.`);

    const unpriced = pricing.models.filter(model => model.provider === 'syntex').flatMap(model => model.variants.map(variant => ({ model, variant }))).filter(x => x.variant.billing?.type === 'manual_required').length;
    addCheck(rows, 'info', 'Неподтверждённые цены SYNTX', `${unpriced} режимов находятся в каталоге, но требуют фактического расхода токенов; приложение их не выдумывает.`);
    return rows;
  }

  async function probeSource(source) {
    try {
      const readable = await fetch(source.url, { cache: 'no-store' });
      if (!readable.ok) throw new Error('HTTP ' + readable.status);
      const text = await readable.text();
      if (source.id === 'syntx-status') {
        const needles = ['Kling', 'Veo 3.1', 'Seedance TWO', 'Wan 2.7', 'Happy Horse', 'FLUX 3'];
        const missing = needles.filter(x => !text.includes(x));
        return { type: missing.length ? 'warn' : 'pass', title: source.title, detail: missing.length ? `Источник прочитан, но не найдены: ${missing.join(', ')}.` : 'Источник прочитан: контрольные текущие семейства/режимы найдены.' };
      }
      if (source.id === 'syntx-video-docs') {
        const needles = ['KLING', 'Seedance', 'RUNWAY', 'Higgsfield', 'Hailuo MiniMax', 'Veo'];
        const missing = needles.filter(x => !text.toLowerCase().includes(x.toLowerCase()));
        return { type: missing.length ? 'warn' : 'pass', title: source.title, detail: missing.length ? `Каталог прочитан, но часть контрольных названий не найдена: ${missing.join(', ')}.` : 'Каталог SYNTX прочитан и содержит контрольные видеомодели.' };
      }
      if (source.id === 'kling-3-official-guide') {
        const normalized = text.replace(/\s+/g, ' ');
        const ok = /8\s*credits/i.test(normalized) && /12\s*credits/i.test(normalized);
        return { type: ok ? 'pass' : 'info', title: source.title, detail: ok ? 'Официальная страница прочитана; контрольные 8 и 12 credits найдены.' : 'Официальная страница доступна, но автоматический поиск ставок в её HTML не дал надёжного результата.' };
      }
      return { type: 'pass', title: source.title, detail: 'Источник доступен и читается браузером.' };
    } catch (readError) {
      try {
        await fetch(source.url, { mode: 'no-cors', cache: 'no-store' });
        return { type: 'info', title: source.title, detail: 'Источник доступен по сети, но браузер не разрешил прочитать содержимое (CORS). Полная сверка будет выполняться через GitHub Actions.' };
      } catch (error) {
        return { type: 'warn', title: source.title, detail: 'Источник не удалось проверить из локального браузера: ' + error.message };
      }
    }
  }

  function renderCheckRows(rows) {
    $('checkList').innerHTML = rows.map(row => `<div class="check-row ${esc(row.type)}"><div class="icon">${row.type === 'pass' ? '✓' : row.type === 'fail' ? '×' : row.type === 'warn' ? '!' : 'i'}</div><div><strong>${esc(row.title)}</strong><small>${esc(row.detail)}</small></div></div>`).join('');
  }

  async function runPricingCheck(withNetwork) {
    if (!pricing) return;
    const button = $('checkPricing');
    if (withNetwork) {
      button.disabled = true;
      button.textContent = 'Проверяю…';
    }

    const rows = localPricingChecks();
    renderCheckRows(rows);
    $('checkSummary').textContent = 'Локальная проверка базы выполнена.';

    if (withNetwork) {
      const sources = (pricing.verification?.sources || []).filter(source => ['official-rate', 'catalog', 'catalog-status'].includes(source.kind));
      const probes = await Promise.all(sources.map(probeSource));
      rows.push(...probes);
      renderCheckRows(rows);
      settings.lastPricingCheck = new Date().toISOString();
      saveLocal();
      const problems = rows.filter(row => row.type === 'fail').length;
      const warnings = rows.filter(row => row.type === 'warn').length;
      $('checkSummary').textContent = `Проверено ${new Date().toLocaleString('ru-RU')}: критических расхождений ${problems}, предупреждений ${warnings}.`;
      button.disabled = false;
      button.textContent = 'Проверить сейчас';
    } else if (settings.lastPricingCheck) {
      $('checkSummary').textContent = `Локальная проверка базы выполнена. Последняя сетевая попытка: ${new Date(settings.lastPricingCheck).toLocaleString('ru-RU')}.`;
    }
  }

  async function refreshPricing() {
    const button = $('refreshPricing');
    button.disabled = true;
    button.textContent = 'Обновляю…';
    try {
      const loaded = await window.AIVideoPricing.loadPricing(true);
      pricing = loaded.data;
      pricingSource = loaded.source;
      renderDataStatus(loaded.warning);
      renderSourceLinks();
      renderManualTariffEditor();
      renderModels();
      renderProject();
      runPricingCheck(false);
    } catch (error) {
      $('dataStatus').textContent = 'Не удалось обновить тарифы: ' + error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Обновить pricing.json';
    }
  }

  async function refreshRate(silent = false) {
    const button = $('refreshRate');
    const quick = $('quickRefreshRate');
    if (!silent) {
      button.disabled = true;
      quick.disabled = true;
      button.textContent = 'Обновляю…';
      quick.textContent = '…';
      $('rateStatus').textContent = 'Запрашиваю USD/RUB…';
    }

    let lastError = null;
    for (const fn of [fetchMarketRate, fetchCbrRate]) {
      try {
        const result = await fn();
        if (!Number.isFinite(result.rate)) throw new Error('Некорректный курс');
        settings.usdRub = Number(result.rate.toFixed(4));
        $('usdRub').value = settings.usdRub;
        saveTariffSettings();
        saveLocal();
        renderHeadlineRate();
        renderResult();
        renderProject();
        renderUnitPrices();
        $('rateStatus').textContent = `Курс обновлён: ${result.source}${result.date ? ' · ' + result.date : ''}`;
        button.disabled = false;
        quick.disabled = false;
        button.textContent = 'Обновить курс автоматически';
        quick.textContent = '↻';
        return;
      } catch (error) {
        lastError = error;
      }
    }

    if (!silent) $('rateStatus').textContent = 'Не удалось обновить курс. Используется сохранённое значение. ' + (lastError ? lastError.message : '');
    button.disabled = false;
    quick.disabled = false;
    button.textContent = 'Обновить курс автоматически';
    quick.textContent = '↻';
    renderHeadlineRate();
  }

  async function fetchMarketRate() {
    const response = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' });
    if (!response.ok) throw new Error('open.er-api недоступен');
    const data = await response.json();
    return { rate: Number(data?.rates?.RUB), source: 'open.er-api', date: data?.time_last_update_utc || '' };
  }

  async function fetchCbrRate() {
    const response = await fetch('https://www.cbr-xml-daily.ru/daily_json.js', { cache: 'no-store' });
    if (!response.ok) throw new Error('cbr-xml-daily недоступен');
    const data = await response.json();
    return { rate: Number(data?.Valute?.USD?.Value), source: 'ЦБ РФ / cbr-xml-daily', date: data?.Date || '' };
  }

  function exportData() {
    syncActiveProjectState(false);
    const payload = {
      app: 'AI VIDEO CALC 3.0',
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      settings,
      activeProjectId,
      projects
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'ai-video-calc-v3-data.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 500);
  }

  async function importData(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      settings = { ...settings, ...(data.settings || {}) };
      if (!settings.syntexManualUnits) settings.syntexManualUnits = {};
      if (Array.isArray(data.projects)) {
        projects = data.projects.map(project => window.AIVideoProjectStore.normalizeProject(project, defaultProjectMeta()));
        activeProjectId = '';
      } else {
        const imported = window.AIVideoProjectStore.createProject('Импортированный проект', defaultProjectMeta());
        imported.meta = { ...defaultProjectMeta(), ...(data.projectMeta || {}) };
        imported.items = Array.isArray(data.projectItems) ? data.projectItems : [];
        imported.actualItems = Array.isArray(data.actualItems) ? data.actualItems : [];
        projects = [imported];
        activeProjectId = '';
      }
      loadActiveProjectState();
      projectItems = projectItems.map(item => ({ ...item, qty: Math.max(1, Math.round(Number(item.qty) || 1)) }));
      saveLocal();
      saveTariffSettings();
      hydrateSettings();
      renderHeadlineRate();
      renderManualUnits();
      renderResult();
      renderProject();
      renderUnitPrices();
    } catch (error) {
      alert('Не удалось импортировать JSON: ' + error.message);
    }
    event.target.value = '';
  }

  function resetData() {
    if (!confirm('Сбросить локальные настройки и всю историю проектов на этом устройстве?')) return;
    localStorage.removeItem(STORAGE_KEY);
    window.AIVideoProjectStore.clear();
    location.reload();
  }

  document.addEventListener('DOMContentLoaded', () => init().catch(error => {
    $('dataStatus').textContent = 'Ошибка запуска: ' + error.message;
  }));
})();
