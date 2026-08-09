import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPlayerCounts, detectSelfDeaths } from '../src/battle-analysis.mjs';
import { stabilizeGameCount } from '../src/game-count-vision.mjs';
import { findSelfResultRow } from '../src/player-identity.mjs';
import { analyzeMapCandidate, buildEnemySightPredictions, buildEnemyThreatZones, buildEntityPredictions, buildPlayerRoute, buildShortPredictions, detectAllyTracks, detectMapAllies, detectMapCursor, detectSpatialObservations, selectObservedMapFrame } from '../src/map-analysis.mjs';
import { applyVerifiedDeathWindows, attachRespawnEvidence, verifiedAnalysis } from '../src/analysis-overrides.mjs';
import { analyzeEnemyColorFrame, buildDeathCameraDetections, detectEnemyColorMotionRuns } from '../src/perception-analysis.mjs';
import { classifyWeaponFeature, weaponCatalogMetadata, weaponReferenceFeature } from '../src/weapon-analysis.mjs';

function sample(time, state = 'alive') {
  if (state === 'cross') return { time, saturatedRatio: 0.08, grayRatio: 0.32, diagonalDown: 0.4, diagonalUp: 0.38 };
  if (state === 'unknown') return { time, saturatedRatio: 0.12, grayRatio: 0.12, diagonalDown: 0.05, diagonalUp: 0.06 };
  return { time, saturatedRatio: 0.58, grayRatio: 0.06, diagonalDown: 0.03, diagonalUp: 0.04 };
}

test('detects HUD cross runs and collapses map-screen duplicates', () => {
  const samples = [];
  for (let time = 0; time <= 60; time += 0.25) {
    let state = 'alive';
    if (time >= 20 && time <= 22) state = 'cross';
    if (time > 22 && time < 27) state = 'unknown';
    if (time >= 25 && time <= 25.5) state = 'cross';
    if (time >= 42 && time <= 44) state = 'cross';
    samples.push(sample(time, state));
  }
  const deaths = detectSelfDeaths(samples, { duration: 60, gameplayEnd: 52 });
  assert.deepEqual(deaths.map(death => death.time), [20, 42]);
  assert.equal(deaths[0].end, 27);
  assert.equal(deaths[1].end, 46);
});

test('rejects intermittent cross-like flashes while the player remains alive', () => {
  const samples = [];
  for (let time = 0; time <= 45; time += 0.25) {
    const flash = time === 30 || (time >= 30.75 && time <= 31);
    samples.push(sample(time, flash ? 'cross' : 'alive'));
  }
  assert.deepEqual(detectSelfDeaths(samples, { duration: 45, gameplayEnd: 40 }), []);
});

function battleHudSample(time, teamDead = 1, enemyDead = 0, timerVisible = true) {
  const icon = dead => sample(time, dead ? 'cross' : 'unknown');
  return {
    time,
    timer: timerVisible
      ? { darkRatio: 0.45, whiteRatio: 0.1, edgeRatio: 0.1 }
      : { darkRatio: 0, whiteRatio: 0, edgeRatio: 0 },
    team: Array.from({ length: 4 }, (_, index) => icon(index < teamDead)),
    enemy: Array.from({ length: 4 }, (_, index) => icon(index < enemyDead)),
  };
}

test('detects player advantage, removes isolated flips, and holds through hidden HUD', () => {
  const samples = [];
  for (let time = 10; time < 18; time += 0.25) {
    const second = Math.floor(time);
    const isolatedFlip = second === 11;
    const timerVisible = second <= 12;
    samples.push(battleHudSample(time, isolatedFlip ? 2 : 1, 0, timerVisible));
  }

  const timeline = detectPlayerCounts(samples, { gameplayStart: 10, gameplayEnd: 17 });
  const at11 = timeline.find(state => state.time === 11.5);
  const at17 = timeline.find(state => state.time === 17.5);

  assert.deepEqual([at11.teamAlive, at11.enemyAlive, at11.difference], [3, 4, -1]);
  assert.equal(at17.source, 'held');
  assert.ok(at17.confidence < at11.confidence);
});

test('game count stabilization rejects impossible OCR jumps', () => {
  const samples = [
    { time: 10, left: [{ value: 100, cost: 0.04 }] },
    { time: 11, left: [{ value: 10, cost: 0.01 }, { value: 99, cost: 0.08 }] },
    { time: 12, left: [{ value: 98, cost: 0.07 }] },
    { time: 13, left: [] },
  ];
  const timeline = stabilizeGameCount(samples, 'left', { gameplayStart: 10, gameplayEnd: 13 });
  assert.deepEqual(timeline.map(item => item.value), [100, 99, 98, 98]);
  assert.equal(timeline.at(-1).source, 'held');
});

