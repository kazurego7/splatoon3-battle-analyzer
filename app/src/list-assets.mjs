import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export function analysisSummary(analysis) {
  return {
    outcome: analysis.outcome,
    gameFlow: { gameCounts: (analysis.gameFlow?.gameCounts || []).slice(-1) },
    stageMap: { stage: analysis.stageMap?.stage, rule: analysis.stageMap?.rule },
    playerIdentity: { weapon: { name: analysis.playerIdentity?.weapon?.name, status: analysis.playerIdentity?.weapon?.status } },
    playerStats: { kills: analysis.playerStats?.kills, deaths: analysis.playerStats?.deaths },
    validation: { deaths: { expected: analysis.validation?.deaths?.expected } },
    deathAnalysis: Boolean(analysis.deathAnalysis),
    deathAnalysisState: { status: analysis.deathAnalysisState?.status },
  };
}

export class ListAssets {
  constructor() { this.summaries = new Map(); this.thumbnails = new Map(); }
  async summary(file) {
    try {
      const stat = await fs.stat(file), version = `${stat.mtimeMs}:${stat.size}`;
      let entry = this.summaries.get(file);
      if (entry?.version !== version) {
        entry = { version, promise: fs.readFile(file, 'utf8').then(JSON.parse).then(analysisSummary) };
        this.summaries.set(file, entry);
        if (this.summaries.size > 1000) this.summaries.delete(this.summaries.keys().next().value);
      }
      return await entry.promise;
    } catch { this.summaries.delete(file); return null; }
  }
  async thumbnail(file, width = 320) {
    const stat = await fs.stat(file), version = `${stat.mtimeMs}:${stat.size}`;
    const key = `${file}:${width}`;
    let entry = this.thumbnails.get(key);
    if (entry?.version !== version) {
      entry = { version, promise: fs.readFile(file).then(buffer => sharp(buffer).resize({ width, withoutEnlargement: true }).webp({ quality: 58 }).toBuffer()) };
      this.thumbnails.set(key, entry);
      if (this.thumbnails.size > 256) this.thumbnails.delete(this.thumbnails.keys().next().value);
    }
    try { return await entry.promise; }
    catch (error) { this.thumbnails.delete(key); throw error; }
  }
  async recordings(recordings, analysisRoot) {
    return Promise.all(recordings.map(async recording => ({ ...recording, matches: await Promise.all((recording.matches || []).map(async match => {
      const prefix = '/api/analysis/';
      if (!match.analysisUrl?.startsWith(prefix)) return match;
      const file = path.resolve(analysisRoot, ...match.analysisUrl.slice(prefix.length).split('/').map(decodeURIComponent));
      if (!file.startsWith(`${path.resolve(analysisRoot)}${path.sep}`)) return match;
      return { ...match, summary: await this.summary(file) };
    })) })));
  }
}
