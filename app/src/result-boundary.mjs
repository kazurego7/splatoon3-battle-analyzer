import { sampleRgbWindow } from './ffmpeg.mjs';
import { detectResultScreen } from './result-analysis.mjs';
import { mapWithConcurrency, positiveConcurrency } from './concurrency.mjs';

export const resultBoundaryModelVersion = 7;
const DEFAULT_CONCURRENCY = positiveConcurrency(process.env.VIDEO_BOUNDARY_CONCURRENCY, 2);

function stablePersonalRuns(observations, interval) {
  const runs = [];
  let current = [];
  for (const observation of observations.filter(item => item?.screenType === 'personal')) {
    if (current.length && observation.time - current.at(-1).time > interval * 1.5) {
      if (current.length >= 2) runs.push(current);
      current = [];
    }
    current.push(observation);
  }
  if (current.length >= 2) runs.push(current);
  return runs;
}

export function chooseResultBoundary(observations, { fallbackEnd, searchEnd, interval = 1 } = {}) {
  const runs = stablePersonalRuns(observations, interval);
  if (!runs.length) return {
    end: fallbackEnd,
    resultBoundary: { screenType: null, detection: 'heuristic-fallback' },
  };

  const last = runs.at(-1).at(-1);
  return {
    // A sample represents the following interval. The small tail keeps the last
    // visible result frame and its transition without retaining lobby footage.
    end: Number(Math.min(searchEnd, last.time + interval + 0.25).toFixed(3)),
    resultBoundary: {
      screenType: 'personal',
      detectedAt: Number(last.time.toFixed(3)),
      detection: 'stable-personal-result',
    },
  };
}

export async function refineResultBoundaries(source, segments, duration, {
  interval = 1,
  fineInterval = 0.25,
  sampler = sampleRgbWindow,
  onProgress,
  concurrency = DEFAULT_CONCURRENCY,
} = {}) {
  let completed = 0;
  return mapWithConcurrency(segments, concurrency, async (segment, index) => {
    // Results and victory animations can keep the coarse activity detector on
    // until the next intro. Always inspect the full post-game window instead of
    // assuming activeEnd is close to the end of gameplay.
    const searchStart = Math.max(segment.start, Math.min(segment.activeEnd - 12, segment.end - 90));
    const searchEnd = Math.max(searchStart, Math.min(duration, segments[index + 1]?.start - 0.25 || duration));
    let observations = await sampler(source, searchStart, searchEnd, {
      interval,
      onFrame: (frame, width, height, time) => {
        const result = detectResultScreen(frame, time);
        return { time, screenType: result?.screenType || null, confidence: result?.confidence ?? null };
      },
    });
    let boundaryInterval = interval;
    if (!stablePersonalRuns(observations, interval).length) {
      const finePersonal = await sampler(source, searchStart, searchEnd, {
        interval: fineInterval,
        onFrame: (frame, width, height, time) => {
          const result = detectResultScreen(frame, time);
          return { time, screenType: result?.screenType || null, confidence: result?.confidence ?? null };
        },
      });
      if (stablePersonalRuns(finePersonal, fineInterval).length) {
        observations = finePersonal;
        boundaryInterval = fineInterval;
      }
    }
    const boundary = chooseResultBoundary(observations, {
      fallbackEnd: segment.end,
      searchEnd,
      interval: boundaryInterval,
    });
    completed += 1;
    onProgress?.(completed / segments.length, completed, segments.length);
    return { ...segment, ...boundary };
  });
}
