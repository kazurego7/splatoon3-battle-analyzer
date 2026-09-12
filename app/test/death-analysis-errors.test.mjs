import test from 'node:test';
import assert from 'node:assert/strict';
import { deathAnalysisFailure } from '../src/death-analysis-errors.mjs';

test('gives an actionable response for every Codex failure category', () => {
  const cases = [
    ['CODEX_VERSION', /更新が必要/, /分析用Codexを更新/],
    ['CODEX_AUTH', /ログイン/, /ChatGPTアカウント/],
    ['CODEX_LIMIT', /利用上限/, /利用上限が回復/],
    ['CODEX_NETWORK', /通信エラー/, /インターネット接続/],
    ['CODEX_INVALID_OUTPUT', /正しく読み取れません/, /Codexを更新/],
    ['CODEX_LAUNCH', /起動できません/, /アプリを再起動/],
  ];
  for (const [code, errorPattern, guidancePattern] of cases) {
    const failure = deathAnalysisFailure({ code });
    assert.match(failure.error, errorPattern);
    assert.match(failure.guidance, guidancePattern);
    assert.equal(failure.retryable, true);
  }
});

test('preserves a concise Codex error detail for an unclassified response', () => {
  const failure = deathAnalysisFailure({ code: 'CODEX_EXIT', codexDetail: 'service unavailable' });
  assert.match(failure.error, /service unavailable/);
  assert.match(failure.guidance, /完成済みの結果/);
});
