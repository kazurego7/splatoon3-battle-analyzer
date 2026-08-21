import fs from 'node:fs/promises';
import path from 'node:path';
import { recordingId } from '../../src/pipeline.mjs';
import { probeMedia } from '../../src/ffmpeg.mjs';
import { ANALYSIS_ROOT, MATCH_ROOT, RAW_ROOT, STATE_FILE, THUMBNAIL_ROOT, WORK_ROOT } from '../../src/paths.mjs';

function mediaUrl(root, id, fileName) {
  return `/media/${root}/${encodeURIComponent(id)}/${encodeURIComponent(fileName)}`;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

const entries = (await fs.readdir(RAW_ROOT, { withFileTypes: true }))
  .filter(entry => entry.isFile() && /\.(mp4|mov|mkv|webm)$/i.test(entry.name));
const recordings = [];

for (const entry of entries) {
  const source = path.join(RAW_ROOT, entry.name);
  const stat = await fs.stat(source);
  const id = recordingId(entry.name, stat.size);
  const manifestFile = path.join(WORK_ROOT, id, 'manifest.json');
  const manifest = await exists(manifestFile) ? await readJson(manifestFile) : { segments: [] };
  const matches = [];
  for (let index = 0; index < manifest.segments.length; index += 1) {
    const number = index + 1;
    const fileName = `match-${String(number).padStart(2, '0')}.mp4`;
    const clip = path.join(MATCH_ROOT, id, fileName);
    if (!await exists(clip)) continue;
    const clipMedia = await probeMedia(clip);
    const analysisFile = path.join(ANALYSIS_ROOT, id, fileName.replace(/\.mp4$/i, '.json'));
    let analysis = null;
    try { analysis = await readJson(analysisFile); } catch {}
    matches.push({
      id: `${id}-match-${String(number).padStart(2, '0')}`,
      number,
      fileName,
      start: manifest.segments[index].start,
      end: manifest.segments[index].end,
      duration: clipMedia.duration,
      status: analysis ? 'ready' : 'split',
      videoUrl: mediaUrl('matches', id, fileName),
      thumbnailUrl: mediaUrl('thumbnails', id, fileName.replace(/\.mp4$/i, '.jpg')),
      analysisUrl: `/api/analysis/${encodeURIComponent(id)}/${encodeURIComponent(fileName.replace(/\.mp4$/i, '.json'))}`,
      eventCount: Array.isArray(analysis?.events) ? analysis.events.length : 0,
    });
  }
  const ready = matches.length > 0 && matches.every(match => match.status === 'ready');
  recordings.push({
    id,
    fileName: entry.name,
    source,
    size: stat.size,
    status: ready ? 'ready' : 'queued',
    phase: ready ? '分析済み' : '再分析待ち',
    progress: ready ? 1 : 0,
    matches,
    createdAt: stat.birthtime.toISOString(),
    updatedAt: new Date().toISOString(),
    error: null,
    media: await probeMedia(source),
    ...(ready ? { completedAt: new Date().toISOString() } : {}),
  });
}

recordings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
const recovered = { version: 1, recordings };
const temporary = `${STATE_FILE}.${process.pid}.recovered.tmp`;
await fs.writeFile(temporary, `${JSON.stringify(recovered, null, 2)}\n`, 'utf8');
await readJson(temporary);
if (await exists(STATE_FILE)) {
  const corrupt = path.join(path.dirname(STATE_FILE), `state.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await fs.rename(STATE_FILE, corrupt);
  console.log(`破損ファイルを退避: ${corrupt}`);
}
await fs.rename(temporary, STATE_FILE);
await fs.copyFile(STATE_FILE, `${STATE_FILE}.backup`);
console.log(`録画一覧を復元: ${recordings.length}件 / ${recordings.reduce((sum, recording) => sum + recording.matches.length, 0)}試合`);
