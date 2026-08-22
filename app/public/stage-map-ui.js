export function stageMapAssetUrl(stageMap) {
  const stage = String(stageMap?.stage || '').trim();
  const rule = String(stageMap?.rule || '').trim();
  if (!stage || !rule) return null;
  return `/assets/stage-maps/${encodeURIComponent(`${stage}_${rule}.webp`)}`;
}
