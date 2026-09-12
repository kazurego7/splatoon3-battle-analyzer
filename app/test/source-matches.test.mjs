import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sourceMatch, migrateSourceMatches, canonicalCloudSignature } from '../src/source-matches.mjs';
import { CloudService } from '../src/cloud-service.mjs';

test('source migration keeps timing, metadata and original files and is idempotent', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'source-matches-')); t.after(() => fs.rm(root, { force: true, recursive: true }));
  const source = path.join(root, 'source.mp4'); await fs.writeFile(source, 'original');
  const record = { id: 'r', source, status: 'ready', matches: [{ number: 1, start: 10, end: 30, duration: 20, fileName: 'clip.mp4', videoUrl: '/media/matches/r/clip.mp4', analysisUrl: '/api/analysis/r/match-01.json', status: 'ready' }] };
  const old = structuredClone(record.matches[0]);
  const store = { list: () => [record], patch: async (id, patch) => Object.assign(record, patch), stateFile: path.join(root, 'state.json') };
  assert.equal(await migrateSourceMatches(store), 1); assert.equal(await migrateSourceMatches(store), 0);
  assert.equal(record.matches[0].sourceVideoStart, 10); assert.equal(record.matches[0].duration, old.duration);
  assert.equal(record.matches[0].analysisUrl, old.analysisUrl); assert.equal(record.matches[0].fileName, undefined);
  assert.equal(await fs.readFile(source, 'utf8'), 'original');
  const saved = JSON.parse(await fs.readFile(path.join(root, 'state.before-source-ranges.json'))); assert.equal(saved[0].matches[0].fileName, 'clip.mp4');
  assert.throws(() => sourceMatch('r', { start: -1, end: 10 }));
});

test('existing R2 uploads and multipart identities survive local storage migration', () => {
  const r = { id: 'r', source: 'source.mp4' }, old = { number: 1, start: 10, end: 30, duration: 20, fileName: 'clip.mp4' };
  const signature = JSON.stringify(['r', r.source, 1, 10, 30, 20, 'clip.mp4', 10]);
  const service = new CloudService({}, { api: { identity: 'bucket' } });
  const job = { signature, destination: 'bucket', objectKey: 'existing.mp4', uploadId: 'in-progress' }; service.jobs['r:1'] = job;
  assert.equal(service.currentJob(r, sourceMatch('r', old)), job);
  assert.equal(service.currentJob(r, { ...sourceMatch('r', old), start: 11 }), null);
  assert.equal(canonicalCloudSignature(signature), JSON.stringify(['r', r.source, 1, 10, 30, 20, null, 10]));
});
