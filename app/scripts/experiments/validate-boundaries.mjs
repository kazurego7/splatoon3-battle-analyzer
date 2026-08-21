import fs from 'node:fs/promises';
import path from 'node:path';
import { MATCH_ROOT, STATE_FILE, WORK_ROOT } from '../../src/paths.mjs';
import { extractRgbFrame, probeMedia } from '../../src/ffmpeg.mjs';
import { detectResultScreen } from '../../src/result-analysis.mjs';
import { resultBoundaryModelVersion } from '../../src/result-boundary.mjs';

const state = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
const errors = [];
const fallback = [];
let segments = 0;
let personalDetected = 0;
let structureConfirmed = 0;
let visionConfirmed = 0;
let confidenceTotal = 0;

function sameNumber(left, right, tolerance = 0.001) {
  return Number.isFinite(Number(left)) && Number.isFinite(Number(right))
    && Math.abs(Number(left) - Number(right)) <= tolerance;
}

for (const recording of state.recordings || []) {
  const workDir = path.join(WORK_ROOT, recording.id);
  const boundary = JSON.parse(await fs.readFile(path.join(workDir, 'result-boundaries.json'), 'utf8'));
  const manifest = JSON.parse(await fs.readFile(path.join(workDir, 'manifest.json'), 'utf8'));
  let personalCache = { matches: [] };
  try {
    personalCache = JSON.parse(await fs.readFile(path.join(workDir, 'personal-results', 'analysis-cache.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const personalById = new Map((personalCache.matches || []).map(item => [item.id, item]));
  if (boundary.version !== resultBoundaryModelVersion) {
    errors.push({ recording: recording.fileName, field: 'version', expected: resultBoundaryModelVersion, actual: boundary.version });
  }
  if (boundary.segments?.length !== recording.matches?.length || manifest.segments?.length !== boundary.segments?.length) {
    errors.push({ recording: recording.fileName, field: 'segment-count' });
    continue;
  }
  for (let index = 0; index < boundary.segments.length; index += 1) {
    segments += 1;
    const segment = boundary.segments[index];
    const saved = recording.matches[index];
    const manifested = manifest.segments[index];
    for (const field of ['start', 'end']) {
      if (!sameNumber(saved[field], segment[field])) errors.push({ recording: recording.fileName, match: index + 1, field: `state-${field}` });
      if (!sameNumber(manifested[field], segment[field])) errors.push({ recording: recording.fileName, match: index + 1, field: `manifest-${field}` });
    }
    const media = await probeMedia(path.join(MATCH_ROOT, recording.id, saved.fileName));
    if (!sameNumber(media.duration, segment.end - segment.start, 0.12)) {
      errors.push({ recording: recording.fileName, match: index + 1, field: 'clip-duration', expected: segment.end - segment.start, actual: media.duration });
    }
    if (segment.resultBoundary?.screenType !== 'personal') {
      fallback.push({ recording: recording.fileName, match: index + 1, detection: segment.resultBoundary?.detection || null });
      continue;
    }
    personalDetected += 1;
    const frame = await extractRgbFrame(recording.source, segment.resultBoundary.detectedAt);
    if (detectResultScreen(frame, segment.resultBoundary.detectedAt)?.screenType === 'personal') structureConfirmed += 1;
    const vision = personalById.get(`match-${String(index + 1).padStart(2, '0')}`);
    if (vision?.confidence >= 0.9) {
      visionConfirmed += 1;
      confidenceTotal += vision.confidence;
    }
  }
}

const result = {
  modelVersion: resultBoundaryModelVersion,
  recordings: state.recordings?.length || 0,
  segments,
  synchronized: errors.length === 0,
  errors,
  personalDetected,
  structureConfirmed,
  visionConfirmed,
  precision: personalDetected ? Number((visionConfirmed / personalDetected).toFixed(4)) : null,
  coverage: segments ? Number((personalDetected / segments).toFixed(4)) : null,
  meanVisionConfidence: visionConfirmed ? Number((confidenceTotal / visionConfirmed).toFixed(3)) : null,
  fallback,
};
console.log(JSON.stringify(result, null, 2));
if (errors.length || structureConfirmed !== personalDetected || visionConfirmed !== personalDetected) process.exitCode = 1;
