import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { frameTimes, inspectVideo } from '../src/ai-video-tools.mjs';
import { prepareVideoWorkspace, preanalysisContext } from '../src/ai-video-workspace.mjs';
import { codexArgs, normalizeCodexAnalysis, normalizeCodexPatterns } from '../src/codex-death-analysis.mjs';
import { runFfmpeg } from '../src/ffmpeg.mjs';

test('agent can select arbitrary times across the full video, with bounded extraction calls', () => {
  assert.deepEqual(frameTimes({ start: 100, end: 101, step: 0.25 }, 300), [100, 100.25, 100.5, 100.75, 101]);
  assert.throws(() => frameTimes({ time: -1 }, 300));
  assert.throws(() => frameTimes({ time: 300 }, 300));
  assert.throws(() => frameTimes({ start: 0, end: 10, step: 0 }, 300));
  assert.throws(() => frameTimes({ start: 0, end: 299, step: 0.01 }, 300));
});

test('keeps preanalysis evidence and timelines without recycling earlier AI conclusions', () => {
  const context = preanalysisContext({ gameFlow: { gameCounts: [[1, 90]] }, deathAnalysis: { old: true },
    deathAnalysisState: { status: 'error' }, events: [{ id: 'd', time: 3, evidence: { confidence: 0.8 },
      title: 'AI conclusion', analysisSource: 'codex-vision-sequence', sequence: [1] }] });
  assert.equal(context.deathAnalysis, undefined);
  assert.equal(context.deathAnalysisState, undefined);
  assert.equal(context.events[0].title, undefined);
  assert.deepEqual(context.events[0].evidence, { confidence: 0.8 });
  assert.deepEqual(context.gameFlow.gameCounts, [[1, 90]]);
});

test('CLI gives the agent a dedicated video tool, Astra medium, and no preselected images', () => {
  const args = codexArgs({ schemaPath: 'schema.json', outputPath: 'result.json', workspace: 'C:/space here/test' });
  assert.equal(args.includes('--image'), false);
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(args[args.indexOf('--model') + 1], 'gpt-6-astra');
  assert.ok(args.includes('model_reasoning_effort="medium"'));
  assert.equal(args[args.indexOf('--cd') + 1], 'C:/space here/test');
});

test('new sequence and clip offsets are not restricted to the old contact sheet', () => {
  const sequence = [-30.25, -15.5, -1.75, 2.25].map(offset => ({ offset, phase: 'approach', observation: '見えた事実', interpretation: '解釈' }));
  const result = normalizeCodexAnalysis({ deaths: [{ id: 'd', title: '要約', situation: '局面', cause: '原因', sequence,
    turningPoint: { offset: -15.5, action: '行動', whyItMattered: '理由' }, patternTags: ['傾向'] }] }, new Set(['d']));
  assert.deepEqual(result[0].sequence, sequence);
  const report = normalizeCodexPatterns({ overallSummary: '要約', patterns: [{ id: 'p', title: '傾向', summary: '説明',
    trigger: '状況', repeatedAction: '行動', consequence: '結果', reviewFocus: '注目', deathIds: ['d', 'e'],
    clips: ['d', 'e'].map(deathId => ({ deathId, startOffset: -30, endOffset: 8, label: '場面', reason: '根拠' })) }] }, new Set(['d', 'e']));
  assert.equal(report.patterns.length, 1);
});

test('real video helper reads preanalysis and extracts agent-selected frames and crops without changing the source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'splatoon-video-test-'));
  try {
    const clipPath = path.join(root, 'test video.mp4');
    await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=10',
      '-t', '2', '-c:v', 'libx264', '-y', clipPath]);
    const before = await fs.readFile(clipPath);
    const workspace = await prepareVideoWorkspace({ clipPath, deaths: [{ id: 'd', time: 1 }],
      analysisContext: { gameFlow: { gameCounts: [[0, 100], [1, 90]] } }, directory: path.join(root, 'workspace') });
    assert.deepEqual(await inspectVideo(workspace, { action: 'data', key: 'gameFlow.gameCounts' }), [[0, 100], [1, 90]]);
    const result = await inspectVideo(workspace, { action: 'frames', start: 0.2, end: 0.8, step: 0.3, width: 640 });
    assert.deepEqual(result.frames.map(frame => frame.time), [0.2, 0.5, 0.8]);
    for (const frame of result.frames) assert.ok((await fs.stat(frame.path)).size > 100);
    const cropped = await inspectVideo(workspace, { action: 'frame', time: 1.5, width: 320, crop: { x: 20, y: 30, width: 100, height: 100 } });
    assert.ok((await fs.stat(cropped.frames[0].path)).size > 100);
    await assert.rejects(inspectVideo(workspace, { action: 'frame', time: 1, crop: { x: 600, y: 0, width: 100, height: 100 } }));
    assert.deepEqual(await fs.readFile(clipPath), before);
    assert.equal((await fs.readFile(path.join(workspace, 'inspections.jsonl'), 'utf8')).trim().split('\n').length, 2);
    const ranged = await prepareVideoWorkspace({ clipPath, deaths: [{ id: 'd', time: .5 }], videoRange: { start: 1, end: 2 }, directory: path.join(root, 'ranged') });
    const info = await inspectVideo(ranged, { action: 'info' });
    assert.equal(info.duration, 1); assert.equal(info.sourceOffset, 1);
    const originalFrame = await inspectVideo(workspace, { action: 'frame', time: 1.5, width: 320 });
    const relativeFrame = await inspectVideo(ranged, { action: 'frame', time: .5, width: 320 });
    assert.equal(relativeFrame.frames[0].time, .5);
    assert.deepEqual(await fs.readFile(relativeFrame.frames[0].path), await fs.readFile(originalFrame.frames[0].path));
    await assert.rejects(inspectVideo(ranged, { action: 'frame', time: 1 }));
    await assert.rejects(prepareVideoWorkspace({ clipPath, deaths: [], videoRange: { start: 1, end: 4 }, directory: path.join(root, 'bad') }));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
