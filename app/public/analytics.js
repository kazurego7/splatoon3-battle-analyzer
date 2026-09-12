import { appFetch as fetch } from './app-path.js';
import {
  ANALYTICS_CHARTS,
  ANALYTICS_DIMENSIONS,
  ANALYTICS_METRICS,
  QUESTION_TEMPLATES,
  arrangeDashboardCards,
  analyticsDimensions,
  compactDashboardRows,
  defaultDashboard,
  filterAnalyticsRecords,
  formatAnalyticsValue,
  moveDashboardCard,
  normalizeCardLayout,
  resizeDashboardCard,
  runAnalyticsQuery,
} from './analytics-core.js';

const STORAGE_KEY = 'splatoon-hypothesis-dashboards-v2';
const byId = id => document.getElementById(id);
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const state = {
  records: [], status: {}, definitions: {}, dimensions: { stages: [], rules: [], selfWeapons: [], opponentWeapons: [] },
  dashboards: [], activeDashboardId: null, globalFilters: {}, editingCardId: null, dashboardDialogMode: 'create',
  isEditing: false, editSnapshot: null, draggedCardId: null, dragOffset: null, pendingDrop: null, refreshTimer: null, toastTimer: null,
};

const globalControls = {
  dateFrom: byId('global-date-from'), dateTo: byId('global-date-to'), stage: byId('global-stage'),
  rule: byId('global-rule'), selfWeapon: byId('global-self-weapon'), opponentWeapon: byId('global-opponent-weapon'),
  outcome: byId('global-outcome'),
};
const questionControls = {
  title: byId('question-title'), metric: byId('question-metric'), dimension: byId('question-dimension'),
  chart: byId('question-chart'), minimumSamples: byId('question-minimum'), sort: byId('question-sort'),
  stage: byId('question-stage'), rule: byId('question-rule'), selfWeapon: byId('question-self-weapon'),
  opponentWeapon: byId('question-opponent-weapon'), outcome: byId('question-outcome'),
  deathsMin: byId('question-deaths-min'), deathsMax: byId('question-deaths-max'),
  disadvantageMin: byId('question-disadvantage-min'), disadvantageMax: byId('question-disadvantage-max'),
};

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function option(value, label = value) {
  const node = document.createElement('option');
  node.value = value; node.textContent = label;
  return node;
}

function populateSelect(select, values, { emptyLabel = 'すべて', preserve = true } = {}) {
  const current = preserve ? select.value : '';
  select.replaceChildren(option('', emptyLabel), ...values.map(value => option(value)));
  if (values.includes(current)) select.value = current;
}

function toast(message) {
  const node = byId('toast');
  node.textContent = message;
  node.classList.add('is-visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => node.classList.remove('is-visible'), 2400);
}

function activeDashboard() {
  return state.dashboards.find(dashboard => dashboard.id === state.activeDashboardId) || state.dashboards[0];
}

function cardPositionOrder(left, right) {
  return left.layout.row - right.layout.row || left.layout.column - right.layout.column;
}

function normalizeActiveDashboardLayout(priorityId = null) {
  const dashboard = activeDashboard();
  if (!dashboard) return;
  dashboard.cards = compactDashboardRows(arrangeDashboardCards(dashboard.cards, priorityId)).sort(cardPositionOrder);
}

function normalizeCard(card) {
  return {
    id: card.id || id('card'), title: String(card.title || '新しい分析').slice(0, 80),
    metric: ANALYTICS_METRICS[card.metric] ? card.metric : 'matchCount',
    dimension: ANALYTICS_DIMENSIONS[card.dimension] ? card.dimension : 'none',
    chart: ANALYTICS_CHARTS[card.chart] ? card.chart : 'bar',
    layout: normalizeCardLayout(card),
    minimumSamples: Math.max(1, Math.min(99, Number(card.minimumSamples) || 1)),
    sort: card.sort || 'auto', filters: card.filters && typeof card.filters === 'object' ? card.filters : {},
  };
}

function loadDashboards() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved?.dashboards) && saved.dashboards.length) {
      state.dashboards = saved.dashboards.map(dashboard => {
        const cards = Array.isArray(dashboard.cards) ? dashboard.cards.map(normalizeCard) : [];
        return {
          id: dashboard.id || id('dashboard'), name: String(dashboard.name || 'ダッシュボード').slice(0, 60),
          cards: compactDashboardRows(arrangeDashboardCards(cards)).sort(cardPositionOrder),
        };
      });
      state.activeDashboardId = state.dashboards.some(item => item.id === saved.activeDashboardId)
        ? saved.activeDashboardId : state.dashboards[0].id;
      saveDashboards();
      return;
    }
  } catch {}
  const initial = defaultDashboard();
  state.dashboards = [{ ...initial, cards: compactDashboardRows(arrangeDashboardCards(initial.cards.map(normalizeCard))).sort(cardPositionOrder) }];
  state.activeDashboardId = initial.id;
  saveDashboards();
}

