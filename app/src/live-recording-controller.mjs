import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LiveAnalysisCollector } from './live-analysis-state.mjs';
import { selectMatchFragments } from './fragment-manifest.mjs';
import { finalizeLiveMatchAnalysis } from './live-match-finalizer.mjs';
import { LiveMediaSession } from './live-media-session.mjs';
import { createMatchThumbnail } from './match-thumbnail.mjs';
import { ANALYSIS_ROOT, LIVE_MEDIA_ROOT, THUMBNAIL_ROOT } from './paths.mjs';

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, file);
}

export class LiveRecordingController {
  constructor({ store, recording, segmentSeconds = 2, session = null, collector = null, liveMediaRoot = LIVE_MEDIA_ROOT, analysisRoot = ANALYSIS_ROOT, thumbnailRoot = THUMBNAIL_ROOT, thumbnailExtractor = undefined }) {
    this.store = store;
    this.recording = recording;
    this.collector = collector || new LiveAnalysisCollector();
    this.liveMediaRoot = liveMediaRoot;
    this.analysisRoot = analysisRoot;
    this.thumbnailRoot = thumbnailRoot;
    this.thumbnailExtractor = thumbnailExtractor;
    this.runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    this.outputDir = path.join(this.liveMediaRoot, recording.id, this.runId);
    this.session = session || new LiveMediaSession({ source: recording.source, outputDir: this.outputDir, segmentSeconds });
    this.publishing = new Set();
    this.pendingMatches = new Map();
    this.unpublishedStarts = new Map();
    this.lastPruneTime = -Infinity;
    this.pruning = null;
    this.stopped = false;
    this.stopping = false;
  }

  async start() {
    for (const [event, accept] of [
      ['coarse', (frame, time) => this.acceptCoarse(frame, time)],
      ['battle-hud', (frame, time) => this.collector.acceptBattleHud(frame, time)],
      ['respawn-hud', (frame, time) => this.collector.acceptRespawn(frame, time)],
      ['full', (frame, time) => this.collector.acceptFull(frame, time)],
      ['perception', (frame, time) => this.collector.acceptPerception(frame, time)],
      ['score-count', (frame, time) => this.collector.acceptScoreCount(frame, time)],
      ['objective-count', (frame, time) => this.collector.acceptObjectiveCount(frame, time)],
    ]) this.session.on(event, accept);
    this.session.on('error', error => this.fail(error));
    this.collector.on('match-start', match => this.onMatchStart(match));
    this.collector.on('result-detected', match => { void this.publish(match); });
    // Publish as soon as the personal result appears, then replace only the
    // boundary/manifest after the result screen ends. This keeps the first
    // review instant while converging to the same final split boundary as the
    // batch detector.
    this.collector.on('match-finalized', match => { void this.publish(match); });
    await this.store.patch(this.recording.id, { status: 'recording', phase: '録画中・分析中', progress: 0, error: null, live: true });
    void this.session.start().catch(error => this.fail(error));
  }

  acceptCoarse(frame, time) {
    const result = this.collector.acceptCoarse(frame, time);
    if (time - this.lastPruneTime >= 10 && !this.pruning) {
      this.lastPruneTime = time;
      const protectedStarts = [this.collector.machine.active?.start, ...this.unpublishedStarts.values()]
        .filter(Number.isFinite);
      const preserveFrom = protectedStarts.length ? Math.min(...protectedStarts) : Math.max(0, time - 12);
      this.pruning = this.pruneUnusedFragments({ preserveFrom })
        .catch(error => console.warn('Live fragment cleanup deferred:', error.message))
        .finally(() => { this.pruning = null; });
    }
    return result;
  }