test('finds the yellow self marker only on a detailed result table', () => {
  const width = 960;
  const height = 540;
  const frame = Buffer.alloc(width * height * 3, 28);
  const paint = (left, top, boxWidth, boxHeight, color) => {
    for (let y = top; y < top + boxHeight; y += 1) {
      for (let x = left; x < left + boxWidth; x += 1) {
        const at = (y * width + x) * 3;
        frame[at] = color[0]; frame[at + 1] = color[1]; frame[at + 2] = color[2];
      }
    }
  };
  for (let y = 150; y < 510; y += 30) paint(500, y, 16, 30, [230, 230, 230]);
  paint(468, 404, 22, 22, [245, 195, 20]);
  const result = findSelfResultRow(frame);
  assert.ok(result);
  assert.equal(result.resultRows, 12);
  assert.equal(result.marker.x, 468);
  assert.equal(result.marker.y, 404);
});

test('selects an observed map frame inside a death review window', () => {
  const width = 960;
  const height = 540;
  const frame = Buffer.alloc(width * height * 3, 20);
  for (let y = 20; y < 520; y += 1) for (let x = 240; x < 720; x += 1) {
    const at = (y * width + x) * 3; frame[at] = 125; frame[at + 1] = 125; frame[at + 2] = 125;
  }
  const map = analyzeMapCandidate(frame, width, height, 12);
  const selected = selectObservedMapFrame([{ time: 3, neutralRatio: 0.02, edgeRatio: 0.01, score: 0.02 }, map], [{ time: 8 }]);
  assert.equal(selected.time, 12);
  assert.equal(selected.source, 'observed-map-screen');
});

test('requires a team marker under the pink map cursor for self-position observations', () => {
  const width = 960;
  const height = 540;
  const frame = Buffer.alloc(width * height * 3, 110);
  const center = { x: 441, y: 342 };
  for (let y = center.y - 16; y <= center.y + 16; y += 1) {
    for (let x = center.x - 16; x <= center.x + 16; x += 1) {
      const distance = Math.hypot(x - center.x, y - center.y);
      if (distance < 9 || distance > 13) continue;
      const at = (y * width + x) * 3;
      frame[at] = 245; frame[at + 1] = 115; frame[at + 2] = 220;
    }
  }
  const cursor = detectMapCursor(frame, width, height);
  assert.ok(cursor);
  assert.ok(Math.abs(cursor.screenX - center.x) <= 3);
  assert.ok(Math.abs(cursor.screenY - center.y) <= 3);

  const selfMarker = { ...cursor, screenX: cursor.screenX + 3, screenY: cursor.screenY + 2, x: cursor.x + 6, y: cursor.y + 4, directionDegrees: 315, confidence: 0.74 };
  const base = { neutralRatio: 0.48, edgeRatio: 0.16, score: 0.42, mapUi: { visible: true }, cursor, allies: [selfMarker] };
  const observations = detectSpatialObservations([
    { ...base, time: 12 }, { ...base, time: 13 },
    { ...base, time: 40, cursor: { ...cursor, x: cursor.x + 80, y: cursor.y - 20 }, allies: [{ ...selfMarker, x: selfMarker.x + 80, y: selfMarker.y - 20 }] },
  ]);
  assert.equal(observations.length, 2);
  assert.equal(observations[0].source, 'observed-map-self-marker-under-cursor');
  assert.equal(observations[0].directionDegrees, 315);
});

test('separates observed route anchors, inferred gaps, and short predictions', () => {
  const observations = [
    { time: 10, x: 200, y: 600, confidence: 0.8 },
    { time: 20, x: 300, y: 550, confidence: 0.75 },
  ];
  const route = buildPlayerRoute(observations);
  assert.equal(route[0].source, 'observed');
  assert.equal(route.find(point => point.time === 15).source, 'inferred-between-observations');
  assert.equal(route.at(-1).source, 'observed');
  const [prediction] = buildShortPredictions(observations);
  assert.equal(prediction.source, 'predicted-from-observed-motion');
  assert.equal(prediction.expiresAt, 26);
  assert.ok(prediction.frames.at(-1).confidence < prediction.frames[0].confidence);
});