function saveDashboards() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ dashboards: state.dashboards, activeDashboardId: state.activeDashboardId }));
}

function formatDateTime(value) {
  if (!value) return '更新時刻なし';
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function globalFilters() {
  return Object.fromEntries(Object.entries(globalControls).map(([key, control]) => [key, control.value]).filter(([, value]) => value !== ''));
}

function cardFiltersFromForm() {
  return Object.fromEntries([
    ['stage', questionControls.stage.value], ['rule', questionControls.rule.value],
    ['selfWeapon', questionControls.selfWeapon.value], ['opponentWeapon', questionControls.opponentWeapon.value],
    ['outcome', questionControls.outcome.value], ['deathsMin', questionControls.deathsMin.value],
    ['deathsMax', questionControls.deathsMax.value], ['disadvantageMin', questionControls.disadvantageMin.value],
    ['disadvantageMax', questionControls.disadvantageMax.value],
  ].filter(([, value]) => value !== ''));
}

function cardFromForm() {
  const existing = activeDashboard()?.cards.find(card => card.id === state.editingCardId);
  return normalizeCard({
    id: state.editingCardId || id('card'), title: questionControls.title.value.trim(),
    metric: questionControls.metric.value, dimension: questionControls.dimension.value,
    chart: questionControls.chart.value, minimumSamples: Number(questionControls.minimumSamples.value),
    sort: questionControls.sort.value, layout: existing?.layout, filters: cardFiltersFromForm(),
  });
}

const FILTER_LABELS = {
  dateFrom: '開始', dateTo: '終了', stage: 'ステージ', rule: 'ルール', selfWeapon: '自分',
  opponentWeapon: '相手', outcome: '勝敗', deathsMin: 'デス≧', deathsMax: 'デス≦',
  disadvantageMin: '人数不利≧', disadvantageMax: '人数不利≦',
};

function filterChips(filters) {
  return Object.entries(filters || {}).filter(([, value]) => value !== '' && value != null).map(([key, value]) => {
    const label = key === 'outcome' ? String(value).toUpperCase() : value;
    return `${FILTER_LABELS[key] || key}: ${label}`;
  });
}

function renderScope(container, filters) {
  container.replaceChildren(...filterChips(filters).map(label => element('span', '', label)));
}

function renderEmpty(container, message = 'この条件に合うデータがありません') {
  const empty = element('div', 'empty-chart');
  empty.append(element('i', '', '∅'), element('strong', '', message), element('span', '', '絞り込みを緩めるか、編成データを取り込んでください。'));
  container.replaceChildren(empty);
}

function renderKpi(container, result) {
  const visual = element('div', 'kpi-visual');
  visual.append(element('strong', '', formatAnalyticsValue(result.value, result.metric)));
  const sampleText = result.sampleCount === result.summary.matches
    ? `${result.summary.matches}試合`
    : `有効${result.sampleCount}/${result.summary.matches}試合`;
  visual.append(element('span', '', `${ANALYTICS_METRICS[result.metric].label}・${sampleText}`));
  const support = element('div', 'kpi-support');
  support.append(element('span', '', `WIN ${result.summary.wins}`), element('span', '', `LOSE ${result.summary.losses}`));
  visual.append(support);
  container.replaceChildren(visual);
}

function groupSampleText(group) {
  return group.samples === group.matches ? `${group.matches}試合` : `有効${group.samples}/${group.matches}試合`;
}

function renderBars(container, result) {
  if (!result.groups.length) return renderEmpty(container, result.dimension === 'opponentWeapon' ? '相手ブキのデータがありません' : undefined);
  const chart = element('div', 'bar-chart');
  const groups = result.groups.slice(0, 12);
  const maximum = Math.max(...groups.map(group => Number(group.value) || 0), 0.0001);
  for (const group of groups) {
    const row = element('div', 'bar-row');
    const label = element('div', 'bar-label', group.key);
    label.append(element('small', '', groupSampleText(group)));
    const track = element('div', 'bar-track');
    const fill = element('i'); fill.style.width = `${Math.max(0, ((Number(group.value) || 0) / maximum) * 100)}%`; track.append(fill);
    row.append(label, track, element('div', 'bar-value', formatAnalyticsValue(group.value, result.metric)));
    chart.append(row);
  }
  container.replaceChildren(chart);
}

function renderLine(container, result) {
  if (!result.groups.length) return renderEmpty(container);
  const groups = result.groups.slice(0, 18);
  const values = groups.map(group => Number(group.value)).filter(Number.isFinite);
  if (!values.length) return renderEmpty(container);
  const width = 560, height = 170, left = 18, right = 14, top = 12, bottom = 18;
  const maximum = Math.max(...values, 0.0001), minimum = Math.min(0, ...values);
  const x = index => left + (groups.length === 1 ? (width - left - right) / 2 : index * (width - left - right) / (groups.length - 1));
  const y = value => top + (maximum - value) * (height - top - bottom) / Math.max(0.0001, maximum - minimum);
  const points = groups.map((group, index) => [x(index), y(Number(group.value) || 0)]);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const defs = document.createElementNS(svg.namespaceURI, 'defs');
  const gradient = document.createElementNS(svg.namespaceURI, 'linearGradient'); gradient.id = `gradient-${Math.random().toString(36).slice(2)}`; gradient.setAttribute('x1', '0'); gradient.setAttribute('y1', '0'); gradient.setAttribute('x2', '0'); gradient.setAttribute('y2', '1');
  for (const [offset, color, opacity] of [['0%', '#5ad7ff', '.55'], ['100%', '#5ad7ff', '0']]) { const stop = document.createElementNS(svg.namespaceURI, 'stop'); stop.setAttribute('offset', offset); stop.setAttribute('stop-color', color); stop.setAttribute('stop-opacity', opacity); gradient.append(stop); }
  defs.append(gradient); svg.append(defs);
  for (let index = 0; index < 4; index += 1) { const line = document.createElementNS(svg.namespaceURI, 'line'); const lineY = top + index * (height - top - bottom) / 3; line.setAttribute('x1', left); line.setAttribute('x2', width - right); line.setAttribute('y1', lineY); line.setAttribute('y2', lineY); line.setAttribute('class', 'line-grid'); svg.append(line); }
  const area = document.createElementNS(svg.namespaceURI, 'path'); area.setAttribute('class', 'line-area'); area.setAttribute('fill', `url(#${gradient.id})`); area.setAttribute('d', `M ${points[0][0]} ${height - bottom} L ${points.map(point => point.join(' ')).join(' L ')} L ${points.at(-1)[0]} ${height - bottom} Z`); svg.append(area);
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('class', 'line-path'); path.setAttribute('d', `M ${points.map(point => point.join(' ')).join(' L ')}`); svg.append(path);
  points.forEach(([pointX, pointY], index) => { const point = document.createElementNS(svg.namespaceURI, 'circle'); point.setAttribute('class', 'line-point'); point.setAttribute('cx', pointX); point.setAttribute('cy', pointY); point.setAttribute('r', 4); const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = `${groups[index].key}: ${formatAnalyticsValue(groups[index].value, result.metric)} (${groupSampleText(groups[index])})`; point.append(title); svg.append(point); });
  const chart = element('div', 'line-chart'); chart.append(svg);
  const labels = element('div', 'line-labels');
  const labelGroups = groups.length > 4 ? [groups[0], groups[Math.floor((groups.length - 1) / 2)], groups.at(-1)] : groups;
  labelGroups.forEach(group => labels.append(element('span', '', group.key))); chart.append(labels);
  container.replaceChildren(chart);
}

function renderDonut(container, result) {
  if (!result.groups.length) return renderEmpty(container);
  const groups = result.groups.slice(0, 5);
  const values = groups.map(group => Math.max(0, Number(group.value) || 0));
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  const firstStop = `${values[0] / total * 100}%`;
  const visual = element('div', 'donut-visual');
  const donut = element('div', 'donut'); donut.style.setProperty('--donut-stop', firstStop); donut.append(element('strong', '', formatAnalyticsValue(groups[0].value, result.metric)));
  const legend = element('div', 'donut-legend');
  groups.forEach((group, index) => { const row = element('span'); row.append(element('i')); row.children[0].style.background = ['#c9fa4e', '#ff668f', '#5ad7ff', '#ffb85a', '#8d9daf'][index]; row.append(document.createTextNode(group.key), element('b', '', formatAnalyticsValue(group.value, result.metric))); legend.append(row); });
  visual.append(donut, legend); container.replaceChildren(visual);
}

function renderTable(container, result) {
  if (!result.groups.length) return renderEmpty(container);
  const wrap = element('div', 'analytics-table-wrap'); const table = element('table', 'analytics-table');
  const head = document.createElement('thead'); const header = document.createElement('tr');
  for (const label of [ANALYTICS_DIMENSIONS[result.dimension].label, ANALYTICS_METRICS[result.metric].label, '有効 / 全体', 'WIN', 'LOSE']) header.append(element('th', '', label));
  head.append(header); const body = document.createElement('tbody');
  result.groups.forEach(group => { const row = document.createElement('tr'); [group.key, formatAnalyticsValue(group.value, result.metric), `${group.samples} / ${group.matches}`, group.wins, group.losses].forEach(value => row.append(element('td', '', value))); body.append(row); });
  table.append(head, body); wrap.append(table); container.replaceChildren(wrap);
}

function renderVisualization(container, card, result) {
  if (!result.records.length) return renderEmpty(container, card.dimension === 'opponentWeapon' ? '相手ブキの編成データがありません' : undefined);
  if (card.chart === 'kpi' || card.dimension === 'none') return renderKpi(container, result);
  if (card.chart === 'line') return renderLine(container, result);
  if (card.chart === 'donut') return renderDonut(container, result);
  if (card.chart === 'table') return renderTable(container, result);
  return renderBars(container, result);
}

function cardSubtitle(card, result) {
  const metric = ANALYTICS_METRICS[card.metric].label;
  const dimension = ANALYTICS_DIMENSIONS[card.dimension].label;
  return card.dimension === 'none' ? metric : `${metric} × ${dimension}・${result.groups.length}分類`;
}

function applyCardLayout(article, layout) {
  article.style.setProperty('--card-column', layout.column);
  article.style.setProperty('--card-row', layout.row);
  article.style.setProperty('--card-columns', layout.columns);
  article.style.setProperty('--card-rows', layout.rows);
  article.dataset.column = layout.column;
  article.dataset.row = layout.row;
  article.dataset.columns = layout.columns;
  article.dataset.rows = layout.rows;
}

function syncDashboardCardLayouts(excludedCardId = null) {
  const layoutById = new Map((activeDashboard()?.cards || []).map(card => [card.id, card.layout]));
  byId('dashboard-grid').querySelectorAll('.dashboard-card').forEach(article => {
    if (article.dataset.cardId === excludedCardId) return;
    const layout = layoutById.get(article.dataset.cardId);
    if (layout) applyCardLayout(article, layout);
  });
}

function beginCardResize(event, card, article, direction) {
  if (!state.isEditing || window.matchMedia('(max-width: 860px)').matches) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget;
  const grid = byId('dashboard-grid');
  const gridStyle = getComputedStyle(grid);
  const columnGap = Number.parseFloat(gridStyle.columnGap) || 0;
  const rowGap = Number.parseFloat(gridStyle.rowGap) || 0;
  const columnWidth = (grid.clientWidth - columnGap * 11) / 12;
  const rowHeight = Number.parseFloat(gridStyle.gridAutoRows) || 32;
  const columnUnit = columnWidth + columnGap;
  const rowUnit = rowHeight + rowGap;
  const startX = event.clientX;
  const startY = event.clientY;
  const startLayout = { ...card.layout };
  const startCards = structuredClone(activeDashboard().cards);
  let currentLayout = startLayout;
  article.classList.add('is-resizing');
  document.body.classList.add('is-resizing-card');
  handle.setPointerCapture?.(event.pointerId);

  const move = moveEvent => {
    const columns = Math.round((moveEvent.clientX - startX) / columnUnit);
    const rows = Math.round((moveEvent.clientY - startY) / rowUnit);
    const resized = resizeDashboardCard(startCards, card.id, direction, columns, rows);
    activeDashboard().cards = resized.cards.sort(cardPositionOrder);
    currentLayout = resized.layout;
    syncDashboardCardLayouts();
  };
  const stop = stopEvent => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
    article.classList.remove('is-resizing');
    document.body.classList.remove('is-resizing-card');
    if (stopEvent.type === 'pointercancel') {
      activeDashboard().cards = startCards;
      renderDashboard();
      return;
    }
    saveDashboards();
    renderDashboard();
    toast(`${currentLayout.columns}列 × ${currentLayout.rows}行に変更しました`);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
}

function resizeHandle(card, article, direction, label) {
  const handle = element('button', `card-resize-handle is-${direction}`);
  handle.type = 'button';
  handle.setAttribute('aria-label', label);
  handle.title = label;
  handle.addEventListener('pointerdown', event => beginCardResize(event, card, article, direction));
  return handle;
}

function gridMeasurement() {
  const grid = byId('dashboard-grid');
  const style = getComputedStyle(grid);
  const columnGap = Number.parseFloat(style.columnGap) || 0;
  const rowGap = Number.parseFloat(style.rowGap) || 0;
  const columnWidth = (grid.clientWidth - columnGap * 11) / 12;
  const rowHeight = Number.parseFloat(style.gridAutoRows) || 32;
  return { grid, rect: grid.getBoundingClientRect(), columnUnit: columnWidth + columnGap, rowUnit: rowHeight + rowGap };
}

function hideDropPreview() {
  byId('dashboard-grid').querySelector('.grid-drop-preview')?.remove();
  state.pendingDrop = null;
}

function showDropPreview(layout) {
  const grid = byId('dashboard-grid');
  let preview = grid.querySelector('.grid-drop-preview');
  if (!preview) { preview = element('div', 'grid-drop-preview'); grid.append(preview); }
  preview.style.setProperty('--preview-column', layout.column);
  preview.style.setProperty('--preview-row', layout.row);
  preview.style.setProperty('--preview-columns', layout.columns);
  preview.style.setProperty('--preview-rows', layout.rows);
}

function gridDropLayout(event) {
  const card = activeDashboard()?.cards.find(item => item.id === state.draggedCardId);
  if (!card) return null;
  const { rect, columnUnit, rowUnit } = gridMeasurement();
  const rawColumn = Math.floor((event.clientX - rect.left) / columnUnit) + 1 - (state.dragOffset?.columns || 0);
  const rawRow = Math.floor((event.clientY - rect.top) / rowUnit) + 1 - (state.dragOffset?.rows || 0);
  return {
    ...card.layout,
    column: Math.max(1, Math.min(13 - card.layout.columns, rawColumn)),
    row: Math.max(1, rawRow),
  };
}

function beginCardMove(event, card, article) {
  if (!state.isEditing || event.button !== 0 || window.matchMedia('(max-width: 860px)').matches) return;
  if (event.target.closest('button,a,input,select,textarea,[contenteditable="true"],.card-resize-handle')) return;
  event.preventDefault();
  event.stopPropagation();
  const measurement = gridMeasurement();
  const rect = article.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  const startCards = structuredClone(activeDashboard().cards);
  let moved = false;
  state.draggedCardId = card.id;
  state.dragOffset = {
    columns: Math.max(0, Math.floor((event.clientX - rect.left) / measurement.columnUnit)),
    rows: Math.max(0, Math.floor((event.clientY - rect.top) / measurement.rowUnit)),
  };
  article.classList.add('is-dragging');
  document.body.classList.add('is-moving-card');
  article.setPointerCapture?.(event.pointerId);
  let currentMove = null;

  const previewMoveLayout = layout => {
    currentMove = moveDashboardCard(startCards, card.id, layout);
    activeDashboard().cards = structuredClone(currentMove.cards).sort(cardPositionOrder);
    syncDashboardCardLayouts(card.id);
    applyCardLayout(article, currentMove.previewLayout || layout);
    byId('dashboard-grid').querySelectorAll('.dashboard-card').forEach(item => {
      item.classList.toggle('is-drag-target', item.dataset.cardId === currentMove.swappedWithId);
      item.classList.toggle('is-drag-blocked', item.dataset.cardId === currentMove.targetId && !currentMove.accepted);
    });
    const movedCard = activeDashboard().cards.find(item => item.id === card.id);
    state.pendingDrop = currentMove.accepted ? movedCard.layout : null;
    if (currentMove.accepted) showDropPreview(movedCard.layout); else hideDropPreview();
  };

  const move = moveEvent => {
    if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4) return;
    moved = true;
    const layout = gridDropLayout(moveEvent);
    if (!layout) return;
    previewMoveLayout(layout);
  };
  const stop = stopEvent => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
    const accepted = moved && currentMove?.accepted && stopEvent.type !== 'pointercancel';
    if (accepted) {
      saveDashboards();
    } else activeDashboard().cards = startCards;
    state.draggedCardId = null;
    state.dragOffset = null;
    article.classList.remove('is-dragging');
    document.body.classList.remove('is-moving-card');
    byId('dashboard-grid').querySelectorAll('.is-drag-target,.is-drag-blocked').forEach(item => item.classList.remove('is-drag-target', 'is-drag-blocked'));
    hideDropPreview();
    renderDashboard();
    if (accepted) toast(currentMove.swappedWithId ? 'カードの位置を入れ替えました' : 'カードを移動しました');
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
}

