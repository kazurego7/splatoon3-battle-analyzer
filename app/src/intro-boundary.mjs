import { analyzeRgbFrame, sampleRgbWindow } from './ffmpeg.mjs';
import { ruleIntroScore } from './segmentation.mjs';
import { mapWithConcurrency, positiveConcurrency } from './concurrency.mjs';

const DEFAULT_CONCURRENCY = positiveConcurrency(process.env.VIDEO_BOUNDARY_CONCURRENCY, 2);

export function chooseIntroBoundary(observations, {
  interval = 1,
  maximumDarkChange = 0.02,
  maximumSaturationChange = 0.05,
} = {}) {
  for (let index = 0; index < observations.length - 1; index += 1) {
    const current = observations[index];
    const next = observations[index + 1];
    const consecutive = next.time - current.time <= interval * 1.5;
    const bothRuleCards = ruleIntroScore(current) >= 0.82 && ruleIntroScore(next) >= 0.82;
    const settled = Math.abs(next.centerDarkRatio - current.centerDarkRatio) <= maximumDarkChange
      && Math.abs(next.saturation - current.saturation) <= maximumSaturationChange;
    if (consecutive && bothRuleCards && settled) return current.time;
  }
  return null;
}

export async function refineIntroBoundaries(source, segments, duration, {
  interval = 0.5,
  searchBefore = 2,
  searchAfter = 4,
  sampler = sampleRgbWindow,
  concurrency = DEFAULT_CONCURRENCY,
} = {}) {
  return mapWithConcurrency(segments, concurrency, async segment => {
    const searchStart = Math.max(0, segment.start - searchBefore);
    const searchEnd = Math.min(duration, segment.start + searchAfter);
    const observations = await sampler(source, searchStart, searchEnd, {
      interval,
      width: 160,
      height: 90,
      onFrame: (frame, width, height, time) => analyzeRgbFrame(frame, null, width, height, time),
    });
    const start = chooseIntroBoundary(observations, { interval });
    return start == null ? segment : {
      ...segment,
      start,
      activeStart: start,
      introBoundary: { detectedAt: start, detection: 'one-second-stable-rule-card' },
    };
  });
}