test('detects an ally marker from its blue ring, dark weapon shape, and white direction pointer', () => {
  const width = 960;
  const height = 540;
  const frame = Buffer.alloc(width * height * 3, 105);
  const paint = (x, y, color) => {
    const at = (y * width + x) * 3;
    frame[at] = color[0]; frame[at + 1] = color[1]; frame[at + 2] = color[2];
  };
  const center = { x: 360, y: 320 };
  for (let y = center.y - 24; y <= center.y + 24; y += 1) {
    for (let x = center.x - 24; x <= center.x + 24; x += 1) {
      const distance = Math.hypot(x - center.x, y - center.y);
      if (distance <= 12) paint(x, y, x < center.x - 8 ? [25, 25, 30] : [25, 35, 175]);
      else if (distance >= 16 && distance <= 22) paint(x, y, [22, 30, 165]);
    }
  }
  for (let y = center.y - 5; y <= center.y + 5; y += 1) {
    for (let x = center.x + 24; x <= center.x + 34; x += 1) paint(x, y, [225, 225, 225]);
  }
  const allies = detectMapAllies(frame, width, height);
  assert.equal(allies.length, 1);
  assert.ok(Math.abs(allies[0].screenX - center.x) <= 3);
  assert.ok(Math.abs(allies[0].screenY - center.y) <= 3);
  assert.equal(allies[0].directionDegrees, 0);
});

test('removes repeated static map icons and predicts an ally from the observed facing direction', () => {
  const staticMarker = { x: 150, y: 850, directionDegrees: 0, confidence: 0.7, evidence: { innerWhiteRatio: 0.22 } };
  const samples = [10, 20, 30].map((time, index) => ({
    time,
    neutralRatio: 0.48,
    mapUi: { visible: true },
    allies: [staticMarker, { x: 300 + index * 60, y: 600 - index * 20, directionDegrees: 330, confidence: 0.75, evidence: { innerWhiteRatio: 0.08 } }],
  }));
  const tracks = detectAllyTracks(samples);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].frames.length, 3);
  const predictions = buildEntityPredictions(tracks);
  assert.equal(predictions.length, 3);
  assert.equal(predictions[0].team, 'ally');
  assert.ok(predictions[0].frames.at(-1).x > predictions[0].frames[0].x);
});

test('represents a grounded enemy hypothesis as an expanding uncertainty zone instead of an observed position', () => {
  const zones = buildEnemyThreatZones(
    [{ id: 'death-1', time: 40, confidence: 0.95 }],
    [{ id: 'self-map-1', time: 44, x: 420, y: 610, confidence: 0.7 }],
  );
  assert.equal(zones.length, 1);
  assert.equal(zones[0].type, 'uncertainty-zone');
  assert.equal(zones[0].source, 'predicted-near-self-death-location');
  assert.equal(zones[0].evidence.positionDelay, 4);
  assert.ok(zones[0].frames.at(-1).radius > zones[0].frames[0].radius);
  assert.ok(zones[0].frames.at(-1).confidence < zones[0].frames[0].confidence);
  assert.deepEqual(buildEnemyThreatZones([{ id: 'death-2', time: 10 }], [{ time: 30, x: 1, y: 1 }]), []);
});

test('removes only human-verified false death windows', () => {
  const deaths = [{ time: 35.5 }, { time: 95.25 }, { time: 123.25 }];
  assert.deepEqual(
    applyVerifiedDeathWindows(deaths, { ignoredDeathWindows: [[30, 45]] }).map(death => death.time),
    [95.25, 123.25],
  );
});

test('does not suppress the verified self death around 00:33', () => {
  const override = verifiedAnalysis('2026-08-08 15-20-32.mp4', 1);
  const deaths = [{ time: 33.25, evidence: { detector: 'self-hud-cross' } }];
  assert.deepEqual(applyVerifiedDeathWindows(deaths, override).map(death => death.time), [33.25]);
});

test('attaches respawn countdown evidence to the matching HUD death', () => {
  const [death] = attachRespawnEvidence(
    [{ time: 95, end: 101, confidence: 0.8, evidence: { detector: 'self-hud-cross' } }],
    [{ time: 100, confidence: 0.95, evidence: { detector: 'respawn-countdown-ui', variant: 'normal' } }],
  );
  assert.equal(death.evidence.respawn.detector, 'respawn-countdown-ui');
  assert.equal(death.evidence.timing.respawnUiDelay, 5);
  assert.equal(death.evidence.timing.timestampSource, 'self-hud-cross');
  assert.equal(death.time, 95);
  assert.equal(death.confidence, 0.95);
});

test('uses the first respawn UI frame when the self HUD was hidden', () => {
  const [death] = attachRespawnEvidence([], [
    { time: 42.25, end: 46, duration: 3.75, confidence: 0.94, type: 'death', title: '自分がデス', evidence: { detector: 'respawn-countdown-ui', variant: 'tacticooler' } },
  ]);
  assert.equal(death.time, 42.25);
  assert.equal(death.evidence.timing.timestampSource, 'respawn-ui-fallback');
  assert.equal(death.evidence.timing.hudDetectedAt, null);
});