function renderCard(card) {
  const result = runAnalyticsQuery(state.records, card, state.globalFilters);
  const article = element('article', 'dashboard-card'); article.dataset.cardId = card.id; applyCardLayout(article, card.layout);
  const header = element('header', 'card-header'); const titleRow = element('div', 'card-title-row');
  titleRow.append(element('h2', '', card.title), element('p', '', cardSubtitle(card, result)));
  const actions = element('div', 'card-actions');
  for (const [action, label, title] of [['duplicate', '⧉', '複製'], ['edit', '✎', '編集'], ['delete', '×', '削除']]) { const button = element('button', action === 'delete' ? 'delete-card' : '', label); button.type = 'button'; button.dataset.cardAction = action; button.title = title; actions.append(button); }
  header.append(titleRow, actions);
  const scope = element('div', 'card-scope'); renderScope(scope, card.filters);
  const body = element('div', 'card-body'); renderVisualization(body, card, result);
  const footer = element('footer', 'card-footer'); footer.append(element('span', '', `有効${result.sampleCount}/${result.records.length}試合・各分類 最小${card.minimumSamples}件`));
  if (result.records[0]?.analysisUrl) { const link = element('a', '', '対象試合を見る →'); link.href = result.records[0].analysisUrl; footer.append(link); }
  article.append(
    header, scope, body, footer,
    resizeHandle(card, article, 'northwest', '左上をドラッグして縦横サイズを変更'),
    resizeHandle(card, article, 'north', '上端をドラッグして高さを変更'),
    resizeHandle(card, article, 'northeast', '右上をドラッグして縦横サイズを変更'),
    resizeHandle(card, article, 'west', '左端をドラッグして横幅を変更'),
    resizeHandle(card, article, 'east', '右端をドラッグして横幅を変更'),
    resizeHandle(card, article, 'southwest', '左下をドラッグして縦横サイズを変更'),
    resizeHandle(card, article, 'south', '下端をドラッグして高さを変更'),
    resizeHandle(card, article, 'southeast', '右下をドラッグして縦横サイズを変更'),
  );
  article.addEventListener('pointerdown', event => beginCardMove(event, card, article));
  article.addEventListener('click', event => { const action = event.target.closest('[data-card-action]')?.dataset.cardAction; if (action && state.isEditing) handleCardAction(card.id, action); });
  return article;
}

