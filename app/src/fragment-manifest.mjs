function rounded(value) {
  return Number(Number(value).toFixed(6));
}

export function selectMatchFragments(segments, { start, end, codec = null, urlFor = segment => segment.fileName } = {}) {
  start = Number(start);
  end = Number(end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('試合区間の開始・終了時刻が不正です');
  }
  const selected = [...(segments || [])]
    .filter(segment => Number(segment.end) > start && Number(segment.start) < end)
    .sort((left, right) => left.start - right.start);
  if (!selected.length) return null;
  let timeline = 0;
  const fragments = selected.map(segment => {
    const duration = Number(segment.duration ?? segment.end - segment.start);
    const item = {
      url: urlFor(segment),
      sourceStart: rounded(segment.start),
      sourceEnd: rounded(segment.end),
      timelineStart: rounded(timeline),
      duration: rounded(duration),
    };
    timeline += duration;
    return item;
  });
  const first = fragments[0];
  const last = fragments.at(-1);
  return {
    version: 1,
    ...(codec ? { codec } : {}),
    sourceStart: rounded(start),
    sourceEnd: rounded(end),
    playbackStart: rounded(start - first.sourceStart),
    playbackEnd: rounded(last.timelineStart + Math.min(last.duration, end - last.sourceStart)),
    duration: rounded(end - start),
    fragments,
  };
}
