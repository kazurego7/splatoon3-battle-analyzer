import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStageAnalysis } from '../src/stage-analysis.mjs';

const catalog = {
  assets: new Map([
    ['ナメロウ金属\u0000アサリ', 'ナメロウ金属_アサリ.webp'],
    ['タカアシ経済特区\u0000エリア', 'タカアシ経済特区_エリア.webp'],
  ]),
};

test('accepts exact closed-set stage and rule labels and maps the asset', () => {
  const result = normalizeStageAnalysis({ matches: [{
    id: 'match-01', stage: 'ナメロウ金属', rule: 'アサリ', confidence: 0.97, evidence: '見出し',
  }] }, new Set(['match-01']), catalog);
  assert.deepEqual(result, [{
    id: 'match-01',
    stage: 'ナメロウ金属',
    rule: 'アサリ',
    stageAsset: 'ナメロウ金属_アサリ.webp',
    confidence: 0.97,
    evidence: '見出し',
    source: 'match-intro-codex-vision',
  }]);
});

test('rejects hallucinated labels, duplicates, and unexpected ids', () => {
  const result = normalizeStageAnalysis({ matches: [
    { id: 'match-01', stage: '存在しないステージ', rule: 'アサリ', confidence: 1, evidence: '' },
    { id: 'match-02', stage: 'ナメロウ金属', rule: 'アサリ', confidence: 1, evidence: '' },
  ] }, new Set(['match-01']), catalog);
  assert.deepEqual(result, []);
});
