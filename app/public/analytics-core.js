const unique = values => [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, 'ja'));

export const ANALYTICS_METRICS = {
  matchCount: { label: '試合数', shortLabel: '試合', format: 'count' },
  winRate: { label: '勝率', shortLabel: '勝率', format: 'percent' },
  lossRate: { label: '敗北率', shortLabel: '敗北率', format: 'percent' },
  averageKills: { label: '平均キル数', shortLabel: '平均K', format: 'decimal' },
  averageDeaths: { label: '平均デス数', shortLabel: '平均D', format: 'decimal' },
  kdRatio: { label: 'K/D比', shortLabel: 'K/D', format: 'ratio' },
  averageDisadvantage: { label: '平均人数不利時間', shortLabel: '人数不利', format: 'seconds' },
  averageAdvantage: { label: '平均人数有利時間', shortLabel: '人数有利', format: 'seconds' },
  averageDuration: { label: '平均試合時間', shortLabel: '試合時間', format: 'seconds' },
};

export const ANALYTICS_DIMENSIONS = {
  none: { label: '分けずに集計' },
  day: { label: '日付' },
  stage: { label: 'ステージ' },
  rule: { label: 'ルール' },
  selfWeapon: { label: '自分のブキ' },
  opponentWeapon: { label: '相手のブキ' },
  outcome: { label: '勝敗' },
  deathBucket: { label: '自分のデス数帯' },
  disadvantageBucket: { label: '人数不利の継続時間帯' },
};

export const ANALYTICS_CHARTS = {
  kpi: { label: '数値' },
  bar: { label: '棒グラフ' },
  line: { label: '折れ線' },
  donut: { label: 'ドーナツ' },
  table: { label: '表' },
};

export const DASHBOARD_GRID = Object.freeze({
  columns: 12,
  minimumColumns: 3,
  minimumRows: 5,
  maximumRows: 20,
});

const LEGACY_CARD_LAYOUTS = Object.freeze({
  small: { columns: 3, rows: 6 },
  wide: { columns: 6, rows: 9 },
  full: { columns: 12, rows: 10 },
});

const clampInteger = (value, minimum, maximum) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.round(number))) : minimum;
};

function defaultCardLayout(card = {}) {
  if (card.chart === 'kpi' || card.dimension === 'none') return { columns: 3, rows: 6 };
  if (card.chart === 'table') return { columns: 12, rows: 10 };
  if (card.chart === 'bar' && ['stage', 'opponentWeapon'].includes(card.dimension)) return { columns: 6, rows: 12 };
  return { columns: 6, rows: 8 };
}

export function normalizeCardLayout(card = {}) {
  const source = card.layout && typeof card.layout === 'object'
    ? card.layout
    : LEGACY_CARD_LAYOUTS[card.size] || defaultCardLayout(card);
  const layout = {
    columns: clampInteger(source.columns, DASHBOARD_GRID.minimumColumns, DASHBOARD_GRID.columns),
    rows: clampInteger(source.rows, DASHBOARD_GRID.minimumRows, DASHBOARD_GRID.maximumRows),
  };
  const column = Number(source.column);
  const row = Number(source.row);
  if (Number.isFinite(column) && Number.isFinite(row)) {
    layout.column = clampInteger(column, 1, DASHBOARD_GRID.columns - layout.columns + 1);
    layout.row = Math.max(1, Math.round(row));
  }
  return layout;
}

