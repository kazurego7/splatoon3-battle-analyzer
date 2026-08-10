import fs from 'node:fs/promises';
import path from 'node:path';

const configPath = path.resolve(process.argv[2] || 'config/game-penalty-validation-observations.json');
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const analysisRoot = path.resolve(path.dirname(configPath), config.analysisRoot);
const workRoot = path.resolve(path.dirname(configPath), config.workRoot);
const mismatches = [];
const shortReturns = [];
const mapChanges = [];
let labels = 0;

for (const match of config.matches || []) {
  const number = String(match.number).padStart(2, '0');
  const analysis = JSON.parse(await fs.readFile(path.join(analysisRoot, `match-${number}.json`), 'utf8'));
  const timeline = analysis.gameFlow?.gameCounts || [];
  for (const [time, teamPenalty, enemyPenalty] of match.observations || []) {
    const point = timeline.find(item => item.time === time);
    for (const [side, expected] of [['teamPenalty', teamPenalty], ['enemyPenalty', enemyPenalty]]) {
      if (expected == null) continue;
      labels += 1;
      if (point?.[side] !== expected) mismatches.push({ match: match.number, time, side, expected, actual: point?.[side] });
    }
  }
  for (const side of ['teamPenalty', 'enemyPenalty']) {
    const runs = [];
    let run = null;
    for (const point of timeline) {
      if (!run || run.value !== point[side]) {
        if (run) runs.push(run);
        run = { value: point[side], start: point.time, end: point.time };
      } else run.end = point.time;
    }
    if (run) runs.push(run);
    for (let index = 1; index < runs.length - 1; index += 1) {
      const runDuration = runs[index].end - runs[index].start;
      const maximumDuration = runs[index].value === 0 ? 4 : 1.5;
      if (runs[index - 1].value > 0 && runs[index + 1].value === runs[index - 1].value && runDuration <= maximumDuration) {
        shortReturns.push({ match: match.number, side, ...runs[index], surroundingValue: runs[index - 1].value });
      }
    }
  }
  const mapCache = JSON.parse(await fs.readFile(path.join(workRoot, `map-candidates-match-${number}.json`), 'utf8'));
  for (const time of mapCache.samples.filter(sample => sample.mapUi?.visible).map(sample => sample.time)) {
    const index = timeline.findIndex(point => point.time === time);
    if (index <= 0) continue;
    for (const side of ['teamPenalty', 'enemyPenalty']) {
      if (timeline[index][side] !== timeline[index - 1][side]) mapChanges.push({
        match: match.number,
        time,
        side,
        before: timeline[index - 1][side],
        after: timeline[index][side],
      });
    }
  }
}

const result = {
  labels,
  correct: labels - mismatches.length,
  accuracy: labels ? (labels - mismatches.length) / labels : 0,
  mismatches,
  shortReturns,
  mapChanges,
};
console.log(JSON.stringify(result, null, 2));
if (mismatches.length || shortReturns.length || mapChanges.length) process.exitCode = 1;
