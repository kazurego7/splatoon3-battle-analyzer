export function deathSeekTime(event, offset = -8, duration = Number.POSITIVE_INFINITY) {
  return Math.max(0, Math.min(Number(duration) || Number.POSITIVE_INFINITY, (Number(event?.time) || 0) + offset));
}

export function deathSequenceFor(analysis, event) {
  if (Array.isArray(event?.sequence)) return event.sequence;
  return analysis?.deathAnalysis?.sequences?.find(item => item.id === event?.id)?.sequence || [];
}

export function deathAnalysisEndpoint(analysisUrl) {
  return `${String(analysisUrl || '').replace(/[?#].*$/, '').replace(/\/$/, '')}/ai-death-sequence`;
}

export const deathPhaseLabels = {
  setup: '起点', approach: '接近', commitment: '判断', danger: '危険化', death: 'デス',
};