function renderDashboardPicker() {
  const select = byId('dashboard-select');
  select.replaceChildren(...state.dashboards.map(dashboard => option(dashboard.id, dashboard.name)));
  select.value = state.activeDashboardId;
}

function renderGlobalFilterState() {
  const filtered = filterAnalyticsRecords(state.records, state.globalFilters);
  byId('filtered-record-count').textContent = `${filtered.length}/${state.records.length}試合`;
  const chips = byId('active-filter-chips'); chips.replaceChildren(...filterChips(state.globalFilters).map(label => element('span', '', label)));
}

function setDashboardEditMode(enabled) {
  const nextIsEditing = Boolean(enabled);
  if (nextIsEditing && !state.isEditing) {
    state.editSnapshot = {
      dashboards: structuredClone(state.dashboards),
      activeDashboardId: state.activeDashboardId,
    };
  }
  if (!nextIsEditing) state.editSnapshot = null;
  state.isEditing = nextIsEditing;
  document.body.classList.toggle('dashboard-edit-mode', state.isEditing);
  const toggle = byId('toggle-dashboard-edit');
  toggle.setAttribute('aria-pressed', String(state.isEditing));
  toggle.replaceChildren(element('span', '', state.isEditing ? '✓' : '✎'), document.createTextNode(state.isEditing ? ' 編集を終了' : ' 編集する'));
  if (!state.isEditing) {
    state.draggedCardId = null;
    state.dragOffset = null;
    hideDropPreview();
  }
  renderDashboard();
}

