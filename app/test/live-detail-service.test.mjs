import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LiveDetailService } from '../src/live-detail-service.mjs';
import { personalResultFrameTime } from '../src/personal-result-analysis.mjs';

test('result frames wait for cards without crossing the end of the match', () => {
  assert.equal(personalResultFrameTime({ resultBoundary: { detectedAt: 100 }, end: 104 }), 101.5);
  assert.equal(personalResultFrameTime({ resultBoundary: { detectedAt: 100 }, end: 101 }), 100.75);
  assert.equal(personalResultFrameTime({}), null);
});

test('finished live recordings are enriched automatically while source, deaths and cloud state stay unchanged', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'live-details-'));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  await fs.mkdir(path.join(root, 'r'));
  const file = path.join(root, 'r', 'match-03.json');
  const initial = { source: { start: 200, end: 400 }, events: [{ type: 'death', time: 10 }], validation: { deaths: { resultTime: 195 } }, playerStats: { kills: 2, deaths: 1 } };
  await fs.writeFile(file, JSON.stringify(initial));
  const recording = { id: 'r', source: 'source.mp4', status: 'ready', matches: [{ number: 3, status: 'ready', start: 200, end: 400, sourceVideoUrl: '/media/source', cloud: { status: 'ready' } }] };
  const original = structuredClone(recording); let calls = 0;
  const service = new LiveDetailService({ list: () => [recording] }, { analysisRoot: root, workRoot: root,
    personal: async ({ segments }) => { calls++; assert.equal(segments[0].resultBoundary.detectedAt, 395); return [{ id: 'match-01', stage: 'stage', rule: 'rule', weapon: 'weapon', source: 'automatic', confidence: .99 }]; },
    rosters: async ({ expectedWeapons }) => { assert.equal(expectedWeapons.get('match-03'), 'weapon'); return new Map([['match-03', { complete: true, allyWeapons: ['a','b','c'], enemyWeapons: ['d','e','f','g'] }]]); },
  });
  recording.live = true; await service.tick(); assert.equal(calls, 0); delete recording.live;
  await service.tick(); await service.tick(); assert.equal(calls, 1);
  const result = JSON.parse(await fs.readFile(file));
  assert.equal(result.detailEnrichment.status, 'complete'); assert.equal(result.stageMap.stage, 'stage');
  assert.deepEqual(result.events, initial.events); assert.deepEqual(result.source, initial.source); assert.deepEqual(result.playerStats, initial.playerStats); assert.deepEqual(recording, original);
});

test('uncertain automatic results remain missing and retries are delayed', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'live-details-'));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  await fs.mkdir(path.join(root, 'r')); const file = path.join(root, 'r', 'match-01.json');
  await fs.writeFile(file, JSON.stringify({ source: { start: 0 }, validation: { deaths: { resultTime: 10 } } }));
  let calls = 0;
  const service = new LiveDetailService({ list: () => [{ id: 'r', status: 'ready', matches: [{ number: 1, status: 'ready', sourceVideoUrl: '/source' }] }] }, { analysisRoot: root, workRoot: root, personal: async () => { calls++; return [{ id: 'match-01', confidence: .4, stage: 'guess' }]; }, rosters: async () => { throw new Error('must not guess without self weapon'); } });
  await service.tick(); await service.tick();
  const result = JSON.parse(await fs.readFile(file)); assert.equal(result.stageMap, undefined); assert.equal(result.detailEnrichment.status, 'incomplete'); assert.equal(calls, 1);
});
