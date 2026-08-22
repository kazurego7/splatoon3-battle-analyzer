import fs from 'node:fs/promises';
import path from 'node:path';
import { ANALYSIS_ROOT, MATCH_ROOT, STATE_FILE, WORK_ROOT } from '../../src/paths.mjs';
import { analyzeRecordingWeaponRosters } from '../../src/weapon-roster-analysis.mjs';

async function readAnalysis(recording, match) {
  const number = String(match.number).padStart(2, '0');
  const file = path.join(ANALYSIS_ROOT, recording.id, `match-${number}.json`);
  return { file, value: JSON.parse(await fs.readFile(file, 'utf8')) };
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, file);
}

const query = process.argv.slice(2).join(' ').trim();
const timeOffset = Math.max(0, Number.parseInt(process.env.WEAPON_ROSTER_TIME_OFFSET || '0', 10) || 0);
const state = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
const recordings = (state.recordings || []).filter(recording => !query || recording.id === query || recording.fileName === query);
if (!recordings.length) throw new Error('対象の録画が見つかりません');

let completed = 0;
let remaining = 0;
const errors = [];
for (const recording of recordings) {
  const analyses = new Map();
  for (const match of recording.matches || []) analyses.set(match.number, await readAnalysis(recording, match));
  const missing = (recording.matches || []).filter(match => analyses.get(match.number).value.weaponRoster?.complete !== true);
  if (!missing.length) continue;
  console.log(`${recording.fileName}: 未取得 ${missing.length}試合を自動照合中`);
  for (const match of missing) {
    const id = `match-${String(match.number).padStart(2, '0')}`;
    let results;
    try {
      results = await analyzeRecordingWeaponRosters({
        matches: [match],
        clipRoot: path.join(MATCH_ROOT, recording.id),
        workDir: path.join(WORK_ROOT, recording.id),
        expectedWeapons: new Map([[id, analyses.get(match.number).value.playerIdentity?.weapon?.name || null]]),
        force: true,
        timeOffset,
      });
    } catch (error) {
      remaining += 1;
      errors.push({ recording: recording.fileName, match: match.number, code: error.code || null, message: error.message });
      console.error(`  ${id}: 自動照合を継続できません: ${error.message}`);
      continue;
    }
    const result = results.get(id);
    if (!result?.complete) {
      remaining += 1;
      console.log(`  ${id}: 完全一致に至らず`);
      continue;
    }
    const analysis = analyses.get(match.number);
    analysis.value.weaponRoster = result;
    analysis.value.capabilities ||= {};
    analysis.value.capabilities.weaponRoster = 'opening-battle-hud-two-frame-validated';
    analysis.value.generatedAt = new Date().toISOString();
    await writeJsonAtomic(analysis.file, analysis.value);
    completed += 1;
    console.log(`  ${id}: 味方3・敵4を取得`);
  }
}

console.log(JSON.stringify({ completed, remaining, errors }, null, 2));
if (remaining || errors.length) process.exitCode = 2;
