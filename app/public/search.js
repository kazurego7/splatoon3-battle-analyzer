import { appFetch as fetch } from './app-path.js';
import { filterMatchRecords, matchReviewUrl, OUTCOME_LABELS, recordSelfWeapon, ruleIconUrl, searchDimensions, stageIconUrl, weaponCatalogEntry, weaponTypeForName, weaponTypeTabs } from './search-core.js';

const byId = id => document.getElementById(id);
const state = {
  records: [], weaponCatalog: [],
  selections: {
    stages: new Set(), rules: new Set(), outcomes: new Set(),
    selfWeapons: new Set(), opponentWeapons: new Set(),
    allyCompositions: new Set(), enemyCompositions: new Set(),
  },
  weaponTypeByFilter: {
    selfWeapons: 'すべて', opponentWeapons: 'すべて',
    allyCompositions: 'すべて', enemyCompositions: 'すべて',
  },
};
const resultCardCache = new Map();
const RULE_ORDER = ['ナワバリ', 'エリア', 'ヤグラ', 'ホコ', 'アサリ'];
const COMPOSITION_LIMIT = 4;
let activeFilterKey = null;

const FILTERS = [
  { key: 'stages', container: 'stage-options', kind: 'stage', title: 'ステージ', single: true },
  { key: 'rules', container: 'rule-options', kind: 'rule', title: 'ルール', single: true },
  { key: 'outcomes', container: 'outcome-options', kind: 'outcome', title: '勝敗', single: true },
  { key: 'selfWeapons', container: 'self-weapon-options', kind: 'weapon', title: '自分のブキ', description: '自分が使ったブキで絞り込み', count: 'self-weapon-selection-count', summary: 'self-weapon-selection-summary', preview: 'self-weapon-selection-preview' },
  { key: 'opponentWeapons', container: 'opponent-weapon-options', kind: 'weapon', title: '相手のブキ', description: '相手にいたブキで絞り込み', count: 'opponent-weapon-selection-count', summary: 'opponent-weapon-selection-summary', preview: 'opponent-weapon-selection-preview' },
  { key: 'allyCompositions', container: 'ally-composition-options', kind: 'weapon', title: '味方の編成', description: '選んだブキをすべて含む味方編成', count: 'ally-composition-selection-count', summary: 'ally-composition-selection-summary', preview: 'ally-composition-selection-preview' },
  { key: 'enemyCompositions', container: 'enemy-composition-options', kind: 'weapon', title: '敵の編成', description: '選んだブキをすべて含む敵編成', count: 'enemy-composition-selection-count', summary: 'enemy-composition-selection-summary', preview: 'enemy-composition-selection-preview' },
];

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text != null) item.textContent = text;
  return item;
}

function weaponIcon(name) {
  return weaponCatalogEntry(name, state.weaponCatalog)?.iconUrl || null;
}

function optionImage(url, alt) {
  const shell = node('span', 'option-image');
  const fallback = node('i', '', '?'); fallback.setAttribute('aria-hidden', 'true');
  shell.append(fallback);
  if (url) {
    const image = document.createElement('img'); image.src = url + (url.includes('?') ? '&' : '?') + 'size=icon'; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
    image.addEventListener('load', () => fallback.hidden = true);
    image.addEventListener('error', () => image.remove());
    shell.append(image);
  }
  return shell;
}