function cancelDashboardEdit() {
  if (!state.isEditing) return;
  const snapshot = state.editSnapshot;
  if (snapshot) {
    state.dashboards = structuredClone(snapshot.dashboards);
    state.activeDashboardId = snapshot.activeDashboardId;
  }
  setDashboardEditMode(false);
  saveDashboards();
  toast('編集内容をキャンセルしました');
}

function renderDashboard() {
  const dashboard = activeDashboard();
  if (!dashboard) return;
  document.body.classList.toggle('dashboard-edit-mode', state.isEditing);
  const toggle = byId('toggle-dashboard-edit');
  toggle.setAttribute('aria-pressed', String(state.isEditing));
  byId('dashboard-title').textContent = dashboard.name;
  byId('dashboard-meta').textContent = `${dashboard.cards.length}カード・${state.isEditing ? '配置を編集中' : '閲覧中'}・ブラウザに自動保存・データ更新 ${formatDateTime(state.status.updatedAt)}`;
  renderDashboardPicker(); renderGlobalFilterState();
  const grid = byId('dashboard-grid'); grid.replaceChildren(...dashboard.cards.map(renderCard));
  grid.hidden = dashboard.cards.length === 0 && !state.isEditing;
  byId('dashboard-empty').hidden = dashboard.cards.length > 0 || state.isEditing;
}