export function resizeCardLayout(layout, direction, columnDelta = 0, rowDelta = 0) {
  const normalized = normalizeCardLayout({ layout });
  const hasPosition = normalized.column != null && normalized.row != null;
  const startColumn = normalized.column || 1;
  const startRow = normalized.row || 1;
  let left = startColumn;
  let right = startColumn + normalized.columns;
  let top = startRow;
  let bottom = startRow + normalized.rows;
  if (direction.includes('west')) left = clampInteger(left + columnDelta, 1, right - DASHBOARD_GRID.minimumColumns);
  if (direction.includes('east')) right = clampInteger(right + columnDelta, left + DASHBOARD_GRID.minimumColumns, DASHBOARD_GRID.columns + 1);
  if (direction.includes('north')) top = clampInteger(top + rowDelta, Math.max(1, bottom - DASHBOARD_GRID.maximumRows), bottom - DASHBOARD_GRID.minimumRows);
  if (direction.includes('south')) bottom = clampInteger(bottom + rowDelta, top + DASHBOARD_GRID.minimumRows, top + DASHBOARD_GRID.maximumRows);
  return {
    ...(hasPosition ? { column: left, row: top } : {}),
    columns: right - left,
    rows: bottom - top,
  };
}

export function layoutsOverlap(left, right) {
  return left.column < right.column + right.columns
    && left.column + left.columns > right.column
    && left.row < right.row + right.rows
    && left.row + left.rows > right.row;
}

function layoutFitsGrid(layout) {
  return layout.column >= 1
    && layout.column + layout.columns <= DASHBOARD_GRID.columns + 1
    && layout.row >= 1;
}

function normalizedPositionedCards(cards) {
  return arrangeDashboardCards(cards).map(card => ({ ...card, layout: normalizeCardLayout(card) }));
}

export function compactDashboardRows(cards) {
  const positioned = cards.map(card => ({ ...card, layout: normalizeCardLayout(card) }));
  const occupiedRows = new Set();
  for (const card of positioned) {
    for (let row = card.layout.row; row < card.layout.row + card.layout.rows; row += 1) occupiedRows.add(row);
  }
  return positioned.map(card => {
    let emptyRowsBefore = 0;
    for (let row = 1; row < card.layout.row; row += 1) {
      if (!occupiedRows.has(row)) emptyRowsBefore += 1;
    }
    return { ...card, layout: { ...card.layout, row: card.layout.row - emptyRowsBefore } };
  });
}

export function moveDashboardCard(cards, cardId, requestedLayout) {
  const positioned = normalizedPositionedCards(cards);
  const moving = positioned.find(card => card.id === cardId);
  if (!moving) return { cards: positioned, accepted: false, swappedWithId: null, targetId: null, previewLayout: null };
  const candidate = normalizeCardLayout({ layout: { ...moving.layout, ...requestedLayout } });
  const others = positioned.filter(card => card.id !== cardId);
  const collisions = others.filter(card => layoutsOverlap(candidate, card.layout));
  if (collisions.length === 0) {
    return {
      cards: compactDashboardRows(positioned.map(card => card.id === cardId ? { ...card, layout: candidate } : card)),
      accepted: true,
      swappedWithId: null,
      targetId: null,
      previewLayout: candidate,
    };
  }
  const centerColumn = candidate.column + candidate.columns / 2;
  const centerRow = candidate.row + candidate.rows / 2;
  const target = collisions.find(card => centerColumn >= card.layout.column
    && centerColumn < card.layout.column + card.layout.columns
    && centerRow >= card.layout.row
    && centerRow < card.layout.row + card.layout.rows);
  if (!target) return { cards: positioned, accepted: false, swappedWithId: null, targetId: null, previewLayout: candidate };
  const movedLayout = { ...moving.layout, column: target.layout.column, row: target.layout.row };
  const swappedLayout = { ...target.layout, column: moving.layout.column, row: moving.layout.row };
  const rest = others.filter(card => card.id !== target.id);
  const canSwap = layoutFitsGrid(movedLayout)
    && layoutFitsGrid(swappedLayout)
    && !layoutsOverlap(movedLayout, swappedLayout)
    && !rest.some(card => layoutsOverlap(movedLayout, card.layout) || layoutsOverlap(swappedLayout, card.layout));
  if (!canSwap) return { cards: positioned, accepted: false, swappedWithId: null, targetId: target.id, previewLayout: candidate };
  return {
    cards: compactDashboardRows(positioned.map(card => {
      if (card.id === cardId) return { ...card, layout: movedLayout };
      if (card.id === target.id) return { ...card, layout: swappedLayout };
      return card;
    })),
    accepted: true,
    swappedWithId: target.id,
    targetId: target.id,
    previewLayout: movedLayout,
  };
}

