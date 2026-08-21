import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTION_TEMPLATES,
  arrangeDashboardCards,
  analyticsSummary,
  compactDashboardRows,
  defaultDashboard,
  filterAnalyticsRecords,
  groupAnalyticsRecords,
  metricSampleCount,
  moveDashboardCard,
  normalizeCardLayout,
  resizeDashboardCard,
  resizeCardLayout,
  runAnalyticsQuery,
} from '../public/analytics-core.js';

const records = [
  {
    id: '1', recordedAt: '2026-08-10T00:00:00.000Z', stage: 'A', rule: 'エリア', outcome: 'win',
    selfWeapon: '竹', enemyWeapons: ['ローラー'], deathCount: 2, disadvantageSeconds: 10,
    durationSeconds: 180, playerStats: { kills: 8, deaths: 2 },
  },
  {
    id: '2', recordedAt: '2026-08-11T00:00:00.000Z', stage: 'A', rule: 'ヤグラ', outcome: 'lose',
    selfWeapon: '竹', enemyWeapons: ['ローラー', 'ブラスター'], deathCount: 5, disadvantageSeconds: 42,
    durationSeconds: 240, playerStats: { kills: 4, deaths: 5 },
  },
  {
    id: '3', recordedAt: '2026-08-12T00:00:00.000Z', stage: 'B', rule: 'エリア', outcome: null,
    selfWeapon: null, enemyWeapons: [], deathCount: null, disadvantageSeconds: null,
    durationSeconds: 300, playerStats: { kills: null, deaths: null },
  },
];

test('全体条件とカード固有条件を重ねて絞り込む', () => {
  assert.deepEqual(filterAnalyticsRecords(records, { rule: 'エリア' }).map(record => record.id), ['1', '3']);
  assert.deepEqual(filterAnalyticsRecords(records, { deathsMax: 5 }).map(record => record.id), ['1', '2']);
  assert.deepEqual(filterAnalyticsRecords(records, { disadvantageMax: 60 }).map(record => record.id), ['1', '2']);
  const result = runAnalyticsQuery(records, {
    metric: 'lossRate', dimension: 'opponentWeapon', filters: { opponentWeapon: 'ローラー' },
  }, { outcome: 'lose' });
  assert.deepEqual(result.records.map(record => record.id), ['2']);
});

test('未取得K/Dを0として平均に混ぜない', () => {
  const summary = analyticsSummary(records);
  assert.equal(summary.matches, 3);
  assert.equal(summary.decided, 2);
  assert.equal(summary.winRate, 0.5);
  assert.equal(summary.averageKills, 6);
  assert.equal(summary.averageDeaths, 3.5);
  assert.equal(summary.kdRatio, 12 / 7);
  assert.equal(analyticsSummary([...records, {
    id: '4', playerStats: { kills: null, deaths: 10 }, deathCount: 10,
  }]).kdRatio, 12 / 7);
});

test('相手ブキ別では同じ試合を各ブキに1回ずつ数える', () => {
  const groups = groupAnalyticsRecords(records, 'opponentWeapon');
  const roller = groups.find(group => group.key === 'ローラー');
  assert.deepEqual(
    { matches: roller.matches, wins: roller.wins, losses: roller.losses, winRate: roller.winRate },
    { matches: 2, wins: 1, losses: 1, winRate: 0.5 },
  );
});

test('デス数帯と人数不利時間帯を自然順で比較できる', () => {
  assert.deepEqual(groupAnalyticsRecords(records, 'deathBucket').map(group => group.key), ['0–2デス', '3–5デス']);
  assert.deepEqual(groupAnalyticsRecords(records, 'disadvantageBucket').map(group => group.key), ['0–15秒', '31–60秒']);
});

test('最小試合数は選んだ指標を取得できた試合だけで判定する', () => {
  assert.equal(metricSampleCount(records, 'lossRate'), 2);
  assert.equal(metricSampleCount(records, 'averageDeaths'), 2);
  assert.deepEqual(groupAnalyticsRecords(records, 'stage', {
    metric: 'lossRate', minimumSamples: 1,
  }).map(group => ({ key: group.key, samples: group.samples })), [{ key: 'A', samples: 2 }]);
});

