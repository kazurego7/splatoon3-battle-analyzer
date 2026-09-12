import { EventEmitter } from 'node:events';
import { analyzeBattleHudFrame, analyzeRespawnHudFrame, analyzeRgbFrame } from './ffmpeg.mjs';
import { chooseIntroBoundary } from './intro-boundary.mjs';
import { analyzePersonalResultFrame, detectResultScreen } from './result-analysis.mjs';
import { analyzeOutcomeFrame } from './outcome-analysis.mjs';
import { analyzeEnemyColorFrame } from './perception-analysis.mjs';
import { analyzeGameCountFrame } from './game-count-vision.mjs';
import { analyzeMapCandidate } from './map-analysis.mjs';

export function liveResultScreenType({ personalResult, result, resultAlreadyConfirmed = false }) {
  return personalResult || (resultAlreadyConfirmed && result?.screenType === 'personal') ? 'personal' : null;
}

export function stablePersonalResultPair(results) {
  const [previous, current] = (results || []).slice(-2);
  return Boolean(previous && current
    && previous.killCount === current.killCount
    && previous.deathCount === current.deathCount);
}

export class LiveMatchStateMachine extends EventEmitter {
  constructor() {
    super();
    this.active = null;
    this.matches = [];
    this.introObservations = [];
    this.personalRun = [];
    this.nonPersonalAfterResult = 0;
  }

  observeIntro(observation) {
    this.introObservations.push(observation);
    this.introObservations = this.introObservations.filter(item => item.time >= observation.time - 8);
    if (this.active) return this.active;
    // Coarse frames normally arrive at 2 Hz, but allow one dropped sample
    // without losing the same stable intro boundary used by batch analysis.
    const start = chooseIntroBoundary(this.introObservations, { interval: 1 });
    if (start == null) return null;
    const match = {
      number: this.matches.length + 1,
      start,
      activeEnd: null,
      end: null,
      status: 'analyzing',
      resultBoundary: null,
    };
    this.active = match;
    this.personalRun = [];
    this.nonPersonalAfterResult = 0;
    this.emit('match-start', structuredClone(match));
    return match;
  }

  observeOutcome(observation) {
    if (!this.active || !observation) return;
    this.active.activeEnd ??= observation.time;
  }

  observeResult(observation) {
    if (!this.active) return null;
    if (observation?.screenType === 'personal') {
      const previous = this.personalRun.at(-1);
      if (previous && observation.time - previous.time > 0.375) this.personalRun = [];
      this.personalRun.push(observation);
      this.nonPersonalAfterResult = 0;
      if (this.personalRun.length >= 2 && !this.active.resultBoundary) {
        const detectedAt = this.personalRun.at(-1).time;
        this.active.resultBoundary = {
          screenType: 'personal',
          detectedAt,
          detection: 'stable-personal-result-live',
        };
        this.active.end = Number((detectedAt + 0.5).toFixed(3));
        this.active.status = 'finalizing';
        this.emit('result-detected', structuredClone(this.active));
      } else if (this.active.resultBoundary) {
        this.active.resultBoundary.detectedAt = observation.time;
        this.active.end = Number((observation.time + 0.5).toFixed(3));
      }
      return this.active;
    }
    if (!this.active.resultBoundary) {
      this.personalRun = [];
      return this.active;
    }
    this.nonPersonalAfterResult += 1;
    if (this.nonPersonalAfterResult < 2) return this.active;
    const completed = {
      ...this.active,
      activeEnd: this.active.activeEnd ?? this.active.resultBoundary.detectedAt,
      status: 'ready',
    };
    this.matches.push(completed);
    this.active = null;
    this.personalRun = [];
    this.nonPersonalAfterResult = 0;
    this.emit('match-finalized', structuredClone(completed));
    return completed;
  }
}

export class LiveAnalysisCollector extends EventEmitter {
  constructor() {
    super();
    this.machine = new LiveMatchStateMachine();
    this.previousCoarse = null;
    this.previousPerception = null;
    this.personalResultRun = [];
    this.samples = new Map();
    for (const event of ['match-start', 'result-detected', 'match-finalized']) {
      this.machine.on(event, match => {
        if (event === 'match-start') this.personalResultRun = [];
        this.emit(event, match);
      });
    }
  }

