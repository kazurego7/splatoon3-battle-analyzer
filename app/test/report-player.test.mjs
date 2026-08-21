import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { nearestClipIndex, nextClipIndex, patternClipRanges, patternReportModels } from '../public/report-player.js';

const events = [
  { id: 'death-1', type: 'death', time: 38.25 },
  { id: 'death-2', type: 'death', time: 128 },
];

test('turns each pattern clip into a bounded range on the original match video', () => {
  const ranges = patternClipRanges({ id: 'p1', clips: [
    { deathId: 'death-1', startOffset: -6, endOffset: 1, label: '接近', reason: '判断を見る' },
    { deathId: 'death-2', startOffset: -8, endOffset: 2, label: '再発', reason: '反復を見る' },
  ] }, events, 130);
  assert.deepEqual(ranges.map(({ start, end }) => [start, end]), [[32.25, 39.25], [120, 130]]);
});

test('creates backward-compatible ranges for analyses made before clip metadata existed', () => {
  const ranges = patternClipRanges({ id: 'p1', deathIds: ['death-1', 'death-2'] }, events, 140);
  assert.deepEqual(ranges.map(({ start, end }) => [start, end]), [[30.25, 40.25], [120, 130]]);
});

test('clip playback loops and chooses a range independently by time', () => {
  const clips = [{ start: 10, end: 20 }, { start: 40, end: 50 }, { start: 70, end: 80 }];
  assert.equal(nextClipIndex(2, clips.length), 0);
  assert.equal(nearestClipIndex(clips, 46), 1);
  assert.equal(nearestClipIndex(clips, 63), 2);
});

test('creates one independent player model for every pattern', () => {
  const clip = { deathId: 'death-1', startOffset: -8, endOffset: 1, label: '根拠', reason: '確認' };
  const models = patternReportModels({ media: { duration: 140 }, events, deathAnalysis: { patterns: [
    { id: 'p1', clips: [clip] }, { id: 'p2', clips: [{ ...clip, label: '別の根拠' }] },
  ] } });
  assert.equal(models.length, 2);
  assert.deepEqual(models.map(model => model.reportIndex), [1, 2]);
  assert.notEqual(models[0].resolvedClips, models[1].resolvedClips);
});

test('report page overrides the fixed-height app shell and remains scrollable', async () => {
  const css = await fs.readFile(new URL('../public/report.css', import.meta.url), 'utf8');
  assert.match(css, /body\.report-body\s*\{[^}]*height:auto;[^}]*overflow-y:auto;/);
});
