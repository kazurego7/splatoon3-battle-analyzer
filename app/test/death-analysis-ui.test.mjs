import test from 'node:test';
import assert from 'node:assert/strict';
import { deathAnalysisControlState, deathAnalysisEndpoint, deathReportDigest, deathSeekTime, matchAnalysisBadge } from '../public/death-analysis-ui.js';

test('death list keeps the existing eight-second pre-roll', () => {
  assert.equal(deathSeekTime({ time: 38.25 }), 30.25);
  assert.equal(deathSeekTime({ time: 3 }), 0);
});

test('death seek offsets stay within the video', () => {
  assert.equal(deathSeekTime({ time: 38.25 }, -2), 36.25);
  assert.equal(deathSeekTime({ time: 38.25 }, 1, 38.5), 38.5);
});

test('death analysis endpoint removes query parameters', () => {
  assert.equal(deathAnalysisEndpoint('/api/analysis/r1/match-01.json?x=1'), '/api/analysis/r1/match-01.json/ai-death-sequence');
});

test('match card distinguishes video processing from AI analysis', () => {
  assert.deepEqual(matchAnalysisBadge(), { label: '処理中', className: '' });
  assert.deepEqual(matchAnalysisBadge({ ready: true }), { label: '動画解析済み', className: 'video-ready' });
  assert.deepEqual(matchAnalysisBadge({ ready: true, analysis: { deathAnalysisState: { status: 'sequences' } } }), { label: 'AI分析中', className: 'ai-running' });
  assert.deepEqual(matchAnalysisBadge({ ready: true, analysis: { deathAnalysis: { patterns: [] } } }), { label: 'AI分析済み', className: 'ready ai-ready' });
});

test('death analysis controls restore a pending job and never offer reanalysis', () => {
  assert.deepEqual(deathAnalysisControlState({ deathCount: 7 }), {
    showAnalyze: true, analyzeDisabled: false, analyzeLabel: 'AI分析を実行する！', showReport: false, status: '', statusIsError: false,
  });
  assert.deepEqual(deathAnalysisControlState({ deathCount: 7, jobState: { status: 'sequences', phase: 'sequences', completedDeaths: 0, totalDeaths: 7 } }), {
    showAnalyze: true, analyzeDisabled: true, analyzeLabel: 'デス分析中…', showReport: false,
    status: 'AIがデス一覧を生成しています（0/7件完了）。完了後、そのままレポートを生成します…', statusIsError: false,
  });
  assert.deepEqual(deathAnalysisControlState({ deathCount: 7, jobState: { status: 'report', phase: 'report', completedDeaths: 7, totalDeaths: 7 } }), {
    showAnalyze: true, analyzeDisabled: true, analyzeLabel: 'レポート生成中…', showReport: false,
    status: 'デス一覧を反映しました。AIが俯瞰レポートを生成しています…', statusIsError: false,
  });
  assert.deepEqual(deathAnalysisControlState({ deathCount: 7, jobState: { status: 'error', phase: 'report', error: 'Codexエラー', guidance: '再開してください。' } }), {
    showAnalyze: true, analyzeDisabled: false, analyzeLabel: 'レポート生成を再開する', showReport: false,
    status: 'Codexエラー 再開してください。', statusIsError: true,
  });
  assert.equal(deathAnalysisControlState({ analysis: { patterns: [] }, deathCount: 7 }).showAnalyze, false);
  assert.equal(deathAnalysisControlState({ analysis: { patterns: [] }, deathCount: 7 }).showReport, true);
});

test('report digest presents at most two concise failure patterns', () => {
  const digest = deathReportDigest({ deathAnalysis: { patterns: [
    { title: '退路不足', summary: '敵インクへ出て戻れなくなる' },
    { title: '人数不利で前進', summary: '味方の復帰を待たずに接敵する。' },
    { title: '表示しない3件目', summary: '長すぎる' },
  ] } });
  assert.equal(digest, '「退路不足」：敵インクへ出て戻れなくなる。 「人数不利で前進」：味方の復帰を待たずに接敵する。');
  assert.equal(deathReportDigest({ deathAnalysis: { patterns: [{ title: '単独パターン', summary: '一文目。二文目。三文目。' }] } }), '「単独パターン」：一文目。二文目。');
  assert.equal(deathReportDigest({ deathAnalysis: { patterns: [] } }), 'この試合では、2回以上繰り返した失敗パターンは見つかりませんでした。');
  assert.match(deathReportDigest({}), /デス前後の映像を比較/);
});
