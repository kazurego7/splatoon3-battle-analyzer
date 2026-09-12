import { attachRespawnEvidence } from './analysis-overrides.mjs';
import { describeSelfDeaths, detectGameplayStart, detectPlayerCounts, detectSelfDeaths } from './battle-analysis.mjs';
import { detectGameCounts, inferGameCountRuleFromSamples } from './game-count-vision.mjs';
import { stabilizeMapVisibility } from './map-analysis.mjs';
import { buildDeathCameraDetections, detectEnemyColorMotionRuns } from './perception-analysis.mjs';
import { detectRespawnRuns } from './respawn-vision.mjs';
import { consolidateOutcomeObservations } from './outcome-analysis.mjs';
import { chooseDeathCandidateSet, reconcileDeathsWithResult } from './result-analysis.mjs';

function modeResult(results) {
  const groups = new Map();
  for (const result of results || []) {
    const key = `${result.killCount}:${result.deathCount}`;
    const group = groups.get(key) || [];
    group.push(result);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => right.length - left.length || right[0].confidence - left[0].confidence)[0]?.[0] || null;
}

export function finalizeLiveMatchAnalysis({ recording, media, match, samples }) {
  const duration = match.end - match.start;
  const activeEnd = match.activeEnd ?? match.resultBoundary?.detectedAt ?? match.end;
  const gameplayEnd = Math.max(0, activeEnd - match.start);
  const personalResult = modeResult(samples.personalResults);
  const gameplayStart = detectGameplayStart(samples.battleHud, { gameplayEnd });
  const respawnRuns = detectRespawnRuns(samples.respawn, { gameplayStart, gameplayEnd });
  const slotCandidates = (samples.battleHud[0]?.team || []).map((_, slot) => {
    const selfHud = samples.battleHud.map(sample => ({ time: sample.time, ...sample.team[slot] }));
    return { slot, deaths: attachRespawnEvidence(detectSelfDeaths(selfHud, { duration, gameplayStart, gameplayEnd }), respawnRuns) };
  });
  const selected = chooseDeathCandidateSet(slotCandidates, personalResult?.deathCount);
  const deathCandidates = selected?.deaths || respawnRuns;
  const deaths = reconcileDeathsWithResult(deathCandidates, personalResult?.deathCount);
  const mapCandidates = stabilizeMapVisibility(samples.map);
  const hiddenTimes = mapCandidates.filter(sample => sample.mapUi?.visible).map(sample => sample.time);
  const playerCounts = detectPlayerCounts(samples.battleHud, { gameplayStart, gameplayEnd, hiddenTimes });
  const detections = [
    ...buildDeathCameraDetections(deaths),
    ...detectEnemyColorMotionRuns(samples.perception, deaths),
  ].sort((left, right) => left.frames[0][0] - right.frames[0][0]);
  const events = describeSelfDeaths(deaths, { detections, playerCounts });
  const outcome = consolidateOutcomeObservations(samples.outcomes);
  const countProfile = inferGameCountRuleFromSamples(samples.scoreCount, { gameplayStart });
  const gameCountSamples = countProfile.profile === 'score-card' ? samples.scoreCount : samples.objectiveCount;
  const gameCounts = detectGameCounts(gameCountSamples, { gameplayStart, gameplayEnd, hiddenTimes, rule: countProfile.rule });
  return {
    version: 29,
    recordingId: recording.id,
    matchId: match.id,
    generatedAt: new Date().toISOString(),
    source: { fileName: recording.fileName, start: match.start, end: match.end, preserved: true },
    media: { duration, codec: media?.codec || null, width: media?.width || 1920, height: media?.height || 1080, fps: media?.fps || 60 },
    events,
    deathAnalysis: null,
    deathAnalysisState: { status: 'idle' },
    series: samples.coarse.map(sample => ({ time: sample.time, motion: Number(sample.difference?.toFixed(2) || 0), hud: Number(sample.gameScore?.toFixed(3) || 0), gameplay: sample.gameplay })),
    gameFlow: { deaths: { self: deaths.map(death => [death.time, death.duration]) }, playerCounts, gameCounts },
    playerStats: personalResult ? { kills: personalResult.killCount, deaths: personalResult.deathCount, source: personalResult.source, confidence: personalResult.confidence } : null,
    playerIdentity: { status: 'unconfirmed', method: selected ? 'result-count-and-respawn-match' : 'personal-result-not-found', hudSlot: selected?.slot ?? null, confidence: selected?.countDistance === 0 ? 0.65 : 0, weapon: null },
    weaponRoster: null,
    outcome,
    validation: { deaths: { expected: personalResult?.deathCount ?? null, observed: deaths.length, candidates: deathCandidates.length, gameplayStart, gameplayStartSource: 'stable-match-timer-hud', source: personalResult?.source || 'personal-result-not-found', resultTime: personalResult?.time ?? null, matched: personalResult ? personalResult.deathCount === deaths.length : null } },
    stageMap: null,
    capabilities: {
      segmentation: 'automatic-hud-heuristic-live',
      deaths: personalResult?.deathCount === deaths.length ? 'result-count-validated-hud-and-respawn-timing-fusion' : 'unavailable-death-candidates-do-not-match-result',
      deathExplanation: 'automatic-fallback', deathSequenceAnalysis: 'available-on-demand',
      playerCounts: 'automatic-battle-hud', matchOutcome: outcome ? 'automatic-post-match-win-lose-announcement' : 'unavailable-post-match-announcement-not-found',
      gameCountOcr: `automatic-multi-threshold-hud-ocr-${countProfile.rule}`, reanalysis: 'preserved-original-recording',
    },
  };
}
