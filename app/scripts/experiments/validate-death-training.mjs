import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachRespawnEvidence } from '../../src/analysis-overrides.mjs';
import { detectGameplayStart, detectSelfDeaths } from '../../src/battle-analysis.mjs';
import { WORK_ROOT } from '../../src/paths.mjs';
import { detectRespawnRuns } from '../../src/respawn-vision.mjs';
import { chooseDeathCandidateSet, reconcileDeathsWithResult } from '../../src/result-analysis.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(here, '../../test/fixtures/death-detection-training.json');
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
if (fixture.purpose !== 'evaluation-only' || fixture.applyToApplicationData !== false) {
  throw new Error('教師データは評価専用でなければなりません');
}

const results = [];
for (const expected of fixture.matches) {
  const suffix = String(expected.match).padStart(2, '0');
  const recordingWork = path.join(WORK_ROOT, expected.recordingId);
  const battleCache = JSON.parse(await fs.readFile(path.join(recordingWork, `battle-hud-match-${suffix}.json`), 'utf8'));
  const respawnCache = JSON.parse(await fs.readFile(path.join(recordingWork, `respawn-hud-match-${suffix}.json`), 'utf8'));
  const samples = battleCache.samples;
  const gameplayEnd = samples.at(-1).time;
  const gameplayStart = detectGameplayStart(samples, { gameplayEnd });
  const respawns = detectRespawnRuns(respawnCache.samples, { gameplayStart, gameplayEnd });
  const options = samples[0].team.map((_, slot) => {
    const selfHud = samples.map(sample => ({ time: sample.time, ...sample.team[slot] }));
    const hudDeaths = detectSelfDeaths(selfHud, { duration: gameplayEnd, gameplayStart, gameplayEnd });
    return { slot, deaths: attachRespawnEvidence(hudDeaths, respawns) };
  });
  const selected = chooseDeathCandidateSet(options, expected.deaths);
  const observed = reconcileDeathsWithResult(selected?.deaths || [], expected.deaths);
  const errors = observed.map((death, index) => Number(Math.abs(death.time - expected.deathTimes[index]).toFixed(2)));
  const passed = observed.length === expected.deaths
    && errors.every(error => error <= fixture.timestampToleranceSeconds);
  results.push({
    recordingId: expected.recordingId,
    match: expected.match,
    selectedHudSlot: selected?.slot ?? null,
    expected: expected.deathTimes,
    observed: observed.map(death => death.time),
    errors,
    passed,
  });
}

const errors = results.flatMap(result => result.errors);
const summary = {
  purpose: fixture.purpose,
  matchesPassed: results.filter(result => result.passed).length,
  matchesTotal: results.length,
  deathsWithinTolerance: errors.filter(error => error <= fixture.timestampToleranceSeconds).length,
  deathsTotal: fixture.matches.reduce((sum, match) => sum + match.deaths, 0),
  meanAbsoluteErrorSeconds: Number((errors.reduce((sum, error) => sum + error, 0) / Math.max(1, errors.length)).toFixed(3)),
  timestampToleranceSeconds: fixture.timestampToleranceSeconds,
};
console.log(JSON.stringify({ summary, results }, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