test('初期ダッシュボードとテンプレートが代表仮説をカバーする', () => {
  const dashboard = defaultDashboard();
  assert.ok(dashboard.cards.some(card => card.dimension === 'deathBucket' && card.metric === 'lossRate'));
  assert.ok(dashboard.cards.some(card => card.dimension === 'disadvantageBucket' && card.metric === 'lossRate'));
  assert.ok(QUESTION_TEMPLATES.some(template => template.spec.dimension === 'opponentWeapon'));
});

test('既存カードを12列グリッドへ移行し、縦横斜めにサイズ変更できる', () => {
  assert.deepEqual(normalizeCardLayout({ size: 'small' }), { columns: 3, rows: 6 });
  assert.deepEqual(normalizeCardLayout({ size: 'wide' }), { columns: 6, rows: 9 });
  assert.deepEqual(normalizeCardLayout({ size: 'full' }), { columns: 12, rows: 10 });
  assert.deepEqual(resizeCardLayout({ columns: 6, rows: 8 }, 'east', 2, 4), { columns: 8, rows: 8 });
  assert.deepEqual(resizeCardLayout({ columns: 6, rows: 8 }, 'south', 2, 3), { columns: 6, rows: 11 });
  assert.deepEqual(resizeCardLayout({ columns: 6, rows: 8 }, 'southeast', -2, 3), { columns: 4, rows: 11 });
  assert.deepEqual(resizeCardLayout({ columns: 3, rows: 5 }, 'southeast', -99, -99), { columns: 3, rows: 5 });
  assert.deepEqual(normalizeCardLayout({ layout: { column: 12, row: 4, columns: 6, rows: 8 } }), {
    column: 7, row: 4, columns: 6, rows: 8,
  });
});

test('カードの固定座標を保ち、重なったカードだけ空きグリッドへ送る', () => {
  const arranged = arrangeDashboardCards([
    { id: 'a', layout: { column: 1, row: 1, columns: 3, rows: 5 } },
    { id: 'b', layout: { column: 4, row: 1, columns: 3, rows: 5 } },
    { id: 'c', layout: { columns: 6, rows: 5 } },
  ]);
  assert.deepEqual(arranged.map(card => card.layout), [
    { column: 1, row: 1, columns: 3, rows: 5 },
    { column: 4, row: 1, columns: 3, rows: 5 },
    { column: 7, row: 1, columns: 6, rows: 5 },
  ]);

  const moved = arrangeDashboardCards([
    arranged[0],
    { ...arranged[1], layout: { ...arranged[1].layout, column: 1 } },
    arranged[2],
  ], 'b');
  assert.deepEqual(moved.find(card => card.id === 'b').layout, { column: 1, row: 1, columns: 3, rows: 5 });
  assert.deepEqual(moved.find(card => card.id === 'a').layout, { column: 4, row: 1, columns: 3, rows: 5 });
});

test('自由移動では空き位置を保ち、交換可能な2枚だけを入れ替える', () => {
  const cards = [
    { id: 'a', layout: { column: 1, row: 1, columns: 3, rows: 5 } },
    { id: 'b', layout: { column: 7, row: 1, columns: 3, rows: 5 } },
    { id: 'lower', layout: { column: 10, row: 8, columns: 3, rows: 5 } },
  ];
  const moved = moveDashboardCard(cards, 'a', { column: 4, row: 3 });
  assert.equal(moved.accepted, true);
  assert.deepEqual(moved.cards.find(card => card.id === 'a').layout, { column: 4, row: 3, columns: 3, rows: 5 });
  assert.deepEqual(moved.cards.find(card => card.id === 'lower').layout, cards[2].layout);

  const swapped = moveDashboardCard(cards, 'a', { column: 7, row: 1 });
  assert.equal(swapped.swappedWithId, 'b');
  assert.deepEqual(swapped.cards.find(card => card.id === 'a').layout, cards[1].layout);
  assert.deepEqual(swapped.cards.find(card => card.id === 'b').layout, cards[0].layout);

  const edgeOverlap = moveDashboardCard(cards, 'a', { column: 5, row: 1 });
  assert.equal(edgeOverlap.accepted, false);
  assert.equal(edgeOverlap.targetId, null);
  assert.deepEqual(edgeOverlap.previewLayout, { column: 5, row: 1, columns: 3, rows: 5 });
});

