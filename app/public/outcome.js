export function resolveOutcomeLabel(analysis) {
  if (analysis?.outcome?.value === 'win') return 'WIN';
  if (analysis?.outcome?.value === 'lose') return 'LOSE';
  const last = analysis?.gameFlow?.gameCounts?.at(-1);
  if (!last) return '未判定';
  if (last.teamCount < last.enemyCount) return 'WIN';
  if (last.teamCount > last.enemyCount) return 'LOSE';
  return 'DRAW';
}
