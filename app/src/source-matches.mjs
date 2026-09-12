import fs from 'node:fs/promises';
import path from 'node:path';

export function sourceMatch(recordingId, match) {
  if (!Number.isFinite(match.start) || !Number.isFinite(match.end) || match.start < 0 || match.end <= match.start) throw new Error('試合の開始・終了時刻が不正です');
  const result = { ...match, sourceVideoUrl: `/media/recordings/${encodeURIComponent(recordingId)}/source.mp4`, sourceVideoStart: match.start };
  delete result.fileName; delete result.videoUrl; delete result.videoManifest;
  return result;
}

export async function migrateSourceMatches(store) {
  let count = 0;
  for (const recording of store.list()) {
    if (recording.live || recording.status !== 'ready' || !recording.source || !(recording.matches || []).some(match => match.fileName || match.videoUrl)) continue;
    await fs.access(recording.source);
    const matches = recording.matches.map(match => sourceMatch(recording.id, match));
    if (store.stateFile) {
      const backup = path.join(path.dirname(store.stateFile), 'state.before-source-ranges.json');
      await fs.writeFile(backup, JSON.stringify(store.list(), null, 2), { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    }
    await store.patch(recording.id, { matches });
    count += matches.length;
  }
  return count;
}

// Old upload identities included the local clip filename. The source interval is unchanged.
export function canonicalCloudSignature(signature) {
  try { const fields = JSON.parse(signature); if (Array.isArray(fields) && fields.length === 8) { fields[6] = null; return JSON.stringify(fields); } } catch {}
  return signature;
}
