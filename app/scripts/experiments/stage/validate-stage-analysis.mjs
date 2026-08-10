import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_ROOT, MATCH_ROOT, WORK_ROOT } from '../../../src/paths.mjs';
import { extractJpeg } from '../../../src/ffmpeg.mjs';
import { classifyStageResultImages } from '../../../src/stage-analysis.mjs';

const fixturePath = path.join(APP_ROOT, 'config', 'stage-map-validation.json');
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const workDir = path.join(WORK_ROOT, 'stage-validation');
const entries = [];
for (const match of fixture.matches) {
  if (!Number.isFinite(match.resultTime)) continue;
  const matchName = `match-${String(match.match).padStart(2, '0')}`;
  const id = `${match.recordingId}-${matchName}`;
  const imagePath = path.join(workDir, `${id}.jpg`);
  const videoPath = path.join(MATCH_ROOT, match.recordingId, `${matchName}.mp4`);
  await extractJpeg(videoPath, match.resultTime, imagePath, 960);
  entries.push({ id, time: match.resultTime, imagePath });
}

const cacheKey = `reviewed-stage-map-validation-v${fixture.version}`;
const predictions = await classifyStageResultImages(entries, { workDir, cacheKey });
const byId = new Map(predictions
  .filter(prediction => prediction.confidence >= 0.65)
  .map(prediction => [prediction.id, prediction]));
let stageCorrect = 0;
let ruleCorrect = 0;
let jointCorrect = 0;
const failures = [];
for (const expected of fixture.matches) {
  const id = `${expected.recordingId}-match-${String(expected.match).padStart(2, '0')}`;
  const actual = byId.get(id);
  const stageMatches = actual?.stage === expected.stage;
  const ruleMatches = actual?.rule === expected.rule;
  if (stageMatches) stageCorrect += 1;
  if (ruleMatches) ruleCorrect += 1;
  if (stageMatches && ruleMatches) jointCorrect += 1;
  else failures.push({ id, expected: `${expected.rule}/${expected.stage}`, actual: actual ? `${actual.rule}/${actual.stage}` : '判定不能' });
}
const total = fixture.matches.length;
const accuracy = jointCorrect / total;
console.log(JSON.stringify({
  total,
  accepted: byId.size,
  stageAccuracy: Number((stageCorrect / total).toFixed(4)),
  ruleAccuracy: Number((ruleCorrect / total).toFixed(4)),
  jointAccuracy: Number(accuracy.toFixed(4)),
  minimumAccuracy: fixture.minimumAccuracy,
  passed: accuracy >= fixture.minimumAccuracy,
  failures,
}, null, 2));
if (accuracy < fixture.minimumAccuracy) process.exitCode = 1;