function deltasTowardZero(value) {
  const rounded = Math.round(Number(value) || 0);
  const step = rounded < 0 ? 1 : -1;
  const values = [];
  for (let current = rounded; current !== 0; current += step) values.push(current);
  values.push(0);
  return values;
}

function pushCardsHorizontally(cards, anchorId, direction, originals) {
  const layoutById = new Map(cards.map(card => [card.id, { ...card.layout }]));
  const queue = [anchorId];
  let iterations = 0;
  while (queue.length && iterations < cards.length * cards.length) {
    iterations += 1;
    const currentId = queue.shift();
    const current = layoutById.get(currentId);
    const originalCurrent = originals.get(currentId);
    for (const card of cards) {
      if (card.id === currentId) continue;
      const other = layoutById.get(card.id);
      if (!layoutsOverlap(current, other)) continue;
      const originalOther = originals.get(card.id);
      const isInPushDirection = direction === 'east'
        ? originalOther.column >= originalCurrent.column + originalCurrent.columns
        : originalOther.column + originalOther.columns <= originalCurrent.column;
      if (!isInPushDirection) continue;
      const column = direction === 'east'
        ? current.column + current.columns
        : current.column - other.columns;
      const shifted = { ...other, column };
      if (!layoutFitsGrid(shifted)) return null;
      if (shifted.column === other.column) continue;
      layoutById.set(card.id, shifted);
      queue.push(card.id);
    }
  }
  const pushed = cards.map(card => ({ ...card, layout: layoutById.get(card.id) }));
  const overlaps = pushed.some((card, index) => pushed.slice(index + 1).some(other => layoutsOverlap(card.layout, other.layout)));
  return overlaps ? null : pushed;
}

export function resizeDashboardCard(cards, cardId, direction, columnDelta = 0, rowDelta = 0) {
  const positioned = normalizedPositionedCards(cards);
  const originals = new Map(positioned.map(card => [card.id, card.layout]));
  const resizing = positioned.find(card => card.id === cardId);
  if (!resizing) return { cards: positioned, layout: null };
  const horizontalDeltas = direction.includes('east') || direction.includes('west') ? deltasTowardZero(columnDelta) : [0];
  const verticalDeltas = direction.includes('north') || direction.includes('south') ? deltasTowardZero(rowDelta) : [0];
  const attempts = horizontalDeltas.flatMap(horizontal => verticalDeltas.map(vertical => ({
    horizontal,
    vertical,
    distance: Math.abs(horizontal - Math.round(columnDelta || 0)) + Math.abs(vertical - Math.round(rowDelta || 0)),
  }))).sort((left, right) => left.distance - right.distance);
  for (const attempt of attempts) {
    const layout = resizeCardLayout(resizing.layout, direction, attempt.horizontal, attempt.vertical);
    const oldBottom = resizing.layout.row + resizing.layout.rows;
    const newBottom = layout.row + layout.rows;
    const insertedRows = direction.includes('south') ? Math.max(0, newBottom - oldBottom) : 0;
    let nextCards = positioned.map(card => {
      if (card.id === cardId) return { ...card, layout };
      if (insertedRows && card.layout.row >= oldBottom) {
        return { ...card, layout: { ...card.layout, row: card.layout.row + insertedRows } };
      }
      return card;
    });
    const growsEast = direction.includes('east')
      && layout.column + layout.columns > resizing.layout.column + resizing.layout.columns;
    const growsWest = direction.includes('west') && layout.column < resizing.layout.column;
    if (growsEast || growsWest) {
      nextCards = pushCardsHorizontally(nextCards, cardId, growsEast ? 'east' : 'west', originals);
      if (!nextCards) continue;
    }
    const resized = nextCards.find(card => card.id === cardId);
    if (nextCards.some(card => card.id !== cardId && layoutsOverlap(resized.layout, card.layout))) continue;
    const compacted = compactDashboardRows(nextCards);
    return { cards: compacted, layout: compacted.find(card => card.id === cardId).layout };
  }
  return { cards: positioned, layout: resizing.layout };
}

