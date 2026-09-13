import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LiveRecordingController } from '../src/live-recording-controller.mjs';

test('publishes original source playback while recording, before remote fragments are ready', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'splatoon-live-publish-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.mp4');
  await fs.writeFile(source, 'growing original');
  const recording = { id: 'live-1', source, status: 'recording', live: true, matches: [] };
  const patches = [];
  const store = {
    value: structuredClone(recording), get() { return this.value; },
    async patch(id, patch) { patches.push(structuredClone(patch)); Object.assign(this.value, structuredClone(patch)); },
  };
  const samples = Object.fromEntries(['personalResults', 'battleHud', 'respawn', 'map', 'perception', 'outcomes', 'scoreCount', 'objectiveCount', 'coarse'].map(key => [key, []]));
  let releaseSegments;
  const segmentsReady = new Promise(resolve => { releaseSegments = resolve; });
  const controller = new LiveRecordingController({
    recording, store, collector: { samples: new Map([[1, samples]]) },
    session: { segments: async () => {
      assert.equal(store.value.matches[0].status, 'ready');
      assert.equal(store.value.live, true);
      assert.equal(store.value.matches[0].sourceVideoStart, 20);
      assert.equal(store.value.matches[0].sourceVideoUrl, '/media/recordings/live-1/source.mp4?through=140');
      await fs.appendFile(source, ' still recording');
      releaseSegments();
      return [{ fileName: 'segment.mp4', start: 20, end: 142 }];
    } },
    analysisRoot: path.join(root, 'analysis'), liveMediaRoot: path.join(root, 'live'),
    thumbnailRoot: path.join(root, 'thumbnails'), thumbnailExtractor: async () => {},
  });
  const publishing = controller.publish({ number: 1, start: 20, end: 140 });
  await segmentsReady;
  await publishing;
  assert.equal(store.value.status, 'recording');
  assert.equal(store.value.live, true);
  assert.equal(store.value.matches[0].videoManifest.fragments.length, 1);
  assert.equal(patches[0].matches[0].videoManifest, undefined);
  assert.equal(await fs.readFile(source, 'utf8'), 'growing original still recording');
  const analysis = JSON.parse(await fs.readFile(path.join(root, 'analysis/live-1/match-01.json'), 'utf8'));
  assert.equal(analysis.media.duration, 120);
  assert.equal(analysis.source.start, 20);
});

test('recording stop keeps the raw source, removes fragments, and switches ready matches to raw playback', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'splatoon-live-stop-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const liveMediaRoot = path.join(root, 'live-media');
  const source = path.join(root, 'source.mp4');
  await fs.writeFile(source, 'raw recording remains here');
  const recording = {
    id: 'recording-1', source, status: 'recording', live: true,
    matches: [
      { number: 1, start: 20, end: 140, status: 'ready', videoManifest: { fragments: [{ url: '/media/live/recording-1/run/segment.mp4' }] } },
      { number: 2, start: 180, end: null, status: 'analyzing' },
    ],
  };
  const mediaRoot = path.join(liveMediaRoot, recording.id, 'run');
  await fs.mkdir(mediaRoot, { recursive: true });
  await fs.writeFile(path.join(mediaRoot, 'segment.mp4'), 'temporary fragment');
  const store = {
    value: structuredClone(recording),
    get() { return this.value; },
    async patch(id, patch) { assert.equal(id, recording.id); Object.assign(this.value, structuredClone(patch)); return this.value; },
  };
  const session = { stopCalled: false, stop() { this.stopCalled = true; }, completed: Promise.resolve() };
  const thumbnailCalls = [];
  const controller = new LiveRecordingController({
    store, recording, session, liveMediaRoot,
    thumbnailRoot: path.join(root, 'thumbnails'),
    thumbnailExtractor: async (...args) => { thumbnailCalls.push(args); },
  });

  await controller.stop();

  assert.equal(session.stopCalled, true);
  assert.equal(await fs.readFile(source, 'utf8'), 'raw recording remains here');
  await assert.rejects(fs.stat(path.join(liveMediaRoot, recording.id)), { code: 'ENOENT' });
  assert.equal(store.value.status, 'ready');
  assert.equal(store.value.live, false);
  assert.equal(store.value.matches[0].sourceVideoUrl, '/media/recordings/recording-1/source.mp4');
  assert.equal(store.value.matches[0].sourceVideoStart, 20);
  assert.equal(store.value.matches[0].thumbnailUrl, '/media/thumbnails/recording-1/match-01.jpg');
  assert.equal(thumbnailCalls.length, 1);
  assert.equal(thumbnailCalls[0][1], 55);
  assert.equal('videoManifest' in store.value.matches[0], false);
  assert.equal(store.value.matches[1].status, 'analyzing');
});