test('uses earlier respawn evidence when the HUD cross appears after a map screen', () => {
  const [death] = attachRespawnEvidence(
    [{ time: 50, end: 56, confidence: 0.8, evidence: { detector: 'self-hud-cross' } }],
    [{ time: 48.5, end: 52, duration: 3.5, confidence: 0.94, type: 'death', title: '自分がデス', evidence: { detector: 'respawn-countdown-ui' } }],
  );
  assert.equal(death.time, 48.5);
  assert.equal(death.evidence.timing.timestampSource, 'respawn-ui-fallback');
  assert.equal(death.evidence.timing.respawnUiDelay, 0);
});

test('creates a bounded death-camera focus candidate only when respawn evidence confirms the window', () => {
  const detections = buildDeathCameraDetections([
    { id: 'death-1', time: 30, confidence: 0.95, evidence: { timing: { respawnUiDetectedAt: 32 } } },
    { id: 'death-2', time: 60, confidence: 0.7, evidence: { timing: { respawnUiDetectedAt: null } } },
  ]);
  assert.equal(detections.length, 1);
  assert.equal(detections[0].kind, 'death-camera-focus-candidate');
  assert.equal(detections[0].weapon, null);
  assert.equal(detections[0].evidence.limitation, 'focus-area-not-object-bounding-box');
  assert.deepEqual(detections[0].frames[0].slice(1), [0.22, 0.17, 0.56, 0.68]);
});

test('requires a moving enemy-color candidate in consecutive frames', () => {
  const width = 480;
  const height = 270;
  const blank = Buffer.alloc(width * height * 3, 20);
  const orangeFrame = offset => {
    const frame = Buffer.from(blank);
    for (let y = 95; y < 145; y += 1) {
      for (let x = 190 + offset; x < 218 + offset; x += 1) {
        const at = (y * width + x) * 3;
        frame[at] = 220;
        frame[at + 1] = 105;
        frame[at + 2] = 35;
      }
    }
    return frame;
  };
  const first = orangeFrame(0);
  const second = orangeFrame(9);
  const samples = [
    analyzeEnemyColorFrame(first, blank, width, height, 1),
    analyzeEnemyColorFrame(second, first, width, height, 1.5),
  ];
  const detections = detectEnemyColorMotionRuns(samples, [{ id: 'death-1', time: 2 }]);
  assert.equal(detections.length, 1);
  assert.equal(detections[0].kind, 'enemy-color-motion-candidate');
  assert.equal(detections[0].frames.length, 2);
  assert.equal(detectEnemyColorMotionRuns(samples.slice(0, 1), [{ id: 'death-1', time: 2 }]).length, 0);
});

test('projects a video enemy candidate as an explicitly uncertain map prediction', () => {
  const route = Array.from({ length: 21 }, (_, time) => ({ time, x: 300 + time * 5, y: 500, confidence: 0.7 }));
  const detections = [{
    id: 'enemy-color-motion-1', kind: 'enemy-color-motion-candidate', confidence: 0.6,
    frames: [[10, 0.45, 0.3, 0.1, 0.2], [10.5, 0.5, 0.3, 0.1, 0.22]],
  }];
  const predictions = buildEnemySightPredictions(detections, route);
  assert.equal(predictions.length, 1);
  assert.equal(predictions[0].team, 'enemy');
  assert.equal(predictions[0].source, 'predicted-from-video-candidate-and-self-route-heading');
  assert.equal(predictions[0].frames.length, 5);
  assert.equal(predictions[0].frames[0].radius, 85);
  assert.ok(predictions[0].confidence <= 0.28);
  assert.equal(predictions[0].evidence.routeHeadingAssumption, true);
  const facingRoute = route.map(point => ({ ...point, source: point.time === 10 ? 'observed' : 'inferred-between-observations', directionDegrees: point.time === 10 ? 270 : null }));
  const [facingPrediction] = buildEnemySightPredictions(detections, facingRoute);
  assert.equal(facingPrediction.evidence.headingSource, 'nearby-observed-map-facing-direction');
  assert.equal(facingPrediction.evidence.routeHeadingAssumption, false);
  assert.deepEqual(buildEnemySightPredictions(detections, route.slice(0, 5)), []);
});

test('identifies an exact result weapon template from the bundled catalog', () => {
  assert.ok(weaponCatalogMetadata.count >= 170);
  const reference = weaponReferenceFeature('Charger_Light_00');
  const result = classifyWeaponFeature(reference);
  assert.equal(result.status, 'identified');
  assert.equal(result.id, 'Charger_Light_00');
  assert.equal(result.name, '14式竹筒銃・甲');
  assert.equal(result.distance, 0);
});
