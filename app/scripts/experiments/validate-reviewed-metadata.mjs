import fs from 'node:fs/promises';
import path from 'node:path';
import { ANALYSIS_ROOT, STATE_FILE } from '../../src/paths.mjs';

const fixturePath = new URL('../../test/fixtures/human-reviewed-metadata.json', import.meta.url);
const expected = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const state = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
const checks = [];

for (const recording of state.recordings || []) {
  for (const match of recording.matches || []) {
    if (!match.analysisUrl) continue;
    const analysis = JSON.parse(await fs.readFile(
      path.join(ANALYSIS_ROOT, recording.id, path.basename(match.analysisUrl)), 'utf8',
    ));
    checks.push({
      recording: recording.fileName,
      match: match.number,
      field: 'selfWeapon',
      expected: expected.expectedSelfWeapon,
      actual: analysis.playerIdentity?.weapon?.name || null,
    });
    const reviewed = expected.recordings?.[recording.fileName]?.[match.number];
    for (const field of ['outcome', 'rule', 'stage']) {
      if (!Object.hasOwn(reviewed || {}, field)) continue;
      const actual = field === 'outcome' ? analysis.outcome?.value : analysis.stageMap?.[field];
      checks.push({ recording: recording.fileName, match: match.number, field, expected: reviewed[field], actual: actual || null });
    }
  }
}

const unavailable = checks.filter(check => check.actual == null);
const evaluated = checks.filter(check => check.actual != null);
const failures = evaluated.filter(check => check.actual !== check.expected);
console.log(JSON.stringify({
  passed: evaluated.length - failures.length,
  evaluated: evaluated.length,
  expected: checks.length,
  unavailable: unavailable.length,
  unavailableChecks: unavailable,
  failures,
}, null, 2));
if (failures.length) process.exitCode = 1;