test('横位置を変えず、全12列が空白の行だけを削除する', () => {
  const compacted = compactDashboardRows([
    { id: 'top', layout: { column: 7, row: 1, columns: 3, rows: 5 } },
    { id: 'bottom', layout: { column: 10, row: 9, columns: 3, rows: 5 } },
  ]);
  assert.deepEqual(compacted.map(card => card.layout), [
    { column: 7, row: 1, columns: 3, rows: 5 },
    { column: 10, row: 6, columns: 3, rows: 5 },
  ]);

  const partialRow = compactDashboardRows([
    { id: 'tall', layout: { column: 1, row: 1, columns: 3, rows: 10 } },
    { id: 'right', layout: { column: 10, row: 8, columns: 3, rows: 5 } },
  ]);
  assert.equal(partialRow.find(card => card.id === 'right').layout.row, 8);
});

test('全8方向へリサイズし、横方向は端まで連鎖して押し、下方向は追加行だけを挿入する', () => {
  assert.deepEqual(resizeCardLayout({ column: 4, row: 6, columns: 6, rows: 8 }, 'northwest', -2, -3), {
    column: 2, row: 3, columns: 8, rows: 11,
  });
  assert.deepEqual(resizeCardLayout({ column: 4, row: 6, columns: 6, rows: 8 }, 'southwest', 2, 3), {
    column: 6, row: 6, columns: 4, rows: 11,
  });

  const horizontal = resizeDashboardCard([
    { id: 'a', layout: { column: 1, row: 1, columns: 3, rows: 5 } },
    { id: 'blocker', layout: { column: 5, row: 1, columns: 3, rows: 5 } },
  ], 'a', 'east', 5, 0);
  assert.equal(horizontal.layout.columns, 8);
  assert.deepEqual(horizontal.cards.find(card => card.id === 'blocker').layout, {
    column: 9, row: 1, columns: 3, rows: 5,
  });

  const horizontalWest = resizeDashboardCard([
    { id: 'blocker', layout: { column: 6, row: 1, columns: 3, rows: 5 } },
    { id: 'a', layout: { column: 10, row: 1, columns: 3, rows: 5 } },
  ], 'a', 'west', -5, 0);
  assert.equal(horizontalWest.layout.columns, 8);
  assert.equal(horizontalWest.layout.column, 5);
  assert.equal(horizontalWest.cards.find(card => card.id === 'blocker').layout.column, 2);

  const stoppedAtEdge = resizeDashboardCard([
    { id: 'a', layout: { column: 1, row: 1, columns: 3, rows: 5 } },
    { id: 'middle', layout: { column: 4, row: 1, columns: 3, rows: 5 } },
    { id: 'edge', layout: { column: 7, row: 1, columns: 6, rows: 5 } },
  ], 'a', 'east', 5, 0);
  assert.equal(stoppedAtEdge.layout.columns, 3);
  assert.equal(stoppedAtEdge.cards.find(card => card.id === 'middle').layout.column, 4);
  assert.equal(stoppedAtEdge.cards.find(card => card.id === 'edge').layout.column, 7);

  const vertical = resizeDashboardCard([
    { id: 'a', layout: { column: 1, row: 1, columns: 6, rows: 5 } },
    { id: 'below-left', layout: { column: 1, row: 6, columns: 6, rows: 5 } },
    { id: 'below-right', layout: { column: 7, row: 6, columns: 6, rows: 5 } },
  ], 'a', 'south', 0, 3);
  assert.equal(vertical.layout.rows, 8);
  assert.equal(vertical.cards.find(card => card.id === 'below-left').layout.row, 9);
  assert.equal(vertical.cards.find(card => card.id === 'below-right').layout.row, 9);
});