function optionButton(filter, value) {
  const button = node('button', 'icon-option'); button.type = 'button'; button.dataset.value = value;
  button.setAttribute('aria-label', filter.kind === 'outcome' ? OUTCOME_LABELS[value] : value);
  button.setAttribute('aria-pressed', String(state.selections[filter.key].has(value)));
  if (filter.kind === 'stage') button.append(optionImage(stageIconUrl(value), value));
  else if (filter.kind === 'outcome') button.append(node('span', `outcome-option-mark ${value}`, OUTCOME_LABELS[value]));
  else if (filter.kind === 'weapon') button.append(optionImage(weaponIcon(value), value));
  else button.append(optionImage(ruleIconUrl(value), value));
  button.append(node('span', 'option-label', filter.kind === 'outcome' ? OUTCOME_LABELS[value] : value));
  button.addEventListener('click', () => {
    const selected = state.selections[filter.key];
    if (filter.single) {
      const cancel = selected.has(value);
      selected.clear();
      if (!cancel) selected.add(value);
      syncFilterSelection(filter);
    } else {
      const isComposition = filter.key === 'allyCompositions' || filter.key === 'enemyCompositions';
      if (isComposition && !selected.has(value) && selected.size >= COMPOSITION_LIMIT) return;
      if (selected.has(value)) selected.delete(value); else selected.add(value);
      syncFilterSelection(filter);
    }
    updateResults();
  });
  return button;
}

function syncFilterSelection(filter) {
  const selected = state.selections[filter.key];
  const isComposition = filter.key === 'allyCompositions' || filter.key === 'enemyCompositions';
  byId(filter.container).querySelectorAll('.icon-option').forEach(option => {
    const isSelected = selected.has(option.dataset.value);
    option.setAttribute('aria-pressed', String(isSelected));
    option.disabled = isComposition && selected.size >= COMPOSITION_LIMIT && !isSelected;
  });
  if (activeFilterKey === filter.key) updateFilterDialogDescription(filter);
}

function renderFilters() {
  const dimensions = searchDimensions(state.records);
  for (const filter of FILTERS) {
    const values = filter.key === 'rules'
      ? [...dimensions[filter.key]].sort((left, right) => RULE_ORDER.indexOf(left) - RULE_ORDER.indexOf(right))
      : dimensions[filter.key];
    const options = values.map(value => optionButton(filter, value));
    byId(filter.container).replaceChildren(...options);
    syncFilterSelection(filter);
  }
}

function filterPreview(value) {
  const item = node('span', 'selection-preview-icon');
  item.append(optionImage(weaponIcon(value), value));
  item.title = value;
  return item;
}

function filterVisibleWeaponOptions() {
  const filter = FILTERS.find(item => item.key === activeFilterKey);
  if (!filter || filter.kind !== 'weapon') return;
  const activeType = state.weaponTypeByFilter[filter.key] || 'すべて';
  byId(filter.container).querySelectorAll('.icon-option').forEach(option => {
    option.hidden = activeType !== 'すべて' && weaponTypeForName(option.dataset.value, state.weaponCatalog) !== activeType;
  });
}

function renderWeaponTypeTabs(filter) {
  const tabs = byId('weapon-type-tabs');
  const names = [...byId(filter.container).querySelectorAll('.icon-option')].map(option => option.dataset.value);
  const types = ['すべて', ...weaponTypeTabs(names, state.weaponCatalog)];
  if (!types.includes(state.weaponTypeByFilter[filter.key])) state.weaponTypeByFilter[filter.key] = 'すべて';
  tabs.replaceChildren(...types.map(type => {
    const button = node('button', '', type);
    button.type = 'button'; button.role = 'tab';
    button.setAttribute('aria-selected', String(state.weaponTypeByFilter[filter.key] === type));
    button.addEventListener('click', () => {
      state.weaponTypeByFilter[filter.key] = type;
      tabs.querySelectorAll('button').forEach(tab => tab.setAttribute('aria-selected', String(tab === button)));
      filterVisibleWeaponOptions();
    });
    return button;
  }));
  filterVisibleWeaponOptions();
}

function updateFilterDialogDescription(filter) {
  const selectedCount = state.selections[filter.key].size;
  const isComposition = filter.key === 'allyCompositions' || filter.key === 'enemyCompositions';
  byId('filter-dialog-description').textContent = isComposition
    ? `${filter.description}。${selectedCount} / ${COMPOSITION_LIMIT}個を選択中。`
    : `${filter.description}。複数選択できます。`;
}

