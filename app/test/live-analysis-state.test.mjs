import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveMatchStateMachine, liveResultScreenType, stablePersonalResultPair } from '../src/live-analysis-state.mjs';
import { chooseIntroBoundary } from '../src/intro-boundary.mjs';
import { chooseResultBoundary } from '../src/result-boundary.mjs';

const nonRule = time => ({ time, centerDarkRatio: 1, centerWhiteRatio: 0, centerEdgeRatio: 0, saturation: 0 });
const rule = time => ({ time, centerDarkRatio: 0.26, centerWhiteRatio: 0.04, centerEdgeRatio: 0.13, saturation: 0.3 });

test('live state reports analyzing at the same stable intro boundary', () => {
  const machine = new LiveMatchStateMachine();
  machine.observeIntro(nonRule(20));
  machine.observeIntro(rule(21));
  const match = machine.observeIntro(rule(22));
  assert.equal(match.start, 21);
  assert.equal(match.status, 'analyzing');
  assert.equal(match.number, 1);
});

test('two personal frames expose the match, then preserve the final result boundary', () => {
  const machine = new LiveMatchStateMachine();
  const detected = [];
  const completed = [];
  machine.on('result-detected', match => detected.push(match));
  machine.on('match-finalized', match => completed.push(match));
  machine.observeIntro(rule(21));
  machine.observeIntro(rule(22));
  machine.observeOutcome({ time: 310 });
  machine.observeResult({ time: 320, screenType: 'personal' });
  machine.observeResult({ time: 320.25, screenType: 'personal' });
  assert.equal(detected.length, 1);
  assert.equal(detected[0].status, 'finalizing');
  machine.observeResult({ time: 320.5, screenType: 'personal' });
  machine.observeResult({ time: 320.75, screenType: null });
  machine.observeResult({ time: 321, screenType: null });
  assert.equal(completed.length, 1);
  assert.equal(completed[0].start, 21);
  assert.equal(completed[0].activeEnd, 310);
  assert.equal(completed[0].end, 321);
  assert.equal(completed[0].resultBoundary.detectedAt, 320.5);
});

test('a single result-like frame never publishes a match', () => {
  const machine = new LiveMatchStateMachine();
  machine.observeIntro(rule(21));
  machine.observeIntro(rule(22));
  machine.observeResult({ time: 300, screenType: 'personal' });
  machine.observeResult({ time: 300.25, screenType: null });
  assert.equal(machine.active.status, 'analyzing');
  assert.equal(machine.active.resultBoundary, null);
});

test('live and batch analysis preserve identical intro and result boundaries', () => {
  const introFrames = [nonRule(20), rule(21), rule(22)];
  const machine = new LiveMatchStateMachine();
  for (const frame of introFrames) machine.observeIntro(frame);
  const batchStart = chooseIntroBoundary(introFrames, { interval: 1 });
  assert.equal(machine.active.start, batchStart);

  const resultFrames = [
    { time: 320, screenType: 'personal' },
    { time: 320.25, screenType: 'personal' },
    { time: 320.5, screenType: 'personal' },
    { time: 320.75, screenType: null },
    { time: 321, screenType: null },
  ];
  for (const frame of resultFrames) machine.observeResult(frame);
  const batchBoundary = chooseResultBoundary(resultFrames, {
    fallbackEnd: 330,
    searchEnd: 330,
    interval: 0.25,
  });
  assert.equal(machine.matches[0].end, batchBoundary.end);
  assert.equal(machine.matches[0].resultBoundary.detectedAt, batchBoundary.resultBoundary.detectedAt);
});

test('K/D is required initially but structural result frames preserve a confirmed boundary', () => {
  const structural = { screenType: 'personal' };
  assert.equal(liveResultScreenType({ personalResult: null, result: structural, resultAlreadyConfirmed: false }), null);
  assert.equal(liveResultScreenType({ personalResult: { kills: 8, deaths: 3 }, result: structural }), 'personal');
  assert.equal(liveResultScreenType({ personalResult: null, result: structural, resultAlreadyConfirmed: true }), 'personal');
});

test('initial publication waits for two matching K/D readings', () => {
  assert.equal(stablePersonalResultPair([
    { killCount: 6, deathCount: 6 },
    { killCount: 6, deathCount: 5 },
  ]), false);
  assert.equal(stablePersonalResultPair([
    { killCount: 6, deathCount: 5 },
    { killCount: 6, deathCount: 5 },
  ]), true);
});
