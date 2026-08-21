import fs from 'node:fs/promises';
import path from 'node:path';
import { ANALYSIS_ROOT, ANALYTICS_STATE_FILE } from './paths.mjs';

const STATE_VERSION = 2;

function clampNumber(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : null;
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeWeaponList(value, maximum) {
  return Array.isArray(value)
    ? value.map(normalizeText).filter(Boolean).slice(0, maximum)
    : [];
}

export function recordedAtFromFileName(fileName, offsetSeconds = 0) {
  const match = String(fileName || '').match(/(\d{4})-(\d{2})-(\d{2})[ _](\d{2})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6]) + Math.max(0, Number(offsetSeconds) || 0),
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function advantageSummary(playerCounts = []) {
  let advantageSeconds = 0;
  let disadvantageSeconds = 0;
  let evenSeconds = 0;
  let maximumAdvantage = 0;
  let maximumDisadvantage = 0;
  for (let index = 0; index < playerCounts.length; index += 1) {
    const point = playerCounts[index];
    const next = playerCounts[index + 1];
    const seconds = Math.max(0, Math.min(2, (next?.time ?? point.time + 1) - point.time));
    const difference = Number(point.difference) || 0;
    if (difference > 0) advantageSeconds += seconds;
    else if (difference < 0) disadvantageSeconds += seconds;
    else evenSeconds += seconds;
    maximumAdvantage = Math.max(maximumAdvantage, difference);
    maximumDisadvantage = Math.max(maximumDisadvantage, -difference);
  }
  return {
    advantageSeconds: Number(advantageSeconds.toFixed(1)),
    disadvantageSeconds: Number(disadvantageSeconds.toFixed(1)),
    evenSeconds: Number(evenSeconds.toFixed(1)),
    maximumAdvantage,
    maximumDisadvantage,
  };
}

function countSummary(gameCounts = []) {
  const observed = gameCounts.filter(point => point.teamSource === 'observed' || point.enemySource === 'observed');
  const final = observed.at(-1) || gameCounts.at(-1) || null;
  return {
    teamCount: final?.teamCount ?? null,
    enemyCount: final?.enemyCount ?? null,
    maximumTeamPenalty: gameCounts.reduce((maximum, point) => Math.max(maximum, Number(point.teamPenalty) || 0), 0),
    maximumEnemyPenalty: gameCounts.reduce((maximum, point) => Math.max(maximum, Number(point.enemyPenalty) || 0), 0),
    observedPoints: observed.length,
  };
}

export function deriveMatchAnalytics(analysis, { recording, match }) {
  const events = Array.isArray(analysis.events) ? analysis.events : [];
  const deaths = events.filter(event => event.type === 'death');
  const personalResultDeaths = clampNumber(analysis.playerStats?.deaths, 0, 99);
  const validatedDeaths = clampNumber(analysis.validation?.deaths?.expected, 0, 99);
  const weapon = analysis.playerIdentity?.weapon;
  const reliableWeapon = weapon?.name && weapon.status !== 'candidate-only' ? {
    id: weapon.id || null,
    name: weapon.name,
    confidence: clampNumber(weapon.confidence, 0, 1) ?? 0,
    source: weapon.source || null,
  } : null;
  const weaponRoster = analysis.weaponRoster;
  const reliableRoster = weaponRoster?.source === 'opening-battle-hud-codex-vision-with-wikiwiki-reference-sheets' ? {
    modelVersion: weaponRoster.modelVersion,
    catalogVersion: weaponRoster.catalogVersion,
    source: weaponRoster.source,
    confidence: clampNumber(weaponRoster.confidence, 0, 1),
    complete: weaponRoster.complete === true,
    openingTimes: Array.isArray(weaponRoster.openingTimes) ? weaponRoster.openingTimes : [],
    allyWeapons: normalizeWeaponList(weaponRoster.allyWeapons, 3),
    enemyWeapons: normalizeWeaponList(weaponRoster.enemyWeapons, 4),
  } : null;
  return {
    id: analysis.matchId || match.id,
    recordingId: analysis.recordingId || recording.id,
    matchNumber: match.number,
    recordingFileName: recording.fileName || analysis.source?.fileName || null,
    recordedAt: recordedAtFromFileName(recording.fileName || analysis.source?.fileName, match.start ?? analysis.source?.start),
    sourceUpdatedAt: analysis.generatedAt || recording.updatedAt || null,
    analysisUrl: match.analysisUrl || null,
    videoUrl: match.videoUrl || null,
    thumbnailUrl: match.thumbnailUrl || null,
    stage: analysis.stageMap?.stage || null,
    rule: analysis.stageMap?.rule || null,
    outcome: analysis.outcome?.value || null,
    outcomeConfidence: clampNumber(analysis.outcome?.confidence, 0, 1),
    durationSeconds: clampNumber(analysis.media?.duration ?? match.duration, 0, 7200),
    selfWeapon: reliableWeapon,
    roster: reliableRoster,
    deathCount: personalResultDeaths ?? validatedDeaths ?? deaths.length,
    playerStats: analysis.playerStats || {
      kills: null,
      deaths: validatedDeaths ?? deaths.length,
    },
    detectedDeathCount: deaths.length,
    ...advantageSummary(analysis.gameFlow?.playerCounts),
    ...countSummary(analysis.gameFlow?.gameCounts),
    resultTime: clampNumber(analysis.playerIdentity?.resultTime ?? analysis.validation?.deaths?.resultTime, 0, analysis.media?.duration || 7200),
    coverage: {
      stage: Boolean(analysis.stageMap?.stage),
      rule: Boolean(analysis.stageMap?.rule),
      outcome: Boolean(analysis.outcome?.value),
      selfWeapon: Boolean(reliableWeapon),
      roster: Boolean(reliableRoster?.complete),
    },
  };
}

export function effectiveAnalyticsRecord(record) {
  const automatic = record.automatic || {};
  const overrides = record.overrides || {};
  const selfWeaponName = normalizeText(overrides.selfWeapon) || automatic.selfWeapon?.name || null;
  const allyWeapons = Object.hasOwn(overrides, 'allyWeapons')
    ? normalizeWeaponList(overrides.allyWeapons, 3)
    : normalizeWeaponList(automatic.roster?.allyWeapons, 3);
  const enemyWeapons = Object.hasOwn(overrides, 'enemyWeapons')
    ? normalizeWeaponList(overrides.enemyWeapons, 4)
    : normalizeWeaponList(automatic.roster?.enemyWeapons, 4);
  const manuallyCompleteRoster = Object.hasOwn(overrides, 'allyWeapons') && Object.hasOwn(overrides, 'enemyWeapons')
    && allyWeapons.length === 3 && enemyWeapons.length === 4;
  const effective = {
    ...automatic,
    stage: normalizeText(overrides.stage) || automatic.stage || null,
    rule: normalizeText(overrides.rule) || automatic.rule || null,
    outcome: ['win', 'lose'].includes(overrides.outcome) ? overrides.outcome : automatic.outcome || null,
    selfWeapon: selfWeaponName,
    allyWeapons,
    enemyWeapons,
    deathCount: Number.isInteger(Number(overrides.deathCount)) ? Number(overrides.deathCount) : automatic.deathCount,
    manualFields: Object.keys(overrides),
    updatedAt: record.updatedAt,
    editable: true,
    source: { kind: 'video-analysis' },
  };
  effective.coverage = {
    stage: Boolean(effective.stage),
    rule: Boolean(effective.rule),
    outcome: Boolean(effective.outcome),
    selfWeapon: Boolean(effective.selfWeapon),
    roster: manuallyCompleteRoster || automatic.roster?.complete === true,
  };
  effective.analyticsStatus = effective.stage && effective.rule && effective.outcome ? 'ready' : 'partial';
  return effective;
}

export class MatchAnalyticsService {
  constructor(recordingStore, { stateFile = ANALYTICS_STATE_FILE } = {}) {
    this.recordingStore = recordingStore;
    this.stateFile = stateFile;
    this.state = { version: STATE_VERSION, updatedAt: null, records: [] };
    this.status = { running: false, phase: 'idle', completed: 0, total: 0, errors: 0, lastRunAt: null };
    this.writeChain = Promise.resolve();
    this.running = null;
    this.timer = null;
  }

  async load() {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    try {
      const value = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
      if (Array.isArray(value.records)) {
        this.state = { version: STATE_VERSION, updatedAt: value.updatedAt || null, records: value.records };
        if (value.version !== STATE_VERSION) await this.save();
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.save();
    }
  }

  list() {
    return this.state.records
      .map(effectiveAnalyticsRecord)
      .sort((left, right) => String(right.recordedAt || '').localeCompare(String(left.recordedAt || '')));
  }

  publicStatus() {
    return {
      ...this.status,
      updatedAt: this.state.updatedAt,
      records: this.list().length,
      videoRecords: this.state.records.length,
    };
  }

  async save() {
    this.state.updatedAt = new Date().toISOString();
    this.writeChain = this.writeChain.then(async () => {
      const temporary = `${this.stateFile}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
      await fs.rename(temporary, this.stateFile);
    });
    return this.writeChain;
  }

  schedule() {
    if (this.running) return this.running;
    this.running = this.refresh().finally(() => { this.running = null; });
    return this.running;
  }

  start() {
    void this.schedule();
    this.timer ||= setInterval(() => { void this.schedule(); }, 30_000);
  }

  async refresh() {
    const jobs = this.recordingStore.list().flatMap(recording => (recording.matches || [])
      .filter(match => match.analysisUrl)
      .map(match => ({ recording, match })));
    Object.assign(this.status, { running: true, phase: 'collecting', completed: 0, total: jobs.length, errors: 0 });
    const existingById = new Map(this.state.records.map(record => [record.id, record]));
    const nextById = new Map();
    for (const { recording, match } of jobs) {
      try {
        const analysisName = path.basename(match.analysisUrl);
        const analysis = JSON.parse(await fs.readFile(path.join(ANALYSIS_ROOT, recording.id, analysisName), 'utf8'));
        const automatic = deriveMatchAnalytics(analysis, { recording, match });
        const existing = existingById.get(automatic.id);
        const record = {
          version: STATE_VERSION,
          id: automatic.id,
          automatic,
          overrides: existing?.overrides || {},
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        nextById.set(record.id, record);
      } catch (error) {
        this.status.errors += 1;
        console.error(`Analytics collection failed for ${match.id}:`, error.message);
      }
      this.status.completed += 1;
      if (this.status.completed % 5 === 0) {
        this.state.records = [...nextById.values()];
        await this.save();
      }
    }
    this.state.records = [...nextById.values()];
    await this.save();
    Object.assign(this.status, { running: false, phase: 'idle', lastRunAt: new Date().toISOString() });
    return this.list();
  }

  async updateOverrides(id, input) {
    const record = this.state.records.find(item => item.id === id);
    if (!record) throw new Error('分析対象の試合が見つかりません');
    const next = { ...(record.overrides || {}) };
    for (const key of ['stage', 'rule', 'outcome', 'selfWeapon']) {
      if (!Object.hasOwn(input, key)) continue;
      const value = normalizeText(input[key]);
      if (value) next[key] = value;
      else delete next[key];
    }
    for (const [key, maximum] of [['allyWeapons', 3], ['enemyWeapons', 4]]) {
      if (!Object.hasOwn(input, key)) continue;
      const values = normalizeWeaponList(input[key], maximum);
      if (values.length) next[key] = values;
      else delete next[key];
    }
    if (Object.hasOwn(input, 'deathCount')) {
      const value = clampNumber(input.deathCount, 0, 99);
      if (value != null) next.deathCount = Math.round(value);
      else delete next.deathCount;
    }
    record.overrides = next;
    record.updatedAt = new Date().toISOString();
    await this.save();
    return effectiveAnalyticsRecord(record);
  }
}
