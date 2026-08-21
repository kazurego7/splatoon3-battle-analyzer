import fs from 'node:fs/promises';
import path from 'node:path';

const [baselineRoot, candidateRoot] = process.argv.slice(2).map(value => value && path.resolve(value));
if (!baselineRoot || !candidateRoot) {
  console.error('Usage: node scripts/experiments/validate-fresh-regression.mjs <baseline-data-root> <candidate-data-root>');
  process.exit(2);
}

const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const baselineState = await readJson(path.join(baselineRoot, 'app', 'state.json'));
const candidateState = await readJson(path.join(candidateRoot, 'app', 'state.json'));
const failures = [];
const improvements = [];
let matches = 0;

function accuracyFields(analysis) {
  return {
    playerStats: analysis.playerStats ? {
      kills: analysis.playerStats.kills,
      deaths: analysis.playerStats.deaths,
    } : null,
    playerIdentity: {
      status: analysis.playerIdentity?.status || null,
      weapon: analysis.playerIdentity?.weapon?.name || null,
    },
    outcome: analysis.outcome ? {
      value: analysis.outcome.value,
    } : null,
    stageMap: analysis.stageMap ? {
      stage: analysis.stageMap.stage,
      rule: analysis.stageMap.rule,
    } : null,
    validation: {
      outcome: analysis.validation?.outcome?.detected ?? null,
      expectedDeaths: analysis.validation?.deaths?.expected ?? null,
      observedDeaths: analysis.validation?.deaths?.observed ?? null,
      deathCountMatched: analysis.validation?.deaths?.matched ?? null,
    },
  };
}

for (const baselineRecording of baselineState.recordings) {
  const candidateRecording = candidateState.recordings.find(item => item.fileName === baselineRecording.fileName);
  if (!candidateRecording) {
    failures.push({ recording: baselineRecording.fileName, issue: '録画がありません' });
    continue;
  }
  if (candidateRecording.status !== 'ready' || candidateRecording.matches.length !== baselineRecording.matches.length) {
    failures.push({
      recording: baselineRecording.fileName,
      issue: 'ready状態または試合数が一致しません',
      expected: { status: baselineRecording.status, matches: baselineRecording.matches.length },
      actual: { status: candidateRecording.status, matches: candidateRecording.matches.length },
    });
    continue;
  }
  for (const baselineMatch of baselineRecording.matches) {
    matches += 1;
    const candidateMatch = candidateRecording.matches.find(item => item.number === baselineMatch.number);
    const analysisName = `match-${String(baselineMatch.number).padStart(2, '0')}.json`;
    const [baselineAnalysis, candidateAnalysis] = await Promise.all([
      readJson(path.join(baselineRoot, 'app', 'analysis', baselineRecording.id, analysisName)),
      readJson(path.join(candidateRoot, 'app', 'analysis', candidateRecording.id, analysisName)),
    ]);
    const expected = accuracyFields(baselineAnalysis);
    const actual = accuracyFields(candidateAnalysis);
    const issues = [];
    if (JSON.stringify(expected.playerStats) !== JSON.stringify(actual.playerStats)) issues.push('K/Dが一致しません');
    if (expected.playerIdentity.weapon !== actual.playerIdentity.weapon) issues.push('ブキが一致しません');
    if (expected.playerIdentity.status === 'confirmed' && actual.playerIdentity.status !== 'confirmed') {
      issues.push('本人識別が未確認へ低下しました');
    } else if (expected.playerIdentity.status !== 'confirmed' && actual.playerIdentity.status === 'confirmed') {
      improvements.push({ recording: baselineRecording.fileName, match: baselineMatch.number, component: 'playerIdentity' });
    }
    if (expected.outcome?.value && expected.outcome.value !== actual.outcome?.value) issues.push('勝敗が一致しません');
    else if (!expected.outcome?.value && actual.outcome?.value) {
      improvements.push({ recording: baselineRecording.fileName, match: baselineMatch.number, component: 'outcome' });
    }
    if (JSON.stringify(expected.stageMap) !== JSON.stringify(actual.stageMap)) issues.push('ステージまたはルールが一致しません');
    if (expected.validation.expectedDeaths !== actual.validation.expectedDeaths) issues.push('リザルト死亡数が一致しません');
    if (expected.validation.deathCountMatched === true && actual.validation.deathCountMatched !== true) {
      issues.push('死亡検出が一致状態から低下しました');
    } else if (expected.validation.deathCountMatched !== true && actual.validation.deathCountMatched === true) {
      improvements.push({ recording: baselineRecording.fileName, match: baselineMatch.number, component: 'deathCountMatched' });
    }
    if (issues.length) failures.push({ recording: baselineRecording.fileName, match: baselineMatch.number, issues });
  }
}

console.log(JSON.stringify({
  recordings: baselineState.recordings.length,
  matches,
  passed: matches - failures.length,
  improvements: improvements.length,
  failures,
}, null, 2));
if (failures.length) process.exitCode = 1;
