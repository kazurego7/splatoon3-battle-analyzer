import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeDeathSequencesWithCodex, analyzeDeathsWithCodex, createCodexExitError, normalizeCodexAnalysis, normalizeCodexPatterns, recoverLegacySequenceOutput } from '../src/codex-death-analysis.mjs';

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
      { id: 'retreat', title: '退路不足', summary: '同じ流れ', deathIds: ['death-1', 'death-2'], trigger: '前進', repeatedAction: '深追い', consequence: '孤立', reviewFocus: '引き返せた地点', clips: [
        { deathId: 'death-1', startOffset: -8, endOffset: 1, label: '1回目', reason: '前進からデスまで' },
        { deathId: 'death-2', startOffset: -6, endOffset: 1, label: '2回目', reason: '同じ前進を確認' },
      ] },
      { id: 'single', title: '単発', summary: '一度だけ', deathIds: ['death-1'], trigger: '前進', repeatedAction: '深追い', consequence: '孤立', reviewFocus: '地点' },
      { id: 'unknown', title: '根拠外', summary: '不正', deathIds: ['death-1', 'other'], trigger: '前進', repeatedAction: '深追い', consequence: '孤立', reviewFocus: '地点' },
    ],
  }, new Set(['death-1', 'death-2']));
  assert.equal(analysis.overallSummary, '前進後に退路を失う傾向。');
  assert.deepEqual(analysis.patterns.map(pattern => pattern.id), ['retreat']);
  assert.deepEqual(analysis.patterns[0].clips.map(clip => clip.deathId), ['death-1', 'death-2']);
});

test('rejects a repeated pattern when its clip ranges do not cover every death', () => {
  const analysis = normalizeCodexPatterns({ overallSummary: '要約', patterns: [{
    id: 'partial', title: '不完全', summary: '範囲不足', deathIds: ['death-1', 'death-2'],
    trigger: '前進', repeatedAction: '深追い', consequence: '孤立', reviewFocus: '地点',
    clips: [{ deathId: 'death-1', startOffset: -8, endOffset: 1, label: '1回目', reason: '片方だけ' }],
  }] }, new Set(['death-1', 'death-2']));
  assert.deepEqual(analysis.patterns, []);
});

test('does not generate AI analysis unless explicitly enabled or forced', async () => {
  const deaths = [{ id: 'death-1', time: 10, title: 'ローカル説明' }];
  const result = await analyzeDeathsWithCodex({ clipPath: 'unused.mp4', deaths, workDir: 'unused', matchNumber: 1 });
  const sequenceResult = await analyzeDeathSequencesWithCodex({ clipPath: 'unused.mp4', deaths, workDir: 'unused', matchNumber: 1 });
  assert.equal(result, deaths);
  assert.equal(sequenceResult.deaths, deaths);
  assert.equal(sequenceResult.analysis, null);
});

test('recovers completed legacy batches so a retry only analyzes missing deaths', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-death-progress-'));
  const clipPath = path.join(directory, 'match.mp4');
  try {
    await fs.writeFile(clipPath, 'clip');
    await new Promise(resolve => setTimeout(resolve, 20));
    await fs.writeFile(path.join(directory, 'sequence-result-1.json'), JSON.stringify({
      deaths: [sequenceDeath('death-1'), sequenceDeath('death-2')],
    }));
    const recovered = await recoverLegacySequenceOutput(
      clipPath, directory, new Set(['death-1', 'death-2', 'death-3']), false,
    );
    assert.deepEqual(recovered.map(item => item.id), ['death-1', 'death-2']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('classifies Codex JSONL errors from the CLI response', () => {
  const version = createCodexExitError(1, JSON.stringify({ type: 'error', message: "The 'gpt-6-astra' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again." }), 'HTTP 401 Unauthorized');
  assert.equal(version.code, 'CODEX_VERSION');
  const limit = createCodexExitError(1, '{"type":"error","error":{"message":"Usage limit reached"}}', '');
  const network = createCodexExitError(1, '', 'connection reset by peer');
  const auth = createCodexExitError(1, '', 'Not logged in');
  assert.equal(limit.code, 'CODEX_LIMIT');
  assert.equal(limit.codexDetail, 'Usage limit reached');
  assert.equal(network.code, 'CODEX_NETWORK');
  assert.equal(auth.code, 'CODEX_AUTH');
});

test('analyzes all deaths in one run, publishes the death list, then builds the report', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-death-stages-'));
  const clipPath = path.join(directory, 'match.mp4');
  const order = [];
  const deaths = [{ id: 'death-1', time: 10 }, { id: 'death-2', time: 20 }];
  try {
    await fs.writeFile(clipPath, 'clip');
    const result = await analyzeDeathSequencesWithCodex({
      clipPath, deaths, workDir: directory, matchNumber: 1, force: true, refresh: true, required: true,
      services: {
        codexAvailable: async () => true,
        prepareWorkspace: async () => directory,
        analyzeSequences: async options => {
          order.push(`sequences:${options.deaths.length}`);
          return options.deaths.map(death => sequenceDeath(death.id));
        },
        analyzePatterns: async () => {
          order.push('report');
          return { overallSummary: '試合全体の要約', patterns: [] };
        },
      },
      onSequences: async stage => {
        order.push(`published:${stage.deaths.length}`);
        assert.equal(stage.deaths.every(death => Array.isArray(death.sequence)), true);
      },
    });
    assert.deepEqual(order, ['sequences:2', 'published:2', 'report']);
    assert.equal(result.analysis.overallSummary, '試合全体の要約');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
