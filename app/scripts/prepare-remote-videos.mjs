import fs from 'node:fs/promises';
import path from 'node:path';
import { mapWithConcurrency } from '../src/concurrency.mjs';
import { MATCH_ROOT, REMOTE_MATCH_ROOT, STATE_FILE } from '../src/paths.mjs';
import { prepareRemoteVideo, remoteVideoState } from '../src/remote-video.mjs';

const codecArgument = process.argv[2];
const codecs = codecArgument === 'all' ? ['hevc', 'h264'] : [codecArgument === 'hevc' ? 'hevc' : 'h264'];
const query = process.argv.slice(3).join(' ').trim();
const state = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
const recordings = (state.recordings || []).filter(recording =>
  !query || recording.id === query || recording.fileName === query);
if (!recordings.length) throw new Error('対象の録画が見つかりません');

const jobs = codecs.flatMap(codec => recordings.flatMap(recording => (recording.matches || []).map(match => ({ codec, recording, match }))));
let completed = 0;
await mapWithConcurrency(jobs, 2, async ({ codec, recording, match }) => {
  const source = path.join(MATCH_ROOT, recording.id, match.fileName);
  const output = path.join(REMOTE_MATCH_ROOT, codec, recording.id, match.fileName);
  const initial = await remoteVideoState(source, output, codec);
  if (initial.status !== 'ready') {
    const prepared = await prepareRemoteVideo(source, output, codec);
    if (prepared.promise) await prepared.promise;
  }
  const final = await remoteVideoState(source, output, codec);
  if (final.status !== 'ready') throw new Error(`${recording.fileName} / ${match.fileName} を準備できませんでした`);
  completed += 1;
  console.log(`[${completed}/${jobs.length}] ${codec} ${recording.fileName} / ${match.fileName}`);
});
console.log(JSON.stringify({ completed, total: jobs.length, codecs }, null, 2));