  async onMatchStart(match) {
    this.unpublishedStarts.set(match.number, match.start);
    const current = this.store.get(this.recording.id);
    const previousReady = (current.matches || []).find(existing => existing.number === match.number && existing.status === 'ready');
    if (previousReady) {
      await this.store.patch(this.recording.id, { status: 'recording', phase: '録画中・前の試合を振り返れます', live: true });
      return;
    }
    const item = {
      id: `${this.recording.id}-match-${String(match.number).padStart(2, '0')}`,
      number: match.number, start: match.start, end: null, duration: null, status: 'analyzing',
    };
    const matches = [...(current.matches || []).filter(existing => existing.number !== match.number), item]
      .sort((left, right) => left.number - right.number);
    await this.store.patch(this.recording.id, { matches, status: 'recording', phase: `試合${match.number}を分析中`, live: true });
  }

  async availableManifest(match) {
    for (let attempt = 0; attempt < 40 && !this.stopped; attempt += 1) {
      const segments = await this.session.segments();
      if (segments.at(-1)?.end >= match.end) {
        return selectMatchFragments(segments, {
          start: match.start,
          end: match.end,
          codec: 'h264',
          urlFor: segment => `/media/live/${encodeURIComponent(this.recording.id)}/${encodeURIComponent(this.runId)}/${encodeURIComponent(segment.fileName)}`,
        });
      }
      await delay(250);
    }
    return null;
  }

  async publish(match) {
    if (this.publishing.has(match.number)) {
      this.pendingMatches.set(match.number, match);
      return;
    }
    this.publishing.add(match.number);
    try {
      const manifest = await this.availableManifest(match);
      if (!manifest) throw new Error('試合末尾の再生用データを準備できませんでした');
      const samples = this.collector.samples.get(match.number);
      if (!samples) throw new Error('試合のリアルタイム分析結果がありません');
      const currentBeforeThumbnail = this.store.get(this.recording.id);
      const existing = (currentBeforeThumbnail.matches || []).find(candidate => candidate.number === match.number);
      let thumbnailUrl = existing?.thumbnailUrl || null;
      if (!thumbnailUrl) {
        try {
          thumbnailUrl = await createMatchThumbnail({
            recording: this.recording,
            match,
            thumbnailRoot: this.thumbnailRoot,
            extractor: this.thumbnailExtractor,
          });
        } catch (error) {
          console.warn(`Live thumbnail is not ready for match ${match.number}: ${error.message}`);
        }
      }
      const item = {
        id: `${this.recording.id}-match-${String(match.number).padStart(2, '0')}`,
        number: match.number, start: match.start, end: match.end, duration: match.end - match.start,
        status: 'ready', videoManifest: manifest,
        analysisUrl: `/api/analysis/${encodeURIComponent(this.recording.id)}/match-${String(match.number).padStart(2, '0')}.json`,
        thumbnailUrl,
      };
      const analysis = finalizeLiveMatchAnalysis({ recording: this.recording, media: this.recording.media, match: item, samples });
      await writeJsonAtomic(path.join(this.analysisRoot, this.recording.id, `match-${String(match.number).padStart(2, '0')}.json`), analysis);
      const current = this.store.get(this.recording.id);
      const matches = [...(current.matches || []).filter(existing => existing.number !== match.number), item]
        .sort((left, right) => left.number - right.number);
      await this.store.patch(this.recording.id, { matches, status: 'recording', phase: '録画中・前の試合を振り返れます', live: true });
      this.unpublishedStarts.delete(match.number);
      await this.pruneUnreferencedRuns();
    } catch (error) {
      await this.fail(error);
    } finally {
      this.publishing.delete(match.number);
      const pending = this.pendingMatches.get(match.number);
      if (pending) {
        this.pendingMatches.delete(match.number);
        void this.publish(pending);
      }
    }
  }

  async fail(error) {
    if (this.stopped || this.stopping) return;
    console.error('Live recording analysis failed:', error);
    await this.store.patch(this.recording.id, { status: 'error', phase: 'リアルタイム分析失敗', error: error.message, live: false });
  }