function handleCardAction(cardId, action) {
  if (!state.isEditing) return;
  const dashboard = activeDashboard(); const index = dashboard.cards.findIndex(card => card.id === cardId); const card = dashboard.cards[index];
  if (!card) return;
  if (action === 'edit') return openQuestionDialog(card);
  if (action === 'duplicate') {
    const copy = { ...structuredClone(card), id: id('card'), title: `${card.title}（コピー）` };
    copy.layout = { columns: copy.layout.columns, rows: copy.layout.rows };
    dashboard.cards.splice(index + 1, 0, copy);
    toast('カードを複製しました');
  }
  if (action === 'delete' && confirm(`「${card.title}」を削除しますか？`)) dashboard.cards.splice(index, 1);
  normalizeActiveDashboardLayout();
  saveDashboards(); renderDashboard();
}

function populateQuestionFormOptions() {
  questionControls.metric.replaceChildren(...Object.entries(ANALYTICS_METRICS).map(([value, meta]) => option(value, meta.label)));
  questionControls.dimension.replaceChildren(...Object.entries(ANALYTICS_DIMENSIONS).map(([value, meta]) => option(value, meta.label)));
  questionControls.chart.replaceChildren(...Object.entries(ANALYTICS_CHARTS).map(([value, meta]) => option(value, meta.label)));
  for (const select of [globalControls.stage, questionControls.stage]) populateSelect(select, state.dimensions.stages);
  for (const select of [globalControls.rule, questionControls.rule]) populateSelect(select, state.dimensions.rules);
  for (const select of [globalControls.selfWeapon, questionControls.selfWeapon]) populateSelect(select, state.dimensions.selfWeapons);
  for (const select of [globalControls.opponentWeapon, questionControls.opponentWeapon]) populateSelect(select, state.dimensions.opponentWeapons, { emptyLabel: state.dimensions.opponentWeapons.length ? 'すべて' : '編成データなし' });
}