function openFilterDialog(key) {
  const filter = FILTERS.find(item => item.key === key && item.kind === 'weapon');
  if (!filter) return;
  activeFilterKey = key;
  const dialog = byId('filter-dialog');
  dialog.dataset.filterKey = key;
  byId('filter-dialog-title').textContent = filter.title;
  updateFilterDialogDescription(filter);
  document.querySelectorAll('[data-filter-panel]').forEach(panel => { panel.hidden = panel.dataset.filterPanel !== key; });
  renderWeaponTypeTabs(filter);
  dialog.showModal();
}

function renderActiveFilters() {
  const labels = {
    selfWeapons: '自分', opponentWeapons: '相手',
    allyCompositions: '味方編成', enemyCompositions: '敵編成',
  };
  const chips = [];
  for (const filter of FILTERS.filter(item => item.kind === 'weapon')) {
    const selected = [...state.selections[filter.key]];
    byId(filter.count).textContent = selected.length ? String(selected.length) : '';
    byId(filter.summary).textContent = selected.length ? `${selected.length}件を選択` : 'すべて';
    byId(filter.preview).replaceChildren(...selected.slice(0, 4).map(filterPreview));
    for (const value of selected) {
      const chip = node('button', 'filter-chip', `${labels[filter.key]}: ${value} ×`);
      chip.type = 'button'; chip.dataset.filterKey = filter.key;
      chip.addEventListener('click', () => {
        state.selections[filter.key].delete(value);
        syncFilterSelection(filter); updateResults();
      });
      chips.push(chip);
    }
  }
  byId('active-search-filters').replaceChildren(...chips);
}

function enableHorizontalWheelScroll(element) {
  element.addEventListener('wheel', event => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const previous = element.scrollLeft;
    element.scrollLeft += event.deltaY;
    if (element.scrollLeft !== previous) event.preventDefault();
  }, { passive: false });
}