function firstAvailableLayout(layout, occupied, startRow = 1) {
  for (let row = Math.max(1, startRow); row < 1000; row += 1) {
    for (let column = 1; column <= DASHBOARD_GRID.columns - layout.columns + 1; column += 1) {
      const candidate = { ...layout, column, row };
      if (!occupied.some(other => layoutsOverlap(candidate, other))) return candidate;
    }
  }
  return { ...layout, column: 1, row: 1000 };
}

export function arrangeDashboardCards(cards, priorityId = null) {
  const normalized = cards.map(card => ({ ...card, layout: normalizeCardLayout(card) }));
  const ordered = priorityId
    ? [...normalized.filter(card => card.id === priorityId), ...normalized.filter(card => card.id !== priorityId)]
    : normalized;
  const occupied = [];
  const layoutById = new Map();
  for (const card of ordered) {
    const requested = card.layout;
    const positioned = requested.column && !occupied.some(other => layoutsOverlap(requested, other))
      ? requested
      : firstAvailableLayout(requested, occupied, requested.row || 1);
    occupied.push(positioned);
    layoutById.set(card.id, positioned);
  }
  return normalized.map(card => ({ ...card, layout: layoutById.get(card.id) }));
}

export const QUESTION_TEMPLATES = [
  {
    id: 'stage-opponent',
    title: 'ステージ × 相手ブキの敗北率',
    description: '特定ステージで、相手のどのブキがいると負けやすいかを見る',
    icon: '◎',
    spec: { metric: 'lossRate', dimension: 'opponentWeapon', chart: 'bar', minimumSamples: 1, sort: 'desc', filters: {} },
  },
  {
    id: 'disadvantage-loss',
    title: '人数不利の長さと敗北率',
    description: '人数不利が長く続いた試合ほど負けやすいかを見る',
    icon: '↘',
    spec: { metric: 'lossRate', dimension: 'disadvantageBucket', chart: 'line', minimumSamples: 1, sort: 'natural', filters: {} },
  },
  {
    id: 'deaths-loss',
    title: 'デス数と敗北率',
    description: '自分のデス数が増えるほど負けやすいかを見る',
    icon: '×',
    spec: { metric: 'lossRate', dimension: 'deathBucket', chart: 'bar', minimumSamples: 1, sort: 'natural', filters: {} },
  },
  {
    id: 'stage-win-rate',
    title: 'ステージ別の勝率',
    description: '得意・苦手なステージを勝率で比較する',
    icon: '▥',
    spec: { metric: 'winRate', dimension: 'stage', chart: 'bar', minimumSamples: 1, sort: 'desc', filters: {} },
  },
  {
    id: 'daily-trend',
    title: '日ごとの勝率推移',
    description: 'プレイ日の変化を時系列で追う',
    icon: '⌁',
    spec: { metric: 'winRate', dimension: 'day', chart: 'line', minimumSamples: 1, sort: 'natural', filters: {} },
  },
];

export function analyticsDimensions(records) {
  return {
    stages: unique(records.map(record => record.stage)),
    rules: unique(records.map(record => record.rule)),
    selfWeapons: unique(records.map(record => typeof record.selfWeapon === 'string' ? record.selfWeapon : record.selfWeapon?.name)),
    opponentWeapons: unique(records.flatMap(record => record.enemyWeapons || [])),
  };
}

