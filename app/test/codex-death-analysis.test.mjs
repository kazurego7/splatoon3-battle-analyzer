import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDeathsWithCodex, normalizeCodexAnalysis } from '../src/codex-death-analysis.mjs';

test('accepts only complete expected Codex death analyses and removes duplicates', () => {
  const analyses = normalizeCodexAnalysis({
    deaths: [
      { id: 'death-1', title: '  正面から倒された  ', situation: '交戦中', cause: '被弾した' },
      { id: 'death-1', title: '重複', situation: '重複', cause: '重複' },
      { id: 'death-2', title: '', situation: '不完全', cause: '不完全' },
      { id: 'unknown', title: '対象外', situation: '対象外', cause: '対象外' },
    ],
  }, new Set(['death-1', 'death-2']));

  assert.deepEqual(analyses, [{ id: 'death-1', title: '正面から倒された', situation: '交戦中', cause: '被弾した' }]);
});

test('does not generate AI explanations unless explicitly enabled', async () => {
  const deaths = [{ id: 'death-1', time: 10, title: 'ローカル説明' }];
  const result = await analyzeDeathsWithCodex({
    clipPath: '存在しなくても参照されない.mp4',
    deaths,
    workDir: '存在しなくても参照されない',
    matchNumber: 1,
  });
  assert.equal(result, deaths);
  assert.equal(result[0].analysisSource, undefined);
});
