export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

export function formatReportTime(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function patternClipRanges(pattern, events, duration) {
  const deaths = new Map((events || []).filter(event => event.type === 'death').map(event => [event.id, event]));
  const source = Array.isArray(pattern?.clips) && pattern.clips.length
    ? pattern.clips
    : (pattern?.deathIds || []).map((deathId, index) => ({
      deathId, startOffset: -8, endOffset: 2,
      label: `根拠シーン ${index + 1}`, reason: 'デス前後の行動を確認',
    }));
  const seen = new Set();
  return source.flatMap((clip, index) => {
    const death = deaths.get(clip?.deathId);
    if (!death) return [];
    const start = clamp(death.time + Number(clip.startOffset), 0, duration);
    const end = clamp(death.time + Number(clip.endOffset), 0, duration);
    const key = `${clip.deathId}/${start}/${end}`;
    if (end - start < 0.5 || seen.has(key)) return [];
    seen.add(key);
    return [{
      id: `${pattern.id || 'pattern'}-clip-${index + 1}`,
      deathId: clip.deathId, start, end,
      label: String(clip.label || `根拠シーン ${index + 1}`),
      reason: String(clip.reason || ''),
    }];
  });
}

export function nextClipIndex(current, clipCount) {
  return clipCount > 0 ? (current + 1) % clipCount : -1;
}

export function nearestClipIndex(clips, time) {
  if (!clips.length) return -1;
  const containing = clips.findIndex(clip => time >= clip.start && time <= clip.end);
  if (containing >= 0) return containing;
  return clips.reduce((best, clip, index) => {
    const distance = Math.min(Math.abs(time - clip.start), Math.abs(time - clip.end));
    return distance < best.distance ? { index, distance } : best;
  }, { index: 0, distance: Number.POSITIVE_INFINITY }).index;
}

export function patternReportModels(analysis) {
  const duration = Number(analysis?.media?.duration) || 1;
  return (analysis?.deathAnalysis?.patterns || []).map((pattern, index) => ({
    ...pattern,
    reportIndex: index + 1,
    resolvedClips: patternClipRanges(pattern, analysis.events, duration),
  }));
}