function renderQuestionTemplates() {
  const container = byId('question-templates');
  container.replaceChildren(...QUESTION_TEMPLATES.map(template => {
    const button = element('button', 'question-template'); button.type = 'button'; button.dataset.templateId = template.id;
    const icon = element('i', '', template.icon); const text = element('span'); text.append(element('strong', '', template.title), element('small', '', template.description)); button.append(icon, text);
    button.addEventListener('click', () => applyQuestionTemplate(template.id)); return button;
  }));
}

function setQuestionForm(card) {
  questionControls.title.value = card.title || '';
  questionControls.metric.value = card.metric || 'lossRate'; questionControls.dimension.value = card.dimension || 'stage';
  questionControls.chart.value = card.chart || 'bar'; questionControls.minimumSamples.value = card.minimumSamples || 1;
  questionControls.sort.value = card.sort || 'auto';
  for (const key of ['stage', 'rule', 'selfWeapon', 'opponentWeapon', 'outcome', 'deathsMin', 'deathsMax', 'disadvantageMin', 'disadvantageMax']) questionControls[key].value = card.filters?.[key] ?? '';
  updateQuestionPreview();
}

function applyQuestionTemplate(templateId) {
  const template = QUESTION_TEMPLATES.find(item => item.id === templateId); if (!template) return;
  setQuestionForm(normalizeCard({ ...structuredClone(template.spec), title: template.title }));
  byId('card-filter-section').open = templateId === 'stage-opponent';
  document.querySelectorAll('.question-template').forEach(button => button.classList.toggle('is-active', button.dataset.templateId === templateId));
}

function openQuestionDialog(card = null, templateId = null) {
  state.editingCardId = card?.id || null;
  byId('question-dialog-title').textContent = card ? '分析カードを編集' : 'グラフ・表を追加';
  byId('save-question').lastChild.textContent = card ? ' 変更を保存' : ' ダッシュボードに追加';
  document.querySelectorAll('.question-template').forEach(button => button.classList.remove('is-active'));
  if (card) setQuestionForm(card);
  else if (templateId) applyQuestionTemplate(templateId);
  else setQuestionForm(normalizeCard({ title: '新しい分析', metric: 'lossRate', dimension: 'stage', chart: 'bar', filters: {} }));
  byId('question-dialog').showModal();
}

function updateQuestionPreview() {
  const card = cardFromForm(); const result = runAnalyticsQuery(state.records, card, state.globalFilters);
  byId('preview-record-count').textContent = result.sampleCount === result.records.length
    ? `${result.records.length}試合`
    : `有効${result.sampleCount}/${result.records.length}試合`;
  byId('card-filter-summary').textContent = filterChips(card.filters).join('・') || '条件なし';
  renderVisualization(byId('question-preview'), card, result);
  byId('question-preview-note').textContent = card.dimension === 'opponentWeapon' && state.dimensions.opponentWeapons.length === 0
    ? '新しい動画では試合開始直後の編成を取得します。ステージ条件も指定すると、この仮説を検証できます。'
    : card.dimension === 'opponentWeapon' && !card.filters.stage && !state.globalFilters.stage
      ? '「このカードだけの条件」でステージを選ぶと、特定ステージ × 相手ブキを検証できます。'
    : `${ANALYTICS_METRICS[card.metric].label}を${ANALYTICS_DIMENSIONS[card.dimension].label}で集計します。`;
}

function saveQuestion(event) {
  event.preventDefault();
  if (!byId('question-form').reportValidity()) return;
  const card = cardFromForm(); const dashboard = activeDashboard();
  const index = dashboard.cards.findIndex(item => item.id === state.editingCardId);
  if (index >= 0) dashboard.cards[index] = card; else dashboard.cards.push(card);
  normalizeActiveDashboardLayout(index >= 0 ? card.id : null);
  saveDashboards(); byId('question-dialog').close(); renderDashboard(); toast(index >= 0 ? 'カードを更新しました' : 'カードを追加しました');
}

