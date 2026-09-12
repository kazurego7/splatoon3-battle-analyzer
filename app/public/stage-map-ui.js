import { appUrl } from './app-path.js';
export function stageMapAssetUrl(stageMap) {
  const stage = String(stageMap?.stage || '').trim();
  const rule = String(stageMap?.rule || '').trim();
  if (!stage || !rule) return null;
  return appUrl(`/assets/stage-maps/${encodeURIComponent(`${stage}_${rule}.webp`)}`);
}
