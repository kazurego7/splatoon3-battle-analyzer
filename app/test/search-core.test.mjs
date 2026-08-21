import test from 'node:test';
import assert from 'node:assert/strict';
import { filterMatchRecords, matchReviewUrl, recordSelfWeapon, ruleIconUrl, searchDimensions, stageIconUrl, weaponCatalogEntry, weaponTypeForName, weaponTypeTabs } from '../public/search-core.js';

const records = [
  { id: 'a', recordingId: 'rec 1', matchNumber: 2, recordedAt: '2026-08-20T12:00:00Z', stage: 'マサバ海峡大橋', rule: 'エリア', selfWeapon: 'ホクサイ', enemyWeapons: ['もみじシューター', 'ケルビン525'] },
  { id: 'b', recordingId: 'rec-2', matchNumber: 1, recordedAt: '2026-08-19T12:00:00Z', stage: 'ゴンズイ地区', rule: 'ヤグラ', selfWeapon: { name: '14式竹筒銃・甲' }, enemyWeapons: ['エクスプロッシャー', 'プロモデラーRG'] },
  { id: 'c', recordingId: 'rec-3', matchNumber: 3, recordedAt: '2026-08-18T12:00:00Z', stage: 'マサバ海峡大橋', rule: 'ホコ', selfWeapon: 'スペースシューターコラボ', enemyWeapons: ['ホクサイ'] },
];

test('検索候補をカテゴリ別に重複なく抽出する', () => {
  assert.deepEqual(searchDimensions(records), {
    stages: ['ゴンズイ地区', 'マサバ海峡大橋'],
    rules: ['アサリ', 'エリア', 'ナワバリ', 'ホコ', 'ヤグラ'],
    selfWeapons: ['14式竹筒銃・甲', 'スペースシューターコラボ', 'ホクサイ'],
    opponentWeapons: ['エクスプロッシャー', 'ケルビン525', 'プロモデラーRG', 'ホクサイ', 'もみじシューター'],
  });
  assert.equal(recordSelfWeapon(records[1]), '14式竹筒銃・甲');
  const withCatalog = searchDimensions(records, ['.52ガロン']);
  assert.equal(withCatalog.selfWeapons.includes('.52ガロン'), true);
  assert.equal(withCatalog.opponentWeapons.includes('.52ガロン'), true);
});

test('同じカテゴリ内はOR、カテゴリ間はANDで複数選択を絞り込む', () => {
  const selections = {
    stages: new Set(['マサバ海峡大橋', 'ゴンズイ地区']),
    rules: new Set(['エリア', 'ホコ']),
    selfWeapons: new Set(),
    opponentWeapons: new Set(['ホクサイ', 'ケルビン525']),
  };
  assert.deepEqual(filterMatchRecords(records, selections).map(record => record.id), ['a', 'c']);
  selections.selfWeapons.add('スペースシューターコラボ');
  assert.deepEqual(filterMatchRecords(records, selections).map(record => record.id), ['c']);
  selections.selfWeapons = new Set(['竹']);
  selections.rules = new Set(['ヤグラ']);
  selections.opponentWeapons = new Set();
  assert.deepEqual(filterMatchRecords(records, selections).map(record => record.id), ['b']);
});

test('検索結果から既存の試合レビューとステージ画像へ遷移できる', () => {
  assert.equal(matchReviewUrl(records[0]), './?recording=rec%201&match=2');
  assert.equal(matchReviewUrl({ recordingId: 'x' }), null);
  assert.equal(stageIconUrl('マサバ海峡大橋'), '/assets/stage-maps/%E3%83%9E%E3%82%B5%E3%83%90%E6%B5%B7%E5%B3%A1%E5%A4%A7%E6%A9%8B_%E3%82%A8%E3%83%AA%E3%82%A2.webp');
  assert.equal(ruleIconUrl('ヤグラ'), '/assets/rule-icons/tower.png');
});

test('ブキ名をカタログのブキ種へ対応させ、タブを定義順に並べる', () => {
  const catalog = [
    { name: '.52ガロン', type: 'シューター', iconUrl: '/52.webp' },
    { name: '14式竹筒銃・甲', type: 'チャージャー', iconUrl: '/take.webp' },
    { name: 'ホクサイ', type: 'フデ', iconUrl: '/hokusai.webp' },
  ];
  assert.equal(weaponCatalogEntry('竹', catalog)?.name, '14式竹筒銃・甲');
  assert.equal(weaponTypeForName('.52ガロン', catalog), 'シューター');
  assert.equal(weaponTypeForName('未登録ブキ', catalog), 'その他');
  assert.deepEqual(weaponTypeTabs(['ホクサイ', '未登録ブキ', '竹', '.52ガロン'], catalog), ['シューター', 'チャージャー', 'フデ', 'その他']);
});