function openDashboardDialog(mode) {
  state.dashboardDialogMode = mode;
  const current = activeDashboard();
  byId('dashboard-dialog-title').textContent = mode === 'rename' ? '名前を変更' : '新しいダッシュボード';
  byId('dashboard-name').value = mode === 'rename' ? current.name : '';
  byId('dashboard-dialog').showModal(); byId('dashboard-name').focus();
}

function saveDashboardName(event) {
  event.preventDefault();
  if (!byId('dashboard-form').reportValidity()) return;
  const name = byId('dashboard-name').value.trim();
  if (state.dashboardDialogMode === 'rename') activeDashboard().name = name;
  else { const dashboard = { id: id('dashboard'), name, cards: [] }; state.dashboards.push(dashboard); state.activeDashboardId = dashboard.id; }
  saveDashboards(); byId('dashboard-dialog').close(); renderDashboard(); toast('ダッシュボードを保存しました');
}

function updateDataHealth() {
  const covered = state.records.filter(record => record.stage && record.rule && record.outcome).length;
  const ratio = state.records.length ? covered / state.records.length : 0;
  byId('data-record-count').textContent = `${state.records.length}試合`;
  byId('coverage-fill').style.width = `${ratio * 100}%`;
  byId('coverage-note').textContent = `基本項目 ${covered}/${state.records.length}・相手ブキ ${(state.records.filter(record => record.enemyWeapons?.length).length)}/${state.records.length}`;
}

async function loadAnalytics({ announce = false } = {}) {
  const response = await fetch('/api/analytics', { cache: 'no-store' });
  if (!response.ok) throw new Error('横断分析データを読み込めませんでした');
  const payload = await response.json(); state.records = payload.records || []; state.status = payload.status || {}; state.definitions = payload.definitions || {};
  state.dimensions = analyticsDimensions(state.records); populateQuestionFormOptions(); updateDataHealth(); renderDashboard();
  if (announce) toast('最新データで更新しました');
  return payload;
}

async function refreshAnalytics() {
  const button = byId('refresh-analytics'); button.disabled = true; button.lastChild.textContent = ' 更新中';
  try {
    const response = await fetch('/api/analytics/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('データ更新を開始できませんでした');
    clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(async () => {
      try {
        const payload = await loadAnalytics();
        if (!payload.status?.running) { clearInterval(state.refreshTimer); button.disabled = false; button.lastChild.textContent = ' データ更新'; toast('データ更新が完了しました'); }
      } catch (error) {
        clearInterval(state.refreshTimer); button.disabled = false; button.lastChild.textContent = ' データ更新'; toast(error.message);
      }
    }, 1200);
  } catch (error) { button.disabled = false; button.lastChild.textContent = ' データ更新'; toast(error.message); }
}

function bindEvents() {
  byId('dashboard-select').addEventListener('change', event => { state.activeDashboardId = event.target.value; state.isEditing = false; saveDashboards(); setDashboardEditMode(false); });
  byId('toggle-dashboard-edit').addEventListener('click', () => setDashboardEditMode(!state.isEditing));
  byId('cancel-dashboard-edit').addEventListener('click', cancelDashboardEdit);
  byId('new-dashboard').addEventListener('click', () => openDashboardDialog('create'));
  byId('rename-dashboard').addEventListener('click', () => openDashboardDialog('rename'));
  byId('dashboard-form').addEventListener('submit', saveDashboardName);
  byId('add-question').addEventListener('click', () => openQuestionDialog());
  document.querySelectorAll('[data-open-question]').forEach(button => button.addEventListener('click', () => openQuestionDialog()));
  document.querySelectorAll('[data-question-template]').forEach(button => button.addEventListener('click', () => openQuestionDialog(null, button.dataset.questionTemplate)));
  byId('question-form').addEventListener('submit', saveQuestion);
  Object.values(questionControls).forEach(control => { control.addEventListener('input', updateQuestionPreview); control.addEventListener('change', updateQuestionPreview); });
  Object.values(globalControls).forEach(control => control.addEventListener('change', () => { state.globalFilters = globalFilters(); renderDashboard(); }));
  byId('reset-global-filters').addEventListener('click', () => { Object.values(globalControls).forEach(control => { control.value = ''; }); state.globalFilters = {}; renderDashboard(); });
  byId('refresh-analytics').addEventListener('click', refreshAnalytics);
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => byId(button.dataset.closeDialog).close()));
}

async function initialize() {
  loadDashboards(); renderQuestionTemplates(); bindEvents();
  try { await loadAnalytics(); } catch (error) { byId('dashboard-meta').textContent = error.message; toast(error.message); }
}

initialize();
