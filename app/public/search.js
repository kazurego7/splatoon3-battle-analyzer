import { filterMatchRecords, matchReviewUrl, recordSelfWeapon, ruleIconUrl, searchDimensions, stageIconUrl, weaponCatalogEntry, weaponTypeForName, weaponTypeTabs } from './search-core.js';

const byId = id => document.getElementById(id);
const state = {
  records: [], weaponCatalog: [],
  selections: { stages: new Set(), rules: new Set(), selfWeapons: new Set(), opponentWeapons: new Set() },
  weaponTypeByFilter: { selfWeapons: 'すべて', opponentWeapons: 'すべて' },
};
let activeFilterKey = null;

const FILTERS = [
  { key: 'stages', container: 'stage-options', count: 'stage-selection-count', summary: 'stage-selection-summary', preview: 'stage-selection-preview', kind: 'stage', title: 'ステージ', description: '選択したいずれかのステージを含む試合' },
  { key: 'rules', container: 'rule-options', count: 'rule-selection-count', summary: 'rule-selection-summary', preview: 'rule-selection-preview', kind: 'rule', title: 'ルール', description: '選択したいずれかのルールの試合' },
  { key: 'selfWeapons', container: 'self-weapon-options', count: 'self-weapon-selection-count', summary: 'self-weapon-selection-summary', preview: 'self-weapon-selection-preview', kind: 'weapon', title: '自分のブキ', description: '自分が選択したブキを使用した試合' },
  { key: 'opponentWeapons', container: 'opponent-weapon-options', count: 'opponent-weapon-selection-count', summary: 'opponent-weapon-selection-summary', preview: 'opponent-weapon-selection-preview', kind: 'weapon', title: '相手のブキ', description: '相手編成に選択したブキを含む試合' },
];

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text != null) item.textContent = text;
  return item;
}

function normalizedSearchText(value) {
  return String(value || '').replace(/[・.\s]/g, '').toLocaleLowerCase('ja');
}

function weaponIcon(name) {
  return weaponCatalogEntry(name, state.weaponCatalog)?.iconUrl || null;
}

function optionImage(url, alt) {
  const shell = node('span', 'option-image');
  const fallback = node('i', '', '?'); fallback.setAttribute('aria-hidden', 'true');
  shell.append(fallback);
  if (url) {
    const image = document.createElement('img'); image.src = url; image.alt = ''; image.loading = 'lazy';
    image.addEventListener('load', () => fallback.hidden = true);
    image.addEventListener('error', () => image.remove());
    shell.append(image);
  }
  return shell;
}

function optionButton(filter, value) {
  const button = node('button', 'icon-option'); button.type = 'button'; button.dataset.value = value;
  if (filter.kind === 'weapon') button.dataset.weaponType = weaponTypeForName(value, state.weaponCatalog);
  button.setAttribute('aria-pressed', String(state.selections[filter.key].has(value)));
  if (filter.kind === 'stage') button.append(optionImage(stageIconUrl(value), value));
  else if (filter.kind === 'weapon') button.append(optionImage(weaponIcon(value), value));
  else button.append(optionImage(ruleIconUrl(value), value));
  button.append(node('span', 'option-label', value));
  button.addEventListener('click', () => {
    const selected = state.selections[filter.key];
    if (selected.has(value)) selected.delete(value); else selected.add(value);
    button.setAttribute('aria-pressed', String(selected.has(value)));
    updateResults();
  });
  return button;
}

function renderFilters() {
  const dimensions = searchDimensions(state.records, state.weaponCatalog.map(item => item.name));
  for (const filter of FILTERS) {
    byId(filter.container).replaceChildren(...dimensions[filter.key].map(value => optionButton(filter, value)));
  }
}

