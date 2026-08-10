import fs from 'node:fs/promises';
import path from 'node:path';
import { ANALYSIS_ROOT, WORK_ROOT } from '../../src/paths.mjs';
import { analyzeRecordingStages } from '../../src/stage-analysis.mjs';
import { Store } from '../../src/store.mjs';

const recordingId = process.argv[2];
if (!recordingId) throw new Error('録画IDを指定してください');
const workDir = path.join(WORK_ROOT, recordingId);
const manifest = JSON.parse(await fs.readFile(path.join(workDir, 'manifest.json'), 'utf8'));
const analysisDir = path.join(ANALYSIS_ROOT, recordingId);
const files = (await fs.readdir(analysisDir)).filter(file => /^match-\d+\.json$/.test(file)).sort();
const analyses = await Promise.all(files.map(async file => ({
  file,
  value: JSON.parse(await fs.readFile(path.join(analysisDir, file), 'utf8')),
})));
const resultTimes = analyses.map(({ value }) => Number.isFinite(value.validation?.deaths?.resultTime)
  ? value.source.start + value.validation.deaths.resultTime
  : null);
const results = await analyzeRecordingStages({
  source: manifest.source,
  segments: manifest.segments,
  resultTimes,
  workDir,
});
const byId = new Map(results.filter(result => result.confidence >= 0.65).map(result => [result.id, result]));
for (let index = 0; index < analyses.length; index += 1) {
  const analysis = analyses[index].value;
  const result = byId.get(`match-${String(index + 1).padStart(2, '0')}`);
  if (!result) continue;
  analysis.stageMap = {
    ...(analysis.stageMap || {}),
    imageUrl: `/assets/stage-maps/${encodeURIComponent(result.stageAsset)}`,
    source: result.source,
    confidence: result.confidence,
    stage: result.stage,
    rule: result.rule,
    evidence: result.evidence,
    coordinateSpace: analysis.stageMap?.coordinateSpace || { width: 1000, height: 1000 },
  };
  analysis.capabilities ||= {};
  analysis.capabilities.stageMap = 'automatic-result-header-stage-and-rule';
  await fs.writeFile(path.join(analysisDir, analyses[index].file), `${JSON.stringify(analysis, null, 2)}\n`);
}
const store = new Store();
await store.load();
await store.patch(recordingId, {
  status: 'ready',
  phase: '分析済み',
  progress: 1,
  completedAt: new Date().toISOString(),
});
console.log(JSON.stringify({ recordingId, matches: files.length, updated: byId.size }, null, 2));
