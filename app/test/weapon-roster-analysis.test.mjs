import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWeaponRosterAnalysis } from '../src/weapon-roster-analysis.mjs';
import { WEAPON_HUD_FIXED_RECTS } from '../src/weapon-reference-sheets.mjs';

const weapons = [
  { name: '竹', type: 'チャージャー' },
  { name: 'ホクサイ', type: 'フデ' },
  { name: 'ケルビン', type: 'マニューバー' },
  { name: '金モデ', type: 'シューター' },
  { name: 'エクス', type: 'スロッシャー' },
];
const entries = new Map([['match-01', {
  id: 'match-01', times: [12.25, 13.75], expectedSelfWeapon: '竹',
}]]);
const slot = (referenceId, confidence = 0.97) => ({
  firstType: weapons[referenceId - 1].type,
  secondType: weapons[referenceId - 1].type,
  type: weapons[referenceId - 1].type,
  firstReferenceId: referenceId,
  secondReferenceId: referenceId,
  referenceId,
  confidence,
});

test('1920×1080 HUDの8枠を固定座標で切り抜く', () => {
  const cropOffsetX = 460;
  assert.deepEqual(WEAPON_HUD_FIXED_RECTS.map(rect => ({
    label: rect.label,
    x1: rect.left + cropOffsetX,
    x2: rect.left + cropOffsetX + rect.width,
    y1: rect.top,
    y2: rect.top + rect.height,
  })), [
    { label: 'A1', x1: 528, x2: 617, y1: 24, y2: 116 },
    { label: 'A2', x1: 617, x2: 702, y1: 24, y2: 116 },
    { label: 'A3', x1: 702, x2: 789, y1: 24, y2: 116 },
    { label: 'A4', x1: 789, x2: 886, y1: 24, y2: 116 },
    { label: 'E1', x1: 1041, x2: 1130, y1: 24, y2: 116 },
    { label: 'E2', x1: 1130, x2: 1219, y1: 24, y2: 116 },
    { label: 'E3', x1: 1219, x2: 1309, y1: 24, y2: 116 },
    { label: 'E4', x1: 1309, x2: 1401, y1: 24, y2: 116 },
  ]);
});

test('2フレームの種別と参照番号が一致し、自ブキも確認できた編成だけ確定する', () => {
  const [result] = normalizeWeaponRosterAnalysis({ matches: [{
    id: 'match-01',
    team: [slot(2), slot(4), slot(3), slot(1)],
    enemy: [slot(5), slot(4), slot(3), slot(2)],
    evidence: '2フレームで一致',
  }] }, entries, weapons);
  assert.equal(result.complete, true);
  assert.equal(result.selfSlot, 3);
  assert.deepEqual(result.allyWeapons, ['ホクサイ', '金モデ', 'ケルビン']);
  assert.deepEqual(result.enemyWeapons, ['エクス', '金モデ', 'ケルビン', 'ホクサイ']);
});

test('フレーム間の不一致と種別外参照を完全取得として保存しない', () => {
  const frameMismatch = slot(4);
  frameMismatch.secondReferenceId = 3;
  const wrongType = slot(4);
  wrongType.firstType = 'ローラー';
  wrongType.secondType = 'ローラー';
  wrongType.type = 'ローラー';
  const [result] = normalizeWeaponRosterAnalysis({ matches: [{
    id: 'match-01',
    team: [slot(2), slot(4), slot(3), slot(1)],
    enemy: [slot(5), frameMismatch, wrongType, slot(2)],
    evidence: '',
  }] }, entries, weapons);
  assert.equal(result.complete, false);
  assert.equal(result.enemyWeapons.length, 2);
});

test('正規化済みキャッシュを再利用できる', () => {
  const raw = { matches: [{
    id: 'match-01', team: [slot(2), slot(4), slot(3), slot(1)], enemy: [slot(5), slot(4), slot(3), slot(2)], evidence: '照合済み',
  }] };
  const first = normalizeWeaponRosterAnalysis(raw, entries, weapons);
  const second = normalizeWeaponRosterAnalysis({ matches: first }, entries, weapons);
  assert.deepEqual(second, first);
});