  async pruneUnusedFragments({ preserveFrom = Infinity } = {}) {
    const runPath = `/${encodeURIComponent(this.runId)}/`;
    const keep = new Set((this.store.get(this.recording.id)?.matches || [])
      .flatMap(match => match.videoManifest?.fragments || [])
      .filter(fragment => fragment.url.includes(runPath))
      .map(fragment => path.basename(new URL(fragment.url, 'http://local').pathname)));
    if (Number.isFinite(preserveFrom)) {
      for (const segment of await this.session.segments()) {
        if (segment.end > preserveFrom) keep.add(segment.fileName);
      }
    }
    let entries;
    try { entries = await fs.readdir(this.outputDir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const segmentEntries = entries
      .filter(entry => entry.isFile() && /^segment-\d+\.mp4$/u.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    // The segment muxer can have the newest file open before it appears in the
    // CSV manifest. Keep a two-file write window so cleanup never races it.
    for (const entry of segmentEntries.slice(-2)) keep.add(entry.name);
    await Promise.all(segmentEntries
      .filter(entry => !keep.has(entry.name))
      .map(async entry => {
        try { await fs.rm(path.join(this.outputDir, entry.name), { force: true }); }
        catch (error) {
          if (!['EBUSY', 'EPERM'].includes(error.code)) throw error;
        }
      }));
  }

  async pruneUnreferencedRuns() {
    const recordingMediaRoot = path.resolve(this.liveMediaRoot, this.recording.id);
    const relativeRoot = path.relative(path.resolve(this.liveMediaRoot), recordingMediaRoot);
    if (!relativeRoot || relativeRoot.startsWith('..') || path.isAbsolute(relativeRoot)) throw new Error('リアルタイム断片の削除先が不正です');
    const referencedRuns = new Set((this.store.get(this.recording.id)?.matches || [])
      .flatMap(match => match.videoManifest?.fragments || [])
      .map(fragment => {
        const parts = new URL(fragment.url, 'http://local').pathname.split('/').filter(Boolean);
        return parts[3] ? decodeURIComponent(parts[3]) : null;
      })
      .filter(Boolean));
    referencedRuns.add(this.runId);
    let entries;
    try { entries = await fs.readdir(recordingMediaRoot, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    await Promise.all(entries
      .filter(entry => entry.isDirectory() && !referencedRuns.has(entry.name))
      .map(entry => fs.rm(path.join(recordingMediaRoot, entry.name), { recursive: true, force: true })));
  }

  async stop() {
    if (this.stopped || this.stopping) return;
    this.stopping = true;
    this.session.stop();
    try { await this.session.completed; } catch {}
    for (let attempt = 0; attempt < 20 && this.publishing.size; attempt += 1) await delay(250);
    if (this.pruning) await this.pruning;
    const beforeFinalizing = this.store.get(this.recording.id);
    for (const match of beforeFinalizing?.matches || []) {
      if (match.status !== 'ready' || match.thumbnailUrl) continue;
      try {
        match.thumbnailUrl = await createMatchThumbnail({
          recording: this.recording,
          match,
          thumbnailRoot: this.thumbnailRoot,
          extractor: this.thumbnailExtractor,
        });
      } catch (error) {
        console.warn(`Final thumbnail is not ready for match ${match.number}: ${error.message}`);
      }
    }
    const matches = (beforeFinalizing?.matches || []).map(match => {
      if (match.status !== 'ready') return match;
      const direct = {
        ...match,
        sourceVideoUrl: `/media/recordings/${encodeURIComponent(this.recording.id)}/source.mp4`,
        sourceVideoStart: match.start,
      };
      delete direct.videoManifest;
      return direct;
    });
    await this.store.patch(this.recording.id, { matches });
    const recordingMediaRoot = path.resolve(this.liveMediaRoot, this.recording.id);
    const relative = path.relative(path.resolve(this.liveMediaRoot), recordingMediaRoot);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('リアルタイム断片の削除先が不正です');
    await fs.rm(recordingMediaRoot, { recursive: true, force: true });
    this.stopped = true;
    this.stopping = false;
    const current = this.store.get(this.recording.id);
    if (current?.status !== 'error') await this.store.patch(this.recording.id, { status: 'ready', phase: '録画終了・分析済み', progress: 1, live: false, completedAt: new Date().toISOString() });
  }
}
