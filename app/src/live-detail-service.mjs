import fs from 'node:fs/promises';
import path from 'node:path';
import { ANALYSIS_ROOT, WORK_ROOT } from './paths.mjs';
import { analyzeRecordingPersonalResults } from './personal-result-analysis.mjs';
import { analyzeRecordingWeaponRosters } from './weapon-roster-analysis.mjs';

export function missingDetails(analysis) {
  return !analysis.stageMap?.stage || !analysis.stageMap?.rule || !analysis.playerIdentity?.weapon?.name || !analysis.weaponRoster?.complete;
}

export class LiveDetailService {
  constructor(store, { analysisRoot = ANALYSIS_ROOT, workRoot = WORK_ROOT, personal = analyzeRecordingPersonalResults, rosters = analyzeRecordingWeaponRosters } = {}) {
    Object.assign(this, { store, analysisRoot, workRoot, personal, rosters });
  }
  start() {
    this.timer ||= setInterval(() => { void this.tick(); }, 60_000);
    void this.tick();
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      for (const recording of this.store.list()) {
        if (recording.live || recording.status !== 'ready') continue;
        for (const match of recording.matches || []) {
          if (match.status !== 'ready' || !match.sourceVideoUrl) continue;
          const file = path.join(this.analysisRoot, recording.id, `match-${String(match.number).padStart(2, '0')}.json`);
          try {
            const analysis = JSON.parse(await fs.readFile(file, 'utf8'));
            const job = analysis.detailEnrichment || {};
            if (!missingDetails(analysis) || (job.attempts || 0) >= 3 || Date.parse(job.nextAttemptAt) > Date.now()) continue;
            await this.enrich(recording, match, file, analysis);
          } catch (error) { console.warn(`Automatic match details ${recording.id}/${match.number}: ${error.message}`); }
        }
      }
    } finally { this.running = false; }
  }
  async patch(file, patch) {
    const latest = JSON.parse(await fs.readFile(file, 'utf8'));
    patch(latest);
    const temporary = `${file}.details.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(latest, null, 2) + '\n');
    await fs.rename(temporary, file);
  }
  async enrich(recording, match, file, analysis) {
    const attempts = (analysis.detailEnrichment?.attempts || 0) + 1;
    const workDir = path.join(this.workRoot, recording.id, 'automatic-details', `match-${match.number}`);
    await this.patch(file, value => { value.detailEnrichment = { status: 'running', attempts, nextAttemptAt: new Date(Date.now() + 3600_000).toISOString() }; });
    try {
      if (!analysis.stageMap?.stage || !analysis.stageMap?.rule || !analysis.playerIdentity?.weapon?.name) {
        const time = analysis.validation?.deaths?.resultTime;
        const results = await this.personal({ source: recording.source, segments: [{ ...match, resultBoundary: { detectedAt: Number.isFinite(time) ? analysis.source.start + time : null } }], workDir });
        const result = results.find(item => item.id === 'match-01' && item.confidence >= 0.9);
        if (result) await this.patch(file, value => {
          value.stageMap = { ...value.stageMap, stage: result.stage, rule: result.rule, imageUrl: `/assets/stage-maps/${encodeURIComponent(result.stage + '_' + result.rule + '.webp')}`, source: result.source, confidence: result.confidence, evidence: result.evidence, coordinateSpace: { width: 1000, height: 1000 } };
          value.playerIdentity ||= {};
          value.playerIdentity.weapon = { name: result.weapon, status: 'identified-from-personal-result', confidence: result.confidence, source: result.source };
          value.capabilities ||= {}; value.capabilities.stageMap = 'automatic-personal-result-stage-and-rule';
        });
      }
      const latest = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!latest.weaponRoster?.complete && latest.playerIdentity?.weapon?.name) {
        const id = `match-${String(match.number).padStart(2, '0')}`;
        const results = await this.rosters({ matches: [match], source: recording.source, workDir, expectedWeapons: new Map([[id, latest.playerIdentity.weapon.name]]), force: attempts > 1, timeOffset: (attempts - 1) * 3 });
        const roster = results.get(id);
        if (roster?.complete) await this.patch(file, value => { value.weaponRoster = roster; value.capabilities ||= {}; value.capabilities.weaponRoster = 'opening-battle-hud-two-frame-validated'; });
      }
      await this.patch(file, value => { value.detailEnrichment.status = missingDetails(value) ? 'incomplete' : 'complete'; });
    } catch (error) {
      await this.patch(file, value => { value.detailEnrichment.status = 'error'; value.detailEnrichment.error = error.message; });
    }
  }
}