  matchSamples(number) {
    if (!this.samples.has(number)) this.samples.set(number, {
      coarse: [], battleHud: [], respawn: [], perception: [], map: [], scoreCount: [], objectiveCount: [], outcomes: [], personalResults: [],
    });
    return this.samples.get(number);
  }

  relativeTime(time) {
    const match = this.machine.active;
    return match && time >= match.start ? Number((time - match.start).toFixed(3)) : null;
  }

  acceptCoarse(frame, time) {
    const observation = analyzeRgbFrame(frame, this.previousCoarse, 160, 90, time);
    this.previousCoarse = frame;
    this.machine.observeIntro(observation);
    if (this.machine.active && time >= this.machine.active.start) {
      this.matchSamples(this.machine.active.number).coarse.push({ ...observation, time: this.relativeTime(time) });
    }
    return observation;
  }

  acceptBattleHud(frame, time) {
    const relative = this.relativeTime(time);
    if (relative == null) return null;
    const sample = analyzeBattleHudFrame(frame, relative);
    this.matchSamples(this.machine.active.number).battleHud.push(sample);
    return sample;
  }

  acceptRespawn(frame, time) {
    const relative = this.relativeTime(time);
    if (relative == null) return null;
    const sample = analyzeRespawnHudFrame(frame, 220, 60, relative);
    this.matchSamples(this.machine.active.number).respawn.push(sample);
    return sample;
  }

  acceptFull(frame, time) {
    const result = detectResultScreen(frame, time);
    const personalResult = result ? analyzePersonalResultFrame(frame, time) : null;
    const outcome = analyzeOutcomeFrame(frame, 960, 540, time);
    if (outcome) {
      this.machine.observeOutcome(outcome);
      if (this.machine.active) this.matchSamples(this.machine.active.number).outcomes.push(outcome);
    }
    if (this.machine.active && Math.round(time * 4) % 2 === 0) {
      const relative = this.relativeTime(time);
      this.matchSamples(this.machine.active.number).map.push(analyzeMapCandidate(frame, 960, 540, relative));
    }
    if (this.machine.active && personalResult) {
      this.matchSamples(this.machine.active.number).personalResults.push({ ...personalResult, time: this.relativeTime(time) });
      const previous = this.personalResultRun.at(-1);
      if (previous && time - previous.absoluteTime > 0.625) this.personalResultRun = [];
      this.personalResultRun.push(personalResult);
      this.personalResultRun = this.personalResultRun.slice(-4);
    }
    // Do not make a match reviewable until the same frame has yielded the
    // required K/D result.
    // This prevents a structurally similar result screen from publishing an
    // apparently complete analysis with missing player stats.
    const resultAlreadyConfirmed = Boolean(this.machine.active?.resultBoundary);
    this.machine.observeResult({
      time,
      // K/D OCR is required to publish the result initially. Once confirmed,
      // keep following the same structural result-screen detector as batch
      // analysis so transition frames preserve an identical clip end.
      screenType: liveResultScreenType({
        personalResult: !resultAlreadyConfirmed && stablePersonalResultPair(this.personalResultRun) ? personalResult : null,
        result,
        resultAlreadyConfirmed,
      }),
      confidence: personalResult?.confidence ?? null,
    });
    return { result, personalResult, outcome };
  }

  acceptPerception(frame, time) {
    const relative = this.relativeTime(time);
    if (relative == null) return null;
    const sample = analyzeEnemyColorFrame(frame, this.previousPerception, 480, 270, relative);
    this.previousPerception = frame;
    this.matchSamples(this.machine.active.number).perception.push(sample);
    return sample;
  }

  acceptScoreCount(frame, time) {
    const relative = this.relativeTime(time);
    if (relative == null) return null;
    const sample = analyzeGameCountFrame(frame, 380, relative, { rule: 'エリア' });
    this.matchSamples(this.machine.active.number).scoreCount.push(sample);
    return sample;
  }

  acceptObjectiveCount(frame, time) {
    const relative = this.relativeTime(time);
    if (relative == null) return null;
    const sample = analyzeGameCountFrame(frame, 1000, relative, { rule: 'ヤグラ' });
    this.matchSamples(this.machine.active.number).objectiveCount.push(sample);
    return sample;
  }
}
