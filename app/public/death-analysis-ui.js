export function deathSeekTime(event, offset = -8, duration = Number.POSITIVE_INFINITY) {
  return Math.max(0, Math.min(Number(duration) || Number.POSITIVE_INFINITY, (Number(event?.time) || 0) + offset));
}

export function deathAnalysisEndpoint(analysisUrl) {
  return `${String(analysisUrl || '').replace(/[?#].*$/, '').replace(/\/$/, '')}/ai-death-sequence`;
}

function withJapaneseStop(value) {
  const text = String(value || '').trim().replace(/[。.!！?？]+$/, '');
  return text ? `${text}。` : '';
}

function firstSentences(value, limit) {
  return (String(value || '').match(/[^。.!！?？]+[。.!！?？]?/g) || [])
    .slice(0, limit).map(withJapaneseStop).join('');
}

export function deathReportDigest(analysis) {
  const isDirectReport = Array.isArray(analysis?.patterns) || Object.hasOwn(analysis || {}, 'overallSummary');
  const report = analysis?.deathAnalysis || (isDirectReport ? analysis : null);
  if (!report) return 'AI分析を実行すると、この試合で繰り返した失敗パターンをここに表示します。';
  const patterns = Array.isArray(report.patterns) ? report.patterns : [];
  if (!patterns.length) return 'この試合では、2回以上繰り返した失敗パターンは見つかりませんでした。';
  return patterns.slice(0, 2).map(pattern => {
    const title = String(pattern?.title || '').trim();
    const summary = firstSentences(pattern?.summary, patterns.length === 1 ? 2 : 1);
    return withJapaneseStop(title && summary ? `「${title}」：${summary}` : title || summary);
  }).filter(Boolean).join(' ');
}
