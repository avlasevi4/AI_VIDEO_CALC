import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the real application handlers without a browser, network or user data.
class Element {
  constructor() {
    this.dataset = {}; this.attributes = {}; this.children = []; this.nodes = new Map();
    this.value = ''; this.textContent = ''; this.disabled = false; this.open = false;
    const classes = new Set();
    this.classList = {
      add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name),
      toggle(name, force) { const on = force ?? !classes.has(name); on ? classes.add(name) : classes.delete(name); return on; }
    };
  }
  set innerHTML(value) {
    this.html = value; this.children = [];
    const options = [...value.matchAll(/<option value="([^"]*)"([^>]*)>/g)];
    if (options.length) this.value = (options.find(option => /\bselected\b/.test(option[2])) || options[0])[1];
  }
  get innerHTML() { return this.html || ''; }
  querySelector(selector) {
    if (selector === '.active') return null;
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
    return this.nodes.get(selector);
  }
  querySelectorAll() { return []; }
  appendChild(child) { this.children.push(child); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener() {}
}
const elements = new Map();
const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
const currencyButtons = ['RUB', 'USD'].map(displayCurrency => Object.assign(new Element(), {dataset:{displayCurrency}}));
const privateElements = [new Element(), new Element()];
const estimateRow = new Element(); estimateRow.dataset.id = 'estimate-1';
const actualRow = new Element(); actualRow.dataset.id = 'actual-1';
const repeatButton = actualRow.querySelector('.actual-repeat'); repeatButton.disabled = true;
const writes = [];
const store = new Map();
const scheduled = new Map();
let timerId = 0;
const context = vm.createContext({
  window: {addEventListener() {}},
  document: {
    addEventListener() {}, getElementById:get, createElement:() => new Element(),
    querySelectorAll(selector) {
      if (selector === '[data-display-currency]') return currencyButtons;
      if (selector.startsWith('[data-private-provider=')) return privateElements;
      if (selector === '#projectList .project-editor') return [estimateRow];
      if (selector === '#actualList .actual-item') return [actualRow];
      return [];
    }
  },
  localStorage: {getItem:key => store.get(key) ?? null, setItem(key,value) { writes.push(key); store.set(key,value); }},
  setTimeout(fn) { scheduled.set(++timerId,fn); return timerId; }, clearTimeout:id => scheduled.delete(id), console
});
const load = async path => vm.runInContext(await readFile(new URL(path, import.meta.url),'utf8'),context,{filename:path});
await load('../js/calculator.js');
await load('../js/preferences.js');
const appSource = await readFile(new URL('../js/app.js',import.meta.url),'utf8');
const bridge = `
  window.testPreferences = {
    setup(data, project) {
      pricing = data; projects = [project]; activeProjectId = project.id;
      projectItems = project.items; actualItems = project.actualItems; projectMeta = project.meta;
      settings.usdRub = 80; cloudSession = {user:{id:'owner'}};
      actualDraft = {provider:'dreamina-plus',modelId:'dreamina-plus-seedance-25',variantId:'720p',duration:10};
    },
    get settings(){return settings}, get project(){return activeProject()},
    get provider(){return currentProvider}, set provider(value){currentProvider=value},
    set session(value){cloudSession=value},
    changeDisplayCurrency, changeDreaminaPlusVisibility, synchronizeCloudTariffs,
    sharedTariffs, applySharedTariffs, visibleProviderIds, providerOptions,
    normalizeProjectItem, renderManualTariffEditor, renderDisplayPreferences,
    toggleSyntexComparison, configureDurationSlider, syntexComparison
  };
`;
vm.runInContext(appSource.replace(/\}\)\(\);\s*$/,bridge+'})();'),context,{filename:'app.js'});
const app = context.window.testPreferences;
const pricing = JSON.parse(await readFile(new URL('../data/pricing.json',import.meta.url),'utf8'));
const project = {
  id:'completed-test',name:'Тест',status:'completed',updatedAt:'2026-10-01T00:00:00Z',
  items:[{id:'estimate-1',provider:'dreamina-plus',modelId:'dreamina-plus-seedance-25',variantId:'720p',duration:10,qty:2,generationsPerVideo:2,rub:80,units:370}],
  actualItems:[{id:'actual-1',provider:'dreamina-plus',modelId:'dreamina-plus-seedance-25',variantId:'720p',duration:10,rub:80,units:370,usdRub:100}],
  meta:{laborPerVideoRub:250,priceMode:'custom',customQuotedPrice:1600,priceRounding:'none',showWorkPrice:true,includeImages:false}
};
app.setup(pricing,project);
for (const [modelId,variantId,units] of [
  ['kling-25','720-na',12],['kling-25','1080-na',34],
  ['kling-26','720-na',28],['kling-26','1080-na',42],
  ['kling-30','720-na',30],['kling-30','4k-na',150]
]) {
  const result = app.syntexComparison(modelId,variantId,10);
  assert.equal(result.units,units,`Existing SYNTX rate connected: ${modelId}/${variantId}`);
  assert.ok(!result.error);
}
for (const [modelId,variantId] of [['kling-26','1080-a'],['kling-30','720-a'],['kling-30','4k-a'],['kling-o1-old','720-na'],['kling-o1-old','1080-na'],['kling-40','omni-reference-video-720']]) {
  assert.ok(app.syntexComparison(modelId,variantId,10).error,'missing prices cannot fall back to a different model or audio mode');
}
const draftBefore=JSON.stringify(project);
app.provider='kling'; get('modelSelect').value='kling-40';get('variantSelect').value='omni-reference-video-720';get('durationNumber').value=3;
app.changeDisplayCurrency('RUB');
assert.match(get('resultMeta').innerHTML,/Предварительная цена/,'unconfirmed short durations carry a visible warning');
assert.equal(JSON.stringify(project),draftBefore);
for (const variant of pricing.models.find(model=>model.id==='kling-40').variants) {
  const slider = new Element(), output = new Element();
  assert.equal(app.configureDurationSlider(slider,output,variant,2),3,'Kling 4.0 UI retains the minimum of 3 seconds');
  assert.equal(app.configureDurationSlider(slider,output,variant,31),30,'Kling 4.0 UI retains the maximum of 30 seconds');
  assert.equal(slider.min,3); assert.equal(slider.max,30); assert.equal(slider.step,1);
}
get('modelSelect').value='dreamina-plus-seedance-25'; get('variantSelect').value='720p'; get('durationNumber').value=10;
app.provider='dreamina-plus';
const before = JSON.stringify(project);

