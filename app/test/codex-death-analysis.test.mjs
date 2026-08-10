import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDeathSequencesWithCodex, analyzeDeathsWithCodex, normalizeCodexAnalysis, normalizeCodexPatterns } from '../src/codex-death-analysis.mjs';

function sequenceDeath(id, overrides = {}) {
  return {
    id, title: '  正面から倒された  ', situation: '交戦中', cause: '被弾した',
    sequence: [
      { offset: -8, phase: 'setup', observation: '中央へ移動', interpretation: '交戦準備' },
      { offset: -4, phase: 'approach', observation: '敵色へ接近', interpretation: '距離を詰めた' },
      { offset: -2, phase: 'danger', observation: '被弾', interpretation: '退路が狭まった' },
      { offset: -0.5, phase: 'death', observation: '画面が暗転', interpretation: 'デス直前' },
    ],
    turningPoint: { offset: -4, action: '敵色へ接近した', whyItMattered: '安全な退路を失った' },
    patternTags: ['退路不足'], ...overrides,
  };
}

test('accepts only complete expected Codex sequences and removes duplicates', () => {
  const analyses = normalizeCodexAnalysis({ deaths: [
    sequenceDeath('death-1'), sequenceDeath('death-1', { title: '重複' }),
    sequenceDeath('death-2', { sequence: [] }), sequenceDeath('unknown'),
  ] }, new Set(['death-1', 'death-2']));

  assert.equal(analyses.length, 1);
  assert.equal(analyses[0].id, 'death-1');
  assert.equal(analyses[0].title, '正面から倒された');
  assert.deepEqual(analyses[0].sequence.map(step => step.offset), [-8, -4, -2, -0.5]);
});

test('keeps only repeated patterns backed by two expected deaths', () => {
  const analysis = normalizeCodexPatterns({
    overallSummary: '前進後に退路を失う傾向。',
    patterns: [
      { id: 'retreat', title: '退路不足', summary: '同じ流れ', deathIds: ['death-1', 'death-2'], trigger: '前進', repeatedAction: '深追い', consequence: '孤立', reviewFocus: '引き返せた地点' },
      { id: 'single', title: '単発', summary: '一度だけ', deathIds: ['death-1'], trigger: '前進', repeatedAction: '深追い', consequence: '孤立', reviewFocus: '地点' },
      { id: 'unknown', title: '根拠外', summary: '不正', deathIds: ['death-1', 'other'], trigger: '前進', repeatedAction: '深追い', consequence: '孤立', reviewFocus: '地点' },
    ],
  }, new Set(['death-1', 'death-2']));
  assert.equal(analysis.overallSummary, '前進後に退路を失う傾向。');
  assert.deepEqual(analysis.patterns.map(pattern => pattern.id), ['retreat']);
});

test('does not generate AI analysis unless explicitly enabled or forced', async () => {
  const deaths = [{ id: 'death-1', time: 10, title: 'ローカル説明' }];
  const result = await analyzeDeathsWithCodex({ clipPath: 'unused.mp4', deaths, workDir: 'unused', matchNumber: 1 });
  const sequenceResult = await analyzeDeathSequencesWithCodex({ clipPath: 'unused.mp4', deaths, workDir: 'unused', matchNumber: 1 });
  assert.equal(result, deaths);
  assert.equal(sequenceResult.deaths, deaths);
  assert.equal(sequenceResult.analysis, null);
});
