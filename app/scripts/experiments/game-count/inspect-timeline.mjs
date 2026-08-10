import fs from 'node:fs/promises';
import path from 'node:path';
import { sampleGameCountFrames } from '../../../src/ffmpeg.mjs';
import { analyzeGameCountFrame, detectGameCounts } from '../../../src/game-count-vision.mjs';

const matchesRoot = path.resolve(process.argv[2] || '../data/matches/2026-08-08-15-20-32-69f2b9f4');
const outputRoot = path.resolve(process.argv[3] || '../data/work/count-ocr');
const durations = [382, 296, 280, 356];
const gameplayEnds = [342, 276, 268, 328];
const observations = [
  [[20,100,100],[30,91,100],[60,91,59],[120,68,55],[200,68,11]],
  [[20,100,100],[50,79,81],[90,47,68],[140,38,66],[200,38,24],[250,38,9]],
  [[20,100,100],[50,97,83],[90,79,67],[140,51,67],[200,51,30],[240,50,24]],
  [[20,100,100],[50,77,95],[90,65,65],[140,44,65],[220,2,48],[300,2,3]],
];
const report = [];
for (let index = 0; index < durations.length; index += 1) {
  const number = index + 1;
  const cache = path.join(outputRoot, `candidates-match-0${number}.json`);
  let samples;
  try {
    samples = JSON.parse(await fs.readFile(cache, 'utf8'));
  } catch {
    samples = await sampleGameCountFrames(path.join(matchesRoot, `match-0${number}.mp4`), durations[index], {
      onFrame: (frame, width, _height, time) => analyzeGameCountFrame(frame, width, time),
    });
    await fs.mkdir(outputRoot, { recursive: true });
    await fs.writeFile(cache, `${JSON.stringify(samples)}\n`);
  }
  const timeline = detectGameCounts(samples, { gameplayEnd: gameplayEnds[index] });
  const checks = observations[index].map(([time, team, enemy]) => {
    const state = timeline.find(item => item.time === time);
    return { time, expected: [team, enemy], actual: [state?.teamCount, state?.enemyCount], correct: state?.teamCount === team && state?.enemyCount === enemy };
  });
  const changes = timeline.filter((item, itemIndex) => !itemIndex || item.teamCount !== timeline[itemIndex - 1].teamCount || item.enemyCount !== timeline[itemIndex - 1].enemyCount);
  report.push({ match: number, checks, correct: checks.filter(item => item.correct).length, total: checks.length, observed: timeline.filter(item => item.teamSource === 'observed' || item.enemySource === 'observed').length, points: timeline.length, changes: changes.slice(0, 40) });
}
console.log(JSON.stringify(report, null, 2));