function renderWeaponTypeTabs(filter) {
  const tabs = byId('weapon-type-tabs');
  tabs.hidden = filter.kind !== 'weapon';
  if (tabs.hidden) { tabs.replaceChildren(); return; }
  const names = [...byId(filter.container).querySelectorAll('.icon-option')].map(option => option.dataset.value);
  const types = ['すべて', ...weaponTypeTabs(names, state.weaponCatalog)];
  if (!types.includes(state.weaponTypeByFilter[filter.key])) state.weaponTypeByFilter[filter.key] = 'すべて';
  tabs.replaceChildren(...types.map(type => {
    const button = node('button', '', type); button.type = 'button'; button.role = 'tab';
    button.dataset.weaponType = type;
    button.setAttribute('aria-selected', String(state.weaponTypeByFilter[filter.key] === type));
    button.addEventListener('click', () => {
      state.weaponTypeByFilter[filter.key] = type;
      tabs.querySelectorAll('button').forEach(tab => tab.setAttribute('aria-selected', String(tab === button)));
      filterVisibleOptions();
    });
    return button;
  }));
}

function filterPreview(filter, value) {
  const item = node('span', 'selection-preview-icon');
  const url = filter.kind === 'stage' ? stageIconUrl(value) : filter.kind === 'rule' ? ruleIconUrl(value) : weaponIcon(value);
  item.append(optionImage(url, value));
  item.title = value;
  return item;
}

function openFilterDialog(key) {
  const filter = FILTERS.find(item => item.key === key);
  if (!filter) return;
  activeFilterKey = key;
  byId('filter-dialog-title').textContent = filter.title;
  byId('filter-dialog-description').textContent = `${filter.description}。複数選択できます。`;
  byId('filter-option-query').value = '';
  document.querySelectorAll('[data-filter-panel]').forEach(panel => { panel.hidden = panel.dataset.filterPanel !== key; });
  renderWeaponTypeTabs(filter);
  filterVisibleOptions();
  byId('filter-dialog').showModal();
  if (filter.kind === 'weapon') byId('filter-option-query').focus();
}

function filterVisibleOptions() {
  const query = normalizedSearchText(byId('filter-option-query').value);
  const panel = document.querySelector(`[data-filter-panel="${activeFilterKey}"]`);
  const type = state.weaponTypeByFilter[activeFilterKey] || 'すべて';
  panel?.querySelectorAll('.icon-option').forEach(option => {
    const wrongType = option.dataset.weaponType && type !== 'すべて' && option.dataset.weaponType !== type;
    const wrongName = Boolean(query) && !normalizedSearchText(option.dataset.value).includes(query);
    option.hidden = wrongType || wrongName;
  });
}