app.changeDisplayCurrency('USD');
assert.equal(get('actualTotal').textContent,'1,00 $');
assert.equal(get('grandTotal').textContent,'4,00 $');
assert.equal(get('workPrice').textContent,'20,00 $');
assert.equal(get('actualProfit').textContent,'19,00 $');
assert.equal(actualRow.querySelector('.actual-cost > strong').textContent,'1,00 $');
assert.match(estimateRow.querySelector('.project-line-result').innerHTML,/Всего 4 генераций: 4,00 \$/);
assert.match(get('completedOverview').innerHTML,/20,00 \$/);
assert.match(get('completedProjectList').children[0].innerHTML,/19,00 \$/);
assert.match(get('resultPrice').textContent,/ \$$/);
assert.equal(repeatButton.disabled,true,'currency changes retain completed-project button protection');
assert.equal(currencyButtons[1].attributes['aria-pressed'],'true');
assert.equal(JSON.stringify(project),before,'display changes retain recorded RUB costs, historical rate and timestamps');
assert.ok(writes.every(key=>key==='ai-video-calc-v2-settings'),'display changes never write the project library');
assert.equal(scheduled.size,0,'display changes never schedule cloud writes');
const comparisonButton = new Element(), comparisonOutput = new Element(); comparisonOutput.classList.add('hidden');
app.toggleSyntexComparison(comparisonButton,comparisonOutput,()=>({label:'Тест SYNTX',rub:800,units:10}));
assert.match(comparisonOutput.innerHTML,/10,00 \$/,'SYNTX comparison uses selected currency');
app.changeDisplayCurrency('RUB');
assert.equal(get('actualTotal').textContent,'80,00 ₽');
assert.equal(get('grandTotal').textContent,'320,00 ₽');
assert.equal(JSON.stringify(project),before);

app.changeDreaminaPlusVisibility(false);
assert.equal(app.settings.showDreaminaPlus,false);
assert.equal(app.provider,'kling','hiding the selected Plus calculator selects a public provider');
assert.ok(privateElements.every(element=>element.classList.contains('hidden')));
assert.equal(app.visibleProviderIds().includes('dreamina-plus'),false);
assert.doesNotMatch(app.providerOptions('kling'),/value="dreamina-plus"/,'new calculations do not offer hidden Plus');
assert.match(app.providerOptions('dreamina-plus'),/dreamina-plus.*скрыт для новых расчётов/,'existing Plus estimate retains its selected provider');
assert.equal(JSON.stringify(project),before,'hiding Plus never rewrites existing projects');
const normalized = app.normalizeProjectItem(structuredClone(project.items[0]));
assert.equal(normalized.provider,'dreamina-plus','hidden provider remains valid for existing rows');
app.renderManualTariffEditor();
assert.doesNotMatch(get('manualTariffProvider').innerHTML,/value="dreamina-plus"/,'manual editor does not restore a hidden provider');
assert.equal(app.sharedTariffs().showDreaminaPlus,false);
assert.equal(Object.hasOwn(app.sharedTariffs(),'displayCurrency'),false,'device display currency does not enter shared tariff settings');

let remote = null;
let saves = 0;
context.window.AIVideoCloud = {
  loadSettings:async()=>remote,
  saveSettings:async(settings,updatedAt)=>{ saves++; remote={settings:structuredClone(settings),updatedAt}; return remote; }
};
await app.synchronizeCloudTariffs();
assert.equal(saves,1);
assert.equal(remote.settings.showDreaminaPlus,false,'owner visibility preference reaches the existing cloud adapter');
assert.equal(JSON.stringify(project),before,'visibility-only cloud sync cannot recalculate a project');
app.changeDisplayCurrency('USD');
remote={settings:{...remote.settings,showDreaminaPlus:true},updatedAt:'2099-01-01T00:00:00Z'};
await app.synchronizeCloudTariffs();
assert.equal(app.settings.showDreaminaPlus,true,'newer owner preference is restored from cloud');
assert.equal(app.settings.displayCurrency,'USD','cloud restore preserves device display currency');
assert.ok(privateElements.every(element=>!element.classList.contains('hidden')));
assert.equal(JSON.stringify(project),before);

app.session=null;
app.renderDisplayPreferences();
assert.equal(get('ownerPreferences').classList.contains('hidden'),true);
assert.equal(get('showDreaminaPlus').disabled,true);
const timestamp=app.settings.sharedTariffsUpdatedAt;
app.changeDreaminaPlusVisibility(false);
assert.equal(app.settings.showDreaminaPlus,true,'guest cannot change owner preference');
assert.equal(app.settings.sharedTariffsUpdatedAt,timestamp);
assert.equal(app.visibleProviderIds().includes('dreamina-plus'),false,'guest never receives the private provider');
console.log('Application preferences, display-only costs and owner cloud settings tests OK');