function selfWeaponName(record) {
  return typeof record.selfWeapon === 'string' ? record.selfWeapon : record.selfWeapon?.name || null;
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function filterAnalyticsRecords(records, filters = {}, now = new Date()) {
  const periodCutoff = filters.periodDays && Number(filters.periodDays) > 0
    ? new Date(now.getTime() - Number(filters.periodDays) * 86_400_000)
    : null;
  const query = String(filters.query || '').trim().toLocaleLowerCase('ja');
  return records.filter(record => {
    const parsedRecordedAt = record.recordedAt ? new Date(record.recordedAt) : null;
    const recordedAt = parsedRecordedAt && Number.isFinite(parsedRecordedAt.getTime()) ? parsedRecordedAt : null;
    const day = dateOnly(record.recordedAt);
    if (periodCutoff && (!recordedAt || recordedAt < periodCutoff)) return false;
    if (filters.dateFrom && (!day || day < filters.dateFrom)) return false;
    if (filters.dateTo && (!day || day > filters.dateTo)) return false;
    if (filters.outcome && record.outcome !== filters.outcome) return false;
    if (filters.stage && record.stage !== filters.stage) return false;
    if (filters.rule && record.rule !== filters.rule) return false;
    if (filters.selfWeapon && selfWeaponName(record) !== filters.selfWeapon) return false;
    if (filters.opponentWeapon && !(record.enemyWeapons || []).includes(filters.opponentWeapon)) return false;
    const hasDeathFilter = (filters.deathsMin !== '' && filters.deathsMin != null) || (filters.deathsMax !== '' && filters.deathsMax != null);
    const deathCount = finiteNumber(record.deathCount ?? record.playerStats?.deaths);
    if (hasDeathFilter && deathCount == null) return false;
    if (filters.deathsMin !== '' && filters.deathsMin != null && deathCount < Number(filters.deathsMin)) return false;
    if (filters.deathsMax !== '' && filters.deathsMax != null && deathCount > Number(filters.deathsMax)) return false;
    const hasDisadvantageFilter = (filters.disadvantageMin !== '' && filters.disadvantageMin != null)
      || (filters.disadvantageMax !== '' && filters.disadvantageMax != null);
    const disadvantageSeconds = finiteNumber(record.disadvantageSeconds);
    if (hasDisadvantageFilter && disadvantageSeconds == null) return false;
    if (filters.disadvantageMin !== '' && filters.disadvantageMin != null && disadvantageSeconds < Number(filters.disadvantageMin)) return false;
    if (filters.disadvantageMax !== '' && filters.disadvantageMax != null && disadvantageSeconds > Number(filters.disadvantageMax)) return false;
    if (query) {
      const haystack = [
        record.recordingFileName, record.stage, record.rule, record.outcome,
        selfWeaponName(record), ...(record.enemyWeapons || []),
      ].filter(Boolean).join(' ').toLocaleLowerCase('ja');
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function finiteValues(records, getter) {
  return records.map(getter)
    .filter(value => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(Number.isFinite);
}

export function analyticsSummary(records) {
  const decided = records.filter(record => record.outcome === 'win' || record.outcome === 'lose');
  const wins = decided.filter(record => record.outcome === 'win').length;
  const losses = decided.length - wins;
  const kills = finiteValues(records, record => record.playerStats?.kills);
  const deaths = finiteValues(records, record => record.deathCount ?? record.playerStats?.deaths);
  const disadvantage = finiteValues(records, record => record.disadvantageSeconds);
  const advantage = finiteValues(records, record => record.advantageSeconds);
  const duration = finiteValues(records, record => record.durationSeconds);
  const killDeathPairs = records.map(record => ({
    kills: finiteNumber(record.playerStats?.kills),
    deaths: finiteNumber(record.deathCount ?? record.playerStats?.deaths),
  })).filter(pair => pair.kills != null && pair.deaths != null);
  const sum = values => values.reduce((total, value) => total + value, 0);
  const pairedKills = sum(killDeathPairs.map(pair => pair.kills));
  const pairedDeaths = sum(killDeathPairs.map(pair => pair.deaths));
  return {
    matches: records.length,
    decided: decided.length,
    wins,
    losses,
    winRate: decided.length ? wins / decided.length : null,
    lossRate: decided.length ? losses / decided.length : null,
    averageKills: kills.length ? sum(kills) / kills.length : null,
    averageDeaths: deaths.length ? sum(deaths) / deaths.length : null,
    kdRatio: killDeathPairs.length && pairedDeaths > 0 ? pairedKills / pairedDeaths : null,
    averageDisadvantage: disadvantage.length ? sum(disadvantage) / disadvantage.length : null,
    averageAdvantage: advantage.length ? sum(advantage) / advantage.length : null,
    averageDuration: duration.length ? sum(duration) / duration.length : null,
    rosterCoverage: records.length ? records.filter(record => (record.enemyWeapons || []).length).length / records.length : 0,
  };
}

export function metricValue(records, metric) {
  const summary = analyticsSummary(records);
  if (metric === 'matchCount') return summary.matches;
  return summary[metric] ?? null;
}

export function metricSampleCount(records, metric) {
  if (metric === 'matchCount') return records.length;
  if (metric === 'winRate' || metric === 'lossRate') return records.filter(record => record.outcome === 'win' || record.outcome === 'lose').length;
  if (metric === 'averageKills') return finiteValues(records, record => record.playerStats?.kills).length;
  if (metric === 'averageDeaths') return finiteValues(records, record => record.deathCount ?? record.playerStats?.deaths).length;
  if (metric === 'kdRatio') return records.filter(record => finiteNumber(record.playerStats?.kills) != null
    && finiteNumber(record.deathCount ?? record.playerStats?.deaths) != null).length;
  if (metric === 'averageDisadvantage') return finiteValues(records, record => record.disadvantageSeconds).length;
  if (metric === 'averageAdvantage') return finiteValues(records, record => record.advantageSeconds).length;
  if (metric === 'averageDuration') return finiteValues(records, record => record.durationSeconds).length;
  return records.length;
}

function deathBucket(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return null;
  if (count <= 2) return '0–2デス';
  if (count <= 5) return '3–5デス';
  if (count <= 8) return '6–8デス';
  return '9デス以上';
}

function disadvantageBucket(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return null;
  if (seconds <= 15) return '0–15秒';
  if (seconds <= 30) return '16–30秒';
  if (seconds <= 60) return '31–60秒';
  return '61秒以上';
}

function dimensionValues(record, dimension) {
  if (dimension === 'day') return [dateOnly(record.recordedAt)];
  if (dimension === 'stage') return [record.stage];
  if (dimension === 'rule') return [record.rule];
  if (dimension === 'selfWeapon') return [selfWeaponName(record)];
  if (dimension === 'opponentWeapon') return record.enemyWeapons || [];
  if (dimension === 'outcome') return [record.outcome === 'win' ? 'WIN' : record.outcome === 'lose' ? 'LOSE' : '未取得'];
  if (dimension === 'deathBucket') return [deathBucket(record.deathCount ?? record.playerStats?.deaths)];
  if (dimension === 'disadvantageBucket') return [disadvantageBucket(record.disadvantageSeconds)];
  return ['全体'];
}

const NATURAL_ORDER = {
  '0–2デス': 0, '3–5デス': 1, '6–8デス': 2, '9デス以上': 3,
  '0–15秒': 0, '16–30秒': 1, '31–60秒': 2, '61秒以上': 3,
  WIN: 0, LOSE: 1, 未取得: 2,
};

export function groupAnalyticsRecords(records, dimension, { metric = 'winRate', minimumSamples = 1, sort = 'auto' } = {}) {
  const groups = new Map();
  for (const record of records) {
    for (const key of unique(dimensionValues(record, dimension))) {
      if (!key) continue;
      const group = groups.get(key) || [];
      group.push(record);
      groups.set(key, group);
    }
  }
  const result = [...groups.entries()].map(([key, groupRecords]) => ({
    key,
    value: metricValue(groupRecords, metric),
    samples: metricSampleCount(groupRecords, metric),
    records: groupRecords,
    ...analyticsSummary(groupRecords),
  })).filter(group => group.samples >= Math.max(1, Number(minimumSamples) || 1));
  const mode = sort === 'auto' ? (['day', 'deathBucket', 'disadvantageBucket', 'outcome'].includes(dimension) ? 'natural' : 'desc') : sort;
  return result.sort((left, right) => {
    if (mode === 'natural') return (NATURAL_ORDER[left.key] ?? Number.MAX_SAFE_INTEGER) - (NATURAL_ORDER[right.key] ?? Number.MAX_SAFE_INTEGER)
      || left.key.localeCompare(right.key, 'ja');
    if (mode === 'asc') return (left.value ?? Number.MAX_SAFE_INTEGER) - (right.value ?? Number.MAX_SAFE_INTEGER) || right.matches - left.matches;
    if (mode === 'matches') return right.matches - left.matches || left.key.localeCompare(right.key, 'ja');
    return (right.value ?? -Infinity) - (left.value ?? -Infinity) || right.matches - left.matches;
  });
}

export function runAnalyticsQuery(records, spec = {}, globalFilters = {}) {
  const globallyFiltered = filterAnalyticsRecords(records, globalFilters);
  const filtered = filterAnalyticsRecords(globallyFiltered, spec.filters || {});
  const metric = ANALYTICS_METRICS[spec.metric] ? spec.metric : 'matchCount';
  const dimension = ANALYTICS_DIMENSIONS[spec.dimension] ? spec.dimension : 'none';
  return {
    metric,
    dimension,
    records: filtered,
    summary: analyticsSummary(filtered),
    sampleCount: metricSampleCount(filtered, metric),
    value: metricValue(filtered, metric),
    groups: dimension === 'none' ? [] : groupAnalyticsRecords(filtered, dimension, {
      metric,
      minimumSamples: spec.minimumSamples,
      sort: spec.sort,
    }),
  };
}

export function formatAnalyticsValue(value, metric) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const format = ANALYTICS_METRICS[metric]?.format;
  if (format === 'percent') return `${(Number(value) * 100).toFixed(1)}%`;
  if (format === 'seconds') return `${Number(value).toFixed(1)}秒`;
  if (format === 'count') return `${Math.round(Number(value))}`;
  if (format === 'ratio') return Number(value).toFixed(2);
  return Number(value).toFixed(1);
}

export function defaultDashboard() {
  return {
    id: 'hypothesis-lab',
    name: '仮説検証ダッシュボード',
    cards: [
      { id: 'overview-win-rate', title: '全体の勝率', metric: 'winRate', dimension: 'none', chart: 'kpi', layout: { column: 1, row: 1, columns: 3, rows: 6 }, minimumSamples: 1, filters: {} },
      { id: 'overview-deaths', title: '平均デス数', metric: 'averageDeaths', dimension: 'none', chart: 'kpi', layout: { column: 4, row: 1, columns: 3, rows: 6 }, minimumSamples: 1, filters: {} },
      { id: 'stage-loss-rate', title: 'ステージ別の敗北率', metric: 'lossRate', dimension: 'stage', chart: 'bar', layout: { column: 7, row: 1, columns: 6, rows: 12 }, minimumSamples: 1, sort: 'desc', filters: {} },
      { id: 'disadvantage-loss-rate', title: '人数不利時間と敗北率', metric: 'lossRate', dimension: 'disadvantageBucket', chart: 'line', layout: { column: 1, row: 7, columns: 6, rows: 8 }, minimumSamples: 1, sort: 'natural', filters: {} },
      { id: 'deaths-loss-rate', title: 'デス数と敗北率', metric: 'lossRate', dimension: 'deathBucket', chart: 'bar', layout: { column: 7, row: 13, columns: 6, rows: 8 }, minimumSamples: 1, sort: 'natural', filters: {} },
      { id: 'stage-table', title: 'ステージ別サマリー', metric: 'winRate', dimension: 'stage', chart: 'table', layout: { column: 1, row: 21, columns: 12, rows: 10 }, minimumSamples: 1, sort: 'desc', filters: {} },
    ],
  };
}
