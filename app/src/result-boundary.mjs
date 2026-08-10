import { sampleRgbWindow } from './ffmpeg.mjs';
import { detectResultScreen } from './result-analysis.mjs';
import { findResultTable } from './player-identity.mjs';

export const resultBoundaryModelVersion = 3;

export function chooseResultBoundary(observations, { fallbackEnd, searchEnd, interval = 1 } = {}) {
  const detected = observations.filter(observation => observation?.screenType);
  const preferred = detected.filter(observation => observation.screenType === 'overall');
  const candidates = preferred.length
    ? preferred
    : detected.filter(observation => observation.screenType === 'personal');
  if (!candidates.length) return {
    end: fallbackEnd,
    resultBoundary: { screenType: null, detection: 'heuristic-fallback' },
  };

  const last = candidates.reduce((latest, observation) => observation.time > latest.time ? observation : latest);
  return {
    // A sample represents the following interval. The small tail keeps the last
    // visible result frame and its transition without retaining lobby footage.
    end: Number(Math.min(searchEnd, last.time + interval + 0.25).toFixed(3)),
    resultBoundary: {
      screenType: last.screenType,
      detectedAt: Number(last.time.toFixed(3)),
      detection: last.screenType === 'overall' ? 'overall-result-priority' : 'personal-result-fallback',
    },
  };
}

export async function refineResultBoundaries(source, segments, duration, {
  interval = 1,
  fineInterval = 0.25,
  sampler = sampleRgbWindow,
  onProgress,
} = {}) {
  const refined = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const searchStart = Math.max(segment.start, segment.activeEnd - 12);
    const searchEnd = Math.max(searchStart, Math.min(duration, segments[index + 1]?.start - 0.25 || duration));
    let observations = await sampler(source, searchStart, searchEnd, {
      interval,
      onFrame: (frame, width, height, time) => {
        const result = detectResultScreen(frame, time);
        return { time, screenType: result?.screenType || null };
      },
    });
    let boundaryInterval = interval;
    if (!observations.some(observation => observation.screenType === 'overall')) {
      const fineOverall = await sampler(source, searchStart, searchEnd, {
        interval: fineInterval,
        onFrame: (frame, width, height, time) => ({
          time,
          screenType: findResultTable(frame, width, height) ? 'overall' : null,
        }),
      });
      if (fineOverall.some(observation => observation.screenType === 'overall')) {
        observations = fineOverall;
        boundaryInterval = fineInterval;
      }
    }
    const boundary = chooseResultBoundary(observations, {
      fallbackEnd: segment.end,
      searchEnd,
      interval: boundaryInterval,
    });
    refined.push({ ...segment, ...boundary });
    onProgress?.((index + 1) / segments.length, index + 1, segments.length);
  }
  return refined;
}
