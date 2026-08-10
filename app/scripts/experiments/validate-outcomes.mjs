import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeOutcomeLocally } from '../../src/outcome-analysis.mjs';

const source = process.argv[2];
const manifestPath = process.argv[3];
if (!source || !manifestPath) {
  console.error('Usage: node scripts/experiments/validate-outcomes.mjs <recording.mp4> <manifest.json>');
  process.exit(2);
}

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const observations = JSON.parse(await fs.readFile(path.join(appRoot, 'config', 'outcome-validation-observations.json'), 'utf8'));
const recording = observations.recordings.find(item => item.recording === path.basename(source));
if (!recording) throw new Error(`${path.basename(source)} の正解データがありません`);
const manifest = JSON.parse(await fs.readFile(path.resolve(manifestPath), 'utf8'));
let passed = 0;

for (const item of recording.matches) {
  const segment = manifest.segments[item.match - 1];
  if (!segment) throw new Error(`試合${item.match}の区間がありません`);
  const detected = await analyzeOutcomeLocally({
    source: path.resolve(source),
    matchStart: segment.start,
    activeEnd: segment.activeEnd,
    matchEnd: segment.end,
  });
  const ok = detected?.value === item.expected;
  if (ok) passed += 1;
  console.log(`試合${String(item.match).padStart(2, '0')}: expected=${item.expected} detected=${detected?.value || 'unknown'} observations=${detected?.observations || 0} ${ok ? 'OK' : 'NG'}`);
}

console.log(`${passed}/${recording.matches.length} matches passed`);
if (passed !== recording.matches.length) process.exit(1);