function formatRecordedAt(value) {
  if (!value) return '収録日時不明';
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function weaponMini(name, showName = false) {
  const item = node('span', `weapon-mini${showName ? ' show-name' : ''}`); item.title = name;
  item.append(optionImage(weaponIcon(name), name), node('span', '', name));
  return item;
}

function resultCard(record) {
  const url = matchReviewUrl(record);
  const card = node(url ? 'a' : 'article', 'search-result-card');
  if (url) card.href = url;
  const media = node('div', 'result-media');
  if (record.thumbnailUrl) { const image = document.createElement('img'); image.src = record.thumbnailUrl; image.alt = `${record.stage || '未判定'}の試合`; image.loading = 'lazy'; media.append(image); }
  const outcome = node('b', `result-outcome ${record.outcome || 'unknown'}`, record.outcome === 'win' ? 'WIN' : record.outcome === 'lose' ? 'LOSE' : '—'); media.append(outcome);
  const body = node('div', 'result-body');
  const heading = node('div', 'result-heading'); heading.append(node('h3', '', `${record.stage || 'ステージ未判定'} / ${record.rule || 'ルール未判定'}`), node('time', '', formatRecordedAt(record.recordedAt))); body.append(heading);
  const stats = node('div', 'result-stats');
  const kills = Number.isFinite(Number(record.playerStats?.kills)) ? record.playerStats.kills : '—';
  const deaths = Number.isFinite(Number(record.deathCount ?? record.playerStats?.deaths)) ? (record.deathCount ?? record.playerStats.deaths) : '—';
  const matchLabel = record.matchNumber == null ? '—' : String(record.matchNumber).padStart(2, '0');
  stats.append(node('span', '', `K/D ${kills}/${deaths}`), node('span', '', `試合 ${matchLabel}`)); body.append(stats);
  const self = recordSelfWeapon(record); const roster = node('div', 'result-roster');
  const selfRow = node('div'); selfRow.append(node('strong', '', '自分'), self ? weaponMini(self, true) : node('span', 'weapon-missing', '未取得')); roster.append(selfRow);
  const enemyRow = node('div'); enemyRow.append(node('strong', '', '相手'));
  if (record.enemyWeapons?.length) enemyRow.append(...record.enemyWeapons.map(weaponMini)); else enemyRow.append(node('span', 'weapon-missing', '編成未取得'));
  roster.append(enemyRow); body.append(roster); card.append(media, body); return card;
}

function renderActiveFilters() {
  const labels = { stages: 'ステージ', rules: 'ルール', selfWeapons: '自分', opponentWeapons: '相手' };
  const chips = [];
  for (const filter of FILTERS) {
    const selected = [...state.selections[filter.key]];
    byId(filter.count).textContent = selected.length;
    byId(filter.count).hidden = selected.length === 0;
    byId(filter.summary).textContent = selected.length ? `${selected.length}件を選択` : 'すべて';
    byId(filter.preview).replaceChildren(...selected.slice(0, 4).map(value => filterPreview(filter, value)));
    for (const value of state.selections[filter.key]) {
      const chip = node('button', 'filter-chip', `${labels[filter.key]}: ${value} ×`); chip.type = 'button';
      chip.addEventListener('click', () => { state.selections[filter.key].delete(value); renderFilters(); updateResults(); }); chips.push(chip);
    }
  }
  byId('active-search-filters').replaceChildren(...chips);
}

function updateResults() {
  const records = filterMatchRecords(state.records, state.selections);
  byId('result-count').textContent = records.length;
  byId('total-count').textContent = `/ ${state.records.length}試合`;
  byId('search-results').replaceChildren(...records.map(resultCard));
  byId('search-results').hidden = records.length === 0;
  byId('search-empty').hidden = records.length > 0;
  renderActiveFilters();
}

function resetSearch() {
  Object.values(state.selections).forEach(selected => selected.clear());
  renderFilters(); updateResults();
}

async function initialize() {
  byId('reset-search').addEventListener('click', resetSearch);
  document.querySelectorAll('[data-filter-open]').forEach(button => button.addEventListener('click', () => openFilterDialog(button.dataset.filterOpen)));
  byId('close-filter-dialog').addEventListener('click', () => byId('filter-dialog').close());
  byId('apply-filter-dialog').addEventListener('click', () => byId('filter-dialog').close());
  byId('filter-option-query').addEventListener('input', filterVisibleOptions);
  byId('clear-current-filter').addEventListener('click', () => {
    if (!activeFilterKey) return;
    state.selections[activeFilterKey].clear(); renderFilters(); updateResults();
  });
  byId('filter-dialog').addEventListener('click', event => {
    if (event.target === byId('filter-dialog')) byId('filter-dialog').close();
  });
  try {
    const [analyticsResponse, weaponsResponse] = await Promise.all([
      fetch('/api/analytics', { cache: 'no-store' }), fetch('/api/analytics/weapons', { cache: 'no-store' }),
    ]);
    if (!analyticsResponse.ok) throw new Error('試合データを読み込めませんでした');
    const analytics = await analyticsResponse.json(); const weapons = weaponsResponse.ok ? await weaponsResponse.json() : { weapons: [] };
    state.records = analytics.records || [];
    state.weaponCatalog = (weapons.weapons || []).filter(item => item.name);
    renderFilters(); updateResults();
  } catch (error) {
    byId('search-results').replaceChildren(node('p', 'search-error', error.message));
    byId('result-count').textContent = '—'; byId('total-count').textContent = '読込失敗';
  }
}

initialize();
