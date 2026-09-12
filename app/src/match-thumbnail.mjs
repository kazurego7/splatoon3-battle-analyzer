import path from 'node:path';
import { extractJpeg } from './ffmpeg.mjs';
import { THUMBNAIL_ROOT } from './paths.mjs';

export function matchThumbnailName(match) {
  return `match-${String(match.number).padStart(2, '0')}.jpg`;
}

export async function createMatchThumbnail({
  recording,
  match,
  thumbnailRoot = THUMBNAIL_ROOT,
  extractor = extractJpeg,
}) {
  if (!recording?.source || !Number.isFinite(match?.start) || !Number.isFinite(match?.end)) return null;
  const duration = Math.max(0, match.end - match.start);
  const fileName = matchThumbnailName(match);
  const output = path.join(thumbnailRoot, recording.id, fileName);
  const time = match.start + Math.min(35, Math.max(1, duration / 3));
  await extractor(recording.source, time, output, 640);
  return `/media/thumbnails/${encodeURIComponent(recording.id)}/${encodeURIComponent(fileName)}`;
}
