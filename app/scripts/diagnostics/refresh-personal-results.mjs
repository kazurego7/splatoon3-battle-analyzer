import fs from 'node:fs/promises';
import path from 'node:path';
import { ANALYSIS_ROOT, MATCH_ROOT, STATE_FILE, WORK_ROOT } from '../../src/paths.mjs';
import { loadStageCatalog } from '../../src/stage-analysis.mjs';
import { weaponCatalogEntries, weaponCatalogMetadata } from '../../src/weapon-analysis.mjs';
import { analyzeRecordingPersonalResults } from '../../src/personal-result-analysis.mjs';
import { refineResultBoundaries, resultBoundaryModelVersion } from '../../src/result-boundary.mjs';

const requestedFile = process.argv.slice(2).join(' ').trim();
const state = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
const recordings = (state.recordings || []).filter(recording => !requestedFile || recording.fileName === requestedFile);
if (!recordings.length) throw new Error('対象の録画が見つかりません');

const stageCatalog = await loadStageCatalog();
const weaponsByName = new Map(weaponCatalogEntries().map(item => [item.name, item]));
let updated = 0;
for (const recording of recordings) {
  const cachePath = path.join(WORK_ROOT, recording.id, 'personal-results', 'analysis-cache.json');
  const boundaryPath = path.join(WORK_ROOT, recording.id, 'result-boundaries.json');
  let boundaryCache = JSON.parse(await fs.readFile(boundaryPath, 'utf8'));
  let cached;
  try {
    cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (boundaryCache.version !== resultBoundaryModelVersion) {
      boundaryCache.segments = await refineResultBoundaries(
        recording.source,
        boundaryCache.segments,
        recording.media?.duration,
      );
      boundaryCache.version = resultBoundaryModelVersion;
      await fs.writeFile(boundaryPath, `${JSON.stringify(boundaryCache, null, 2)}\n`);
    }
    const matches = await analyzeRecordingPersonalResults({
      source: recording.source,
      segments: boundaryCache.segments,
      workDir: path.join(WORK_ROOT, recording.id),
    });
    cached = { matches };
    if (!matches.length) continue;
  }
  const results = new Map((cached.matches || []).map(result => [result.id, result]));
  const weaponCounts = new Map();
  for (const result of results.values()) weaponCounts.set(result.weapon, (weaponCounts.get(result.weapon) || 0) + 1);
  const rankedWeapons = [...weaponCounts.entries()].sort((left, right) => right[1] - left[1]);
  const recordingWeapon = rankedWeapons[0]?.[1] >= 2 && rankedWeapons[0][1] > (rankedWeapons[1]?.[1] || 0)
    ? { name: rankedWeapons[0][0], observations: rankedWeapons[0][1] }
    : null;
  for (const match of recording.matches || []) {
    const result = results.get(`match-${String(match.number).padStart(2, '0')}`);
    const segment = boundaryCache.segments?.[match.number - 1];
    if (segment) {
      match.start = segment.start;
      match.end = segment.end;
      match.duration = Number((segment.end - segment.start).toFixed(2));
    }
    delete match.fileName; delete match.videoUrl;
    match.sourceVideoUrl = `/media/recordings/${encodeURIComponent(recording.id)}/source.mp4`; match.sourceVideoStart = match.start;
    const analysisPath = path.join(ANALYSIS_ROOT, recording.id, `match-${String(match.number).padStart(2, '0')}.json`);
    const analysis = JSON.parse(await fs.readFile(analysisPath, 'utf8'));
    if (!result) {
      const consensusWeapon = recordingWeapon ? weaponsByName.get(recordingWeapon.name) : null;
      if (consensusWeapon) {
        analysis.playerIdentity ||= {};
        analysis.playerIdentity.weapon = {
          id: consensusWeapon.id,
          name: consensusWeapon.name,
          status: 'confirmed-by-recording-personal-results',
          confidence: 0.9,
          source: 'personal-result-recording-consensus',
          catalogVersion: weaponCatalogMetadata.version,
          observations: recordingWeapon.observations,
        };
        analysis.capabilities ||= {};
        analysis.capabilities.playerWeapon = 'confirmed-by-recording-personal-results';
        analysis.source ||= {};
        analysis.source.start = match.start;
        analysis.source.end = match.end;
        analysis.media ||= {};
        analysis.media.duration = match.duration;
        await fs.writeFile(analysisPath, `${JSON.stringify(analysis, null, 2)}\n`);
        match.status = 'ready';
        match.analysisUrl = `/api/analysis/${encodeURIComponent(recording.id)}/match-${String(match.number).padStart(2, '0')}.json`;
        match.videoUrl = `/media/matches/${encodeURIComponent(recording.id)}/${encodeURIComponent(match.fileName)}`;
        match.thumbnailUrl ||= `/media/thumbnails/${encodeURIComponent(recording.id)}/match-${String(match.number).padStart(2, '0')}.jpg`;
        match.eventCount = Array.isArray(analysis.events) ? analysis.events.length : 0;
        updated += 1;
      }
      continue;
    }
    const weapon = weaponsByName.get(result.weapon);
    const detectedAt = boundaryCache.segments?.[match.number - 1]?.resultBoundary?.detectedAt;
    const resultTime = Number.isFinite(detectedAt) ? Number((detectedAt - match.start).toFixed(2)) : null;
    analysis.playerStats = {
      kills: result.kills,
      deaths: result.deaths,
      source: result.source,
      confidence: result.confidence,
    };
    analysis.playerIdentity = {
      status: 'unconfirmed',
      method: 'personal-result-metadata-only',
      hudSlot: null,
      confidence: 0,
      resultTime,
      scores: [],
      weapon: weapon ? {
      id: weapon.id,
      name: weapon.name,
      status: 'identified-from-personal-result',
      confidence: result.confidence,
      source: result.source,
      catalogVersion: weaponCatalogMetadata.version,
      observations: 1,
      } : null,
    };
    analysis.stageMap = {
      ...(analysis.stageMap || {}),
      stage: result.stage,
      rule: result.rule,
      stageAsset: stageCatalog.assets.get(`${result.stage}\u0000${result.rule}`) || analysis.stageMap?.stageAsset || null,
      confidence: result.confidence,
      evidence: result.evidence,
      source: result.source,
    };
    analysis.validation ||= {};
    analysis.validation.deaths = {
      ...(analysis.validation.deaths || {}),
      expected: result.deaths,
      source: result.source,
      resultTime,
      matched: Array.isArray(analysis.events)
        ? analysis.events.filter(event => event.type === 'death').length === result.deaths
        : null,
    };
    analysis.capabilities ||= {};
    analysis.capabilities.playerWeapon = 'identified-from-personal-result';
    analysis.capabilities.stageMap = 'automatic-personal-result-stage-and-rule';
    analysis.generatedAt = new Date().toISOString();
    analysis.source ||= {};
    analysis.source.start = match.start;
    analysis.source.end = match.end;
    analysis.media ||= {};
    analysis.media.duration = match.duration;
    await fs.writeFile(analysisPath, `${JSON.stringify(analysis, null, 2)}\n`);
    match.status = 'ready';
    match.analysisUrl = `/api/analysis/${encodeURIComponent(recording.id)}/match-${String(match.number).padStart(2, '0')}.json`;
    match.videoUrl = `/media/matches/${encodeURIComponent(recording.id)}/${encodeURIComponent(match.fileName)}`;
    match.thumbnailUrl ||= `/media/thumbnails/${encodeURIComponent(recording.id)}/match-${String(match.number).padStart(2, '0')}.jpg`;
    match.eventCount = Array.isArray(analysis.events) ? analysis.events.length : 0;
    updated += 1;
  }
  recording.status = 'ready';
  recording.phase = '分析済み';
  recording.progress = 1;
  recording.error = null;
  recording.updatedAt = new Date().toISOString();
  recording.completedAt = recording.updatedAt;
}
await fs.writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
console.log(JSON.stringify({ updated, recordings: recordings.map(recording => recording.fileName) }, null, 2));
