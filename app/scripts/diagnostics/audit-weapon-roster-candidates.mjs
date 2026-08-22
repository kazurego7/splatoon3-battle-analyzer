import fs from 'node:fs/promises';
import path from 'node:path';
import { detectGameplayStart, isWeaponRosterVisible, openingRosterTimes } from '../../src/battle-analysis.mjs';
import { mapWithConcurrency } from '../../src/concurrency.mjs';
import { sampleBattleHud } from '../../src/ffmpeg.mjs';
import { ANALYSIS_ROOT, MATCH_ROOT, STATE_FILE } from '../../src/paths.mjs';

const OPENING_SECONDS = 35;
const query = process.argv.slice(2).join(' ').trim();
const state = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
const recordings = (state.recordings || []).filter(recording =>
  !query || recording.id === query || recording.fileName === query);
if (!recordings.length) throw new Error('対象の録画が見つかりません');

const rows = await mapWithConcurrency(recordings.flatMap(recording =>
  (recording.matches || []).map(match => ({ recording, match }))), 4, async ({ recording, match }) => {
  const id = `match-${String(match.number).padStart(2, '0')}`;
  const clip = path.join(MATCH_ROOT, recording.id, match.fileName);
  const duration = Math.min(Number(match.duration) || OPENING_SECONDS, OPENING_SECONDS);
  const samples = await sampleBattleHud(clip, duration, { maxDuration: duration });
  const gameplayStart = detectGameplayStart(samples, {
    earliest: 3,
    gameplayEnd: duration,
    requireRoster: true,
  });
  const times = openingRosterTimes(samples, {
    gameplayStart,
    gameplayEnd: duration,
    allowTimerFallback: true,
  });
  const selected = times.map(time => samples[Math.round(time / 0.25)]).filter(Boolean);
  const visible = selected.map(isWeaponRosterVisible);
  const saturated = selected.flatMap(sample => [...sample.team, ...sample.enemy]
    .map(icon => Number(icon.saturatedRatio)));
  let complete = false;
  try {
    const analysis = JSON.parse(await fs.readFile(path.join(ANALYSIS_ROOT, recording.id, `${id}.json`), 'utf8'));
    complete = analysis.weaponRoster?.complete === true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return {
    recordingId: recording.id,
    recording: recording.fileName,
    id,
    gameplayStart,
    times,
    candidateReady: times.length === 2 && visible.every(Boolean),
    minimumSaturatedRatio: saturated.length ? Number(Math.min(...saturated).toFixed(3)) : null,
    alreadyComplete: complete,
  };
});

const grouped = recordings.map(recording => {
  const matches = rows.filter(row => row.recordingId === recording.id);
  return {
    recordingId: recording.id,
    recording: recording.fileName,
    matches: matches.length,
    candidatesReady: matches.filter(row => row.candidateReady).length,
    alreadyComplete: matches.filter(row => row.alreadyComplete).length,
    failures: matches.filter(row => !row.candidateReady).map(row => row.id),
  };
});
console.log(JSON.stringify({
  totals: {
    recordings: grouped.length,
    matches: rows.length,
    candidatesReady: rows.filter(row => row.candidateReady).length,
    alreadyComplete: rows.filter(row => row.alreadyComplete).length,
  },
  recordings: grouped,
  matches: rows,
}, null, 2));
if (rows.some(row => !row.candidateReady)) process.exitCode = 2;
