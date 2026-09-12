import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { gunzipSync } from 'node:zlib';
import { sendBody } from '../src/http-performance.mjs';
import { ListAssets, analysisSummary } from '../src/list-assets.mjs';
import { resolveOutcomeLabel } from '../public/outcome.js';
import { killDeathFromAnalysis } from '../public/player-stats-ui.js';
import { matchAnalysisBadge } from '../public/death-analysis-ui.js';

test('summary preserves list facts including fallback outcome, missing stats and AI state', () => {
  for (const analysis of [{}, { outcome: { value: 'win' }, playerStats: { kills: 0, deaths: 2 }, deathAnalysis: { patterns: [] } }, { gameFlow: { gameCounts: [{ teamCount: 90, enemyCount: 10 }, { teamCount: 1, enemyCount: 5 }] }, validation: { deaths: { expected: 4 } }, deathAnalysisState: { status: 'report' } }]) {
    const summary = analysisSummary(analysis);
    assert.equal(resolveOutcomeLabel(summary), resolveOutcomeLabel(analysis));
    assert.equal(killDeathFromAnalysis(summary), killDeathFromAnalysis(analysis));
    assert.deepEqual(matchAnalysisBadge({ ready: true, analysis: summary }), matchAnalysisBadge({ ready: true, analysis }));
  }
});

test('summary and thumbnail refresh after source changes, retain originals and handle missing analysis', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sba-performance-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const service = new ListAssets(), file = path.join(root, 'match.json'), picture = path.join(root, 'thumb.jpg');
  await fs.writeFile(file, JSON.stringify({ outcome: { value: 'win' } }));
  assert.equal((await service.summary(file)).outcome.value, 'win');
  await fs.writeFile(file, JSON.stringify({ outcome: { value: 'lose' }, extra: 10 }));
  assert.equal((await service.summary(file)).outcome.value, 'lose');
  assert.equal(await service.summary(path.join(root, 'missing.json')), null);
  await sharp({ create: { width: 1280, height: 720, channels: 3, background: 'red' } }).jpeg().toFile(picture);
  const original = await fs.readFile(picture), small = await service.thumbnail(picture);
  assert.equal((await sharp(small).metadata()).width, 320);
  assert.equal((await sharp(small).metadata()).format, 'webp');
  assert.deepEqual(await fs.readFile(picture), original);
  await sharp({ create: { width: 640, height: 360, channels: 3, background: 'blue' } }).jpeg().toFile(picture);
  assert.notDeepEqual(await service.thumbnail(picture), small);
  const records = await service.recordings([{ matches: [{ analysisUrl: '/api/analysis/match.json', sourceVideoUrl: '/media/raw/id' }] }], root);
  assert.equal(records[0].matches[0].summary.outcome.value, 'lose');
  assert.equal(records[0].matches[0].sourceVideoUrl, '/media/raw/id');
});

function response() { return { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } }; }
test('compression, conditional validation, changed data, HEAD and disabled gzip', () => {
  const body = JSON.stringify({ text: 'テスト'.repeat(1000) }), first = response();
  sendBody({ method: 'GET', headers: { 'accept-encoding': 'gzip' } }, first, body, 'application/json');
  assert.equal(gunzipSync(first.body).toString(), body);
  const headers = { 'accept-encoding': 'gzip', 'if-none-match': first.headers.ETag }, second = response();
  sendBody({ method: 'GET', headers }, second, body, 'application/json');
  assert.equal(second.status, 304); assert.equal(second.body, undefined);
  const changed = response(); sendBody({ method: 'GET', headers }, changed, body+' ', 'application/json'); assert.equal(changed.status, 200);
  const head = response(); sendBody({ method: 'HEAD', headers: {} }, head, body, 'application/json'); assert.equal(head.body, undefined);
  const plain = response(); sendBody({ method: 'GET', headers: { 'accept-encoding': 'gzip;q=0' } }, plain, body, 'application/json'); assert.equal(plain.headers['Content-Encoding'], undefined);
});
