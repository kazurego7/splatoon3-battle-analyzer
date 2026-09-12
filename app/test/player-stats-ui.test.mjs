import test from 'node:test';
import assert from 'node:assert/strict';
import { formatKillDeath, killDeathFromAnalysis } from '../public/player-stats-ui.js';
import { deriveMatchAnalytics, effectiveAnalyticsRecord } from '../src/match-analytics.mjs';

test('K/Dを一覧向けに整形する', () => {
  assert.equal(formatKillDeath(8, 5), 'K 8 / D 5');
  assert.equal(formatKillDeath(null, 5), 'K — / D 5');
  assert.equal(formatKillDeath(null, null), 'K/D 未取得');
});

test('旧解析JSONではリザルト検証のデス数を使う', () => {
  assert.equal(killDeathFromAnalysis({ validation: { deaths: { expected: 7 } } }), 'K — / D 7');
});

test('横断分析の試合レコードにK/Dを引き継ぐ', () => {
  const record = deriveMatchAnalytics({
    matchId: 'match-01',
    media: { duration: 180 },
    events: [],
    playerStats: { kills: 11, deaths: 4 },
    validation: { deaths: { expected: 7 } },
  }, {
    recording: { id: 'recording-1', fileName: '2026-08-16_12-00-00.mp4' },
    match: { id: 'match-01', number: 1, start: 0, duration: 180 },
  });
  assert.deepEqual(record.playerStats, { kills: 11, deaths: 4 });
  assert.equal(record.deathCount, 4);
});

test('旧データにスペシャル数があっても横断分析へ引き継がない', () => {
  const record = deriveMatchAnalytics({
    matchId: 'match-01',
    media: { duration: 180 },
    events: [],
    playerStats: { kills: 11, deaths: 4, specials: 3, source: 'legacy-result' },
  }, {
    recording: { id: 'recording-1', fileName: '2026-08-16_12-00-00.mp4' },
    match: { id: 'match-01', number: 1, start: 0, duration: 180 },
  });
  assert.deepEqual(record.playerStats, { kills: 11, deaths: 4, source: 'legacy-result' });
});

test('基本項目を手動補正した試合を横断分析で利用できる', () => {
  const record = effectiveAnalyticsRecord({
    automatic: { stage: null, rule: null, outcome: null },
    overrides: { stage: 'ゴンズイ地区', rule: 'エリア', outcome: 'win' },
    updatedAt: '2026-08-20T00:00:00.000Z',
  });
  assert.equal(record.analyticsStatus, 'ready');
  assert.deepEqual(record.coverage, {
    stage: true, rule: true, outcome: true, selfWeapon: false, roster: false,
  });
});