function formatRecordedAt(value) {
  if (!value) return '収録日時不明';
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function weaponMini(name, isSelf = false) {
  const item = node('span', `weapon-mini${isSelf ? ' is-self' : ''}`);
  item.title = isSelf ? `自分: ${name}` : name;
  item.setAttribute('aria-label', item.title);
  item.dataset.weaponName = name; item.append(optionImage(weaponIcon(name), name));
  return item;
}

function rosterRow(label, weapons, selfWeapon = null) {
  const row = node('div'); row.append(node('strong', '', label));
  const list = node('span', 'roster-weapon-list');
  if (selfWeapon) list.append(weaponMini(selfWeapon, true));
  if (weapons?.length) list.append(...weapons.map(weapon => weaponMini(weapon)));
  else if (!selfWeapon) list.append(node('span', 'weapon-missing', '編成未取得'));
  row.append(list); return row;
}

function resultCard(record) {
  const url = matchReviewUrl(record);
  const card = node(url ? 'a' : 'article', 'search-result-card');
  if (url) card.href = url;
  const media = node('div', 'result-media');
  if (record.thumbnailUrl) { const image = document.createElement('img'); image.src = record.thumbnailUrl + (record.thumbnailUrl.includes('?') ? '&' : '?') + 'size=list'; image.decoding = 'async'; image.alt = `${record.stage || '未判定'}の試合`; image.loading = 'lazy'; media.append(image); }
  else media.append(node('span', 'thumbnail-pending', '準備中'));
  const outcome = node('b', `result-outcome ${record.outcome || 'unknown'}`, record.outcome === 'win' ? 'WIN' : record.outcome === 'lose' ? 'LOSE' : '—');
  const body = node('div', 'result-body');
  const heading = node('div', 'result-heading'); heading.append(node('h3', '', `${record.stage || 'ステージ未判定'} / ${record.rule || 'ルール未判定'}`), node('time', '', formatRecordedAt(record.recordedAt))); body.append(heading);
  const stats = node('div', 'result-stats');
  const kills = Number.isFinite(Number(record.playerStats?.kills)) ? record.playerStats.kills : '—';
  const deaths = Number.isFinite(Number(record.deathCount ?? record.playerStats?.deaths)) ? (record.deathCount ?? record.playerStats.deaths) : '—';
  stats.append(outcome, node('span', '', `K/D ${kills}/${deaths}`)); body.append(stats);
  const self = recordSelfWeapon(record); const roster = node('div', 'result-roster');
  roster.append(rosterRow('味方', record.allyWeapons, self), rosterRow('敵', record.enemyWeapons)); body.append(roster); card.append(media, body); return card;
}

function cachedResultCard(record) {
  const key = `${record.recordingId || record.analysisUrl || ''}:${record.matchNumber ?? ''}`;
  if (!resultCardCache.has(key)) resultCardCache.set(key, resultCard(record));
  return resultCardCache.get(key);
}

function updateResults() {
  const records = filterMatchRecords(state.records, state.selections);
  byId('result-count').textContent = records.length;
  byId('total-count').textContent = `/ ${state.records.length}試合`;
  byId('search-results').replaceChildren(...records.map(cachedResultCard));
  byId('search-results').hidden = records.length === 0;
  byId('search-empty').hidden = records.length > 0;
  renderActiveFilters();
}

function resetSearch() {
  Object.values(state.selections).forEach(selected => selected.clear());
  FILTERS.forEach(syncFilterSelection); updateResults();
}

async function initialize() {
  byId('reset-search').addEventListener('click', resetSearch);
  enableHorizontalWheelScroll(byId('stage-options'));
  document.querySelectorAll('[data-filter-open]').forEach(button => button.addEventListener('click', () => openFilterDialog(button.dataset.filterOpen)));
  byId('close-filter-dialog').addEventListener('click', () => byId('filter-dialog').close());
  byId('apply-filter-dialog').addEventListener('click', () => byId('filter-dialog').close());
  byId('clear-current-filter').addEventListener('click', () => {
    if (!activeFilterKey) return;
    const filter = FILTERS.find(item => item.key === activeFilterKey);
    state.selections[activeFilterKey].clear(); syncFilterSelection(filter); updateResults();
  });
  byId('filter-dialog').addEventListener('click', event => {
    if (event.target === byId('filter-dialog')) byId('filter-dialog').close();
  });
  try {
    const analyticsResponse = await fetch('/api/analytics?view=search', { cache: 'no-cache' });
    if (!analyticsResponse.ok) throw new Error('試合データを読み込めませんでした');
    const analytics = await analyticsResponse.json();
    state.records = analytics.records || [];
    renderFilters(); updateResults();
    const defer = window.requestIdleCallback || (callback => setTimeout(callback, 0));
    defer(async () => {
      try {
        const response = await fetch('/api/analytics/weapons');
        if (!response.ok) return;
        const payload = await response.json();
        state.weaponCatalog = (payload.weapons || []).filter(item => item.name);
        for (const filter of FILTERS.filter(item => item.kind === 'weapon')) {
          byId(filter.container).querySelectorAll('.icon-option').forEach(option => {
            option.querySelector('.option-image')?.replaceWith(optionImage(weaponIcon(option.dataset.value), option.dataset.value));
          });
        }
        for (const card of resultCardCache.values()) card.querySelectorAll('.weapon-mini[data-weapon-name]').forEach(item => {
          item.querySelector('.option-image')?.replaceWith(optionImage(weaponIcon(item.dataset.weaponName), item.dataset.weaponName));
        });
        if (byId('filter-dialog').open && activeFilterKey) {
          const filter = FILTERS.find(item => item.key === activeFilterKey);
          if (filter) renderWeaponTypeTabs(filter);
        }
      } catch {}
    });
  } catch (error) {
    byId('search-results').replaceChildren(node('p', 'search-error', error.message));
    byId('result-count').textContent = '—'; byId('total-count').textContent = '読込失敗';
  }
}

initialize();
