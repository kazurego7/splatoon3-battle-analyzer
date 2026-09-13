import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ANALYSIS_ROOT, LIVE_MEDIA_ROOT, MATCH_ROOT, RAW_ROOT, THUMBNAIL_ROOT, WORK_ROOT } from './paths.mjs';
import { ensureFfmpeg, extractJpeg, extractRgbFrame, probeMedia, sampleBattleHud, sampleGameCountFrames, sampleRespawnHud, sampleRgbWindow, sampleVideo } from './ffmpeg.mjs';
import { classifySamples, detectMatchSegments } from './segmentation.mjs';
import { refineIntroBoundaries } from './intro-boundary.mjs';
import { describeSelfDeaths, detectGameplayStart, detectPlayerCounts, detectSelfDeaths } from './battle-analysis.mjs';
import { identifySelfHudSlot } from './player-identity.mjs';
import { analyzeGameCountFrame, detectGameCounts, gameCountFrameRegionForRule, gameCountModelVersion } from './game-count-vision.mjs';
import { analyzeMapCandidate, stabilizeMapVisibility } from './map-analysis.mjs';
import { detectRespawnRuns, respawnModelVersion } from './respawn-vision.mjs';
import { attachRespawnEvidence } from './analysis-overrides.mjs';
import { analyzeEnemyColorFrame, buildDeathCameraDetections, detectEnemyColorMotionRuns } from './perception-analysis.mjs';
import { weaponCatalogEntries, weaponCatalogMetadata } from './weapon-analysis.mjs';
import { analyzeDeathSequencesWithCodex } from './codex-death-analysis.mjs';
import { chooseDeathCandidateSet, reconcileDeathsWithResult } from './result-analysis.mjs';
import { refineResultBoundaries, resultBoundaryModelVersion } from './result-boundary.mjs';
import { analyzeRecordingStages, loadStageCatalog } from './stage-analysis.mjs';
import { analyzeRecordingPersonalResults } from './personal-result-analysis.mjs';
import { createMatchThumbnail } from './match-thumbnail.mjs';
import { analyzeRecordingWeaponRosters } from './weapon-roster-analysis.mjs';
import { analyzeOutcomeLocally, outcomeModelVersion } from './outcome-analysis.mjs';
import { mapWithConcurrency, positiveConcurrency } from './concurrency.mjs';
import { sourceMatch } from './source-matches.mjs';
import { LiveRecordingController } from './live-recording-controller.mjs';
import { recordingSourceRoots } from './recording-roots.mjs';

const ANALYSIS_CONCURRENCY = positiveConcurrency(process.env.VIDEO_ANALYSIS_CONCURRENCY, 2);

function slug(value) {
  return value.normalize('NFKC').replace(/\.[^.]+$/, '').replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase();
}

export function recordingId(fileName, size) {
  const digest = createHash('sha1').update(`${fileName}:${size}`).digest('hex').slice(0, 8);
  return `${slug(fileName) || 'recording'}-${digest}`;
}

function relativeMediaPath(rootName, id, fileName) {
  return `/media/${rootName}/${encodeURIComponent(id)}/${encodeURIComponent(fileName)}`;
}

function segmentCacheKey(segment) {
  return [segment.start, segment.activeEnd, segment.end]
    .map(value => Number(value).toFixed(3))
    .join(':');
}

function gameplayCacheKey(segment) {
  return [segment.start, segment.activeEnd]
    .map(value => Number(value).toFixed(3))
    .join(':');
}

function matchesGameplayCache(cacheKey, segment) {
  const expected = gameplayCacheKey(segment);
  return cacheKey === expected || String(cacheKey || '').startsWith(`${expected}:`);
}

export class Pipeline {
  constructor(store) {
    this.store = store;
    this.queue = [];
    this.processing = false;
    this.scanTimer = null;
    this.fileSnapshots = new Map();
    this.liveRecordings = new Map();
    this.sourceRoots = [RAW_ROOT];
    this.ignoredExternalSources = new Set();
  }

  async start({ autoProcess = true } = {}) {
    await ensureFfmpeg();
    await Promise.all([
      fs.mkdir(RAW_ROOT, { recursive: true }),
      fs.mkdir(MATCH_ROOT, { recursive: true }),
      fs.mkdir(LIVE_MEDIA_ROOT, { recursive: true }),
      fs.mkdir(ANALYSIS_ROOT, { recursive: true }),
      fs.mkdir(THUMBNAIL_ROOT, { recursive: true }),
      fs.mkdir(WORK_ROOT, { recursive: true }),
    ]);
    this.sourceRoots = await recordingSourceRoots();
    await this.scan({ enqueue: autoProcess });
    void this.backfillMissingThumbnails().catch(error => console.warn(`Thumbnail backfill failed: ${error.message}`));
    if (autoProcess) this.scanTimer = setInterval(() => this.scan().catch(error => console.error(error)), 5000);
  }

  async backfillMissingThumbnails() {
    for (const recording of this.store.list()) {
      if (recording.live || recording.status !== 'ready' || !recording.source) continue;
      const matches = structuredClone(recording.matches || []);
      let changed = false;
      for (const match of matches) {
        if (match.status !== 'ready' || match.thumbnailUrl) continue;
        try {
          match.thumbnailUrl = await createMatchThumbnail({ recording, match });
          changed ||= Boolean(match.thumbnailUrl);
        } catch (error) {
          console.warn(`Thumbnail backfill deferred for ${recording.id} match ${match.number}: ${error.message}`);
        }
      }
      if (changed) await this.store.patch(recording.id, { matches });
    }
  }

  async scan({ enqueue = true } = {}) {
    const files = (await Promise.all(this.sourceRoots.map(async root => {
      const entries = await fs.readdir(root, { withFileTypes: true });
      return entries
        .filter(entry => entry.isFile() && /\.(mp4|mov|mkv|webm)$/i.test(entry.name))
        .map(entry => ({ entry, root }));
    }))).flat();
    for (const { entry, root } of files) {
      const source = path.join(root, entry.name);
      const stat = await fs.stat(source);
      const previous = this.fileSnapshots.get(source);
      const existing = this.store.list().find(item => path.resolve(item.source) === path.resolve(source));
      const recentlyModified = Date.now() - stat.mtimeMs < 15000;
      const externalRoot = path.resolve(root) !== path.resolve(RAW_ROOT);
      const growing = Boolean(previous && stat.size > previous.size);
      if (externalRoot && this.ignoredExternalSources.has(source) && !growing) {
        this.fileSnapshots.set(source, { size: stat.size, mtimeMs: stat.mtimeMs });
        continue;
      }
      if (growing) this.ignoredExternalSources.delete(source);
      if (!existing && !previous && externalRoot && !recentlyModified) {
        this.ignoredExternalSources.add(source);
        this.fileSnapshots.set(source, { size: stat.size, mtimeMs: stat.mtimeMs });
        continue;
      }
      const id = existing?.id || recordingId(entry.name, Math.round(stat.birthtimeMs));
      let recording = this.store.get(id);
      if (!recording) {
        recording = {
          id,
          fileName: entry.name,
          source,
          size: stat.size,
          status: 'queued',
          phase: '分析待ち',
          progress: 0,
          matches: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          error: null,
        };
        await this.store.upsert(recording);
      }
      if (growing && !this.liveRecordings.has(id) && recording.status !== 'ready') {
        const controller = new LiveRecordingController({ store: this.store, recording });
        this.liveRecordings.set(id, controller);
        await controller.start();
      }
      if (this.liveRecordings.has(id)) {
        await this.store.patch(id, { size: stat.size });
        if (!recentlyModified) {
          const controller = this.liveRecordings.get(id);
          this.liveRecordings.delete(id);
          await controller.stop();
        }
      } else if (enqueue && !recentlyModified && recording.status === 'queued' && !this.queue.includes(id)) {
        this.enqueue(id);
      }
      this.fileSnapshots.set(source, { size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }

  enqueue(id, force = false) {
    if (force) {
      const recording = this.store.get(id);
      if (recording) {
        recording.status = 'queued';
        recording.phase = '再分析待ち';
        recording.progress = 0;
        recording.error = null;
        this.store.upsert(recording).catch(console.error);
      }
    }
    if (!this.queue.includes(id)) this.queue.push(id);
    this.drain().catch(error => console.error(error));
  }

  async drain() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift();
        try {
          await this.process(id);
        } catch (error) {
          console.error(error);
          await this.store.patch(id, { status: 'error', phase: '分析失敗', error: error.message, progress: 0 });
        }
      }
    } finally {
      this.processing = false;
    }
  }

  async process(id) {
    const recording = this.store.get(id);
    if (!recording) return;
    const workDir = path.join(WORK_ROOT, id);
    await fs.mkdir(workDir, { recursive: true });

    await this.store.patch(id, { status: 'probing', phase: '動画情報を確認中', progress: 0.02, error: null });
    const media = await probeMedia(recording.source);
    await this.store.patch(id, { media, status: 'splitting', phase: '試合区間を検出中', progress: 0.05 });

    const sampleCache = path.join(workDir, 'samples.json');
    let samples;
    try {
      const cached = JSON.parse(await fs.readFile(sampleCache, 'utf8'));
      if (!cached.length || cached[0].centerDarkRatio == null) throw new Error('古いサンプル形式');
      samples = cached;
    } catch {
      samples = await sampleVideo(recording.source, media.duration, {
        interval: 2,
        onProgress: ratio => this.store.patch(id, {
          status: 'splitting',
          phase: '試合区間を検出中',
          progress: 0.05 + ratio * 0.25,
        }).catch(console.error),
      });
      await fs.writeFile(sampleCache, `${JSON.stringify(samples)}\n`);
    }
    const classified = classifySamples(samples, 2);
    await fs.writeFile(path.join(workDir, 'classified.json'), `${JSON.stringify(classified)}\n`);
    const detectedSegments = detectMatchSegments(classified, media.duration, 2);
    const coarseSegments = await refineIntroBoundaries(recording.source, detectedSegments, media.duration);
    if (!coarseSegments.length) throw new Error('試合区間を検出できませんでした。HUD検出しきい値の調整が必要です');
    const boundaryCache = path.join(workDir, 'result-boundaries.json');
    const coarseCacheKey = coarseSegments.map(segmentCacheKey).join('|');
    let segments;
    try {
      const cached = JSON.parse(await fs.readFile(boundaryCache, 'utf8'));
      if (cached.version !== resultBoundaryModelVersion || cached.coarseCacheKey !== coarseCacheKey || cached.segments?.length !== coarseSegments.length) {
        throw new Error('古いリザルト境界キャッシュ');
      }
      segments = cached.segments;
    } catch {
      await this.store.patch(id, { status: 'splitting', phase: 'リザルト画面の終端を検出中', progress: 0.3 });
      segments = await refineResultBoundaries(recording.source, coarseSegments, media.duration, {
        onProgress: ratio => this.store.patch(id, {
          status: 'splitting',
          phase: 'リザルト画面の終端を検出中',
          progress: 0.3 + ratio * 0.08,
        }).catch(console.error),
      });
      await fs.writeFile(boundaryCache, `${JSON.stringify({
        version: resultBoundaryModelVersion,
        coarseCacheKey,
        segments,
      }, null, 2)}\n`);
    }
    await fs.writeFile(path.join(workDir, 'manifest.json'), `${JSON.stringify({ source: recording.source, segments }, null, 2)}\n`);

    const matches = segments.map((segment, index) => sourceMatch(id, {
      id: id + '-match-' + String(index + 1).padStart(2, '0'), number: index + 1,
      start: segment.start, end: segment.end, duration: segment.end - segment.start, status: 'analyzing',
    }));
    await this.store.patch(id, { matches, status: 'analyzing', phase: '各試合を分析中', progress: 0.68 });
    let reportedAnalysisProgress = 0.68;
    const updateAnalysisProgress = (phase, progress) => {
      reportedAnalysisProgress = Math.max(reportedAnalysisProgress, progress);
      return this.store.patch(id, {
        status: 'analyzing',
        phase,
        progress: reportedAnalysisProgress,
      });
    };

    const analysisDir = path.join(ANALYSIS_ROOT, id);
    const thumbnailDir = path.join(THUMBNAIL_ROOT, id);
    await Promise.all([fs.mkdir(analysisDir, { recursive: true }), fs.mkdir(thumbnailDir, { recursive: true })]);
    let personalResults = [];
    try {
      await this.store.patch(id, { status: 'analyzing', phase: '個人リザルトを読取中', progress: 0.68 });
      personalResults = await analyzeRecordingPersonalResults({ source: recording.source, segments, workDir });
    } catch (error) {
      console.warn(`Personal result analysis unavailable: ${error.message}`);
    }
    const personalResultsByMatch = new Map(personalResults.map(result => [result.id, result]));
    const stageCatalog = await loadStageCatalog();
    const personalWeaponCounts = new Map();
    for (const result of personalResults.filter(result => result.confidence >= 0.9)) {
      personalWeaponCounts.set(result.weapon, (personalWeaponCounts.get(result.weapon) || 0) + 1);
    }
    const rankedPersonalWeapons = [...personalWeaponCounts.entries()].sort((left, right) => right[1] - left[1]);
    const recordingPersonalWeapon = rankedPersonalWeapons[0]?.[1] >= 2
      && rankedPersonalWeapons[0][1] > (rankedPersonalWeapons[1]?.[1] || 0)
      ? { name: rankedPersonalWeapons[0][0], observations: rankedPersonalWeapons[0][1] }
      : null;
    const resultAnalyses = matches.map((match, index) => {
      const result = personalResultsByMatch.get(`match-${String(match.number).padStart(2, '0')}`);
      if (!result) return null;
      return {
        found: true,
        screenType: 'personal',
        killCount: result.kills,
        deathCount: result.deaths,
        time: Number((segments[index].resultBoundary.detectedAt - match.start).toFixed(2)),
        evidence: result.evidence,
        confidence: result.confidence,
        source: result.source,
      };
    });
    const outcomeCache = path.join(workDir, 'outcomes.json');
    const outcomeCacheKey = segments.map(segmentCacheKey).join('|');
    let outcomeAnalyses;
    try {
      const cached = JSON.parse(await fs.readFile(outcomeCache, 'utf8'));
      if (cached.version !== outcomeModelVersion || cached.cacheKey !== outcomeCacheKey || cached.outcomes?.length !== matches.length) {
        throw new Error('古い勝敗判定キャッシュ');
      }
      outcomeAnalyses = cached.outcomes;
    } catch {
      let completedOutcomes = 0;
      outcomeAnalyses = await mapWithConcurrency(matches, ANALYSIS_CONCURRENCY, async (match, index) => {
        await updateAnalysisProgress(
          `試合${index + 1}/${matches.length}の勝敗発表を検出中`,
          0.68 + (completedOutcomes / matches.length) * 0.01,
        );
        try {
          return await analyzeOutcomeLocally({
            source: recording.source,
            matchStart: match.start,
            activeEnd: segments[index].activeEnd,
            matchEnd: match.end,
          });
        } catch (error) {
          console.warn(`Outcome analysis unavailable for match ${index + 1}: ${error.message}`);
          return null;
        } finally {
          completedOutcomes += 1;
        }
      });
      await fs.writeFile(outcomeCache, `${JSON.stringify({
        version: outcomeModelVersion,
        cacheKey: outcomeCacheKey,
        outcomes: outcomeAnalyses,
      }, null, 2)}\n`);
    }
    let stageResults = [];
    try {
      await this.store.patch(id, { status: 'analyzing', phase: '試合開始画面からルールとステージを読取中', progress: 0.68 });
      const stageFallbackIndexes = matches
        .map((_match, index) => ({ index, result: personalResultsByMatch.get(`match-${String(index + 1).padStart(2, '0')}`) }))
        .filter(item => !item.result || item.result.confidence < 0.9)
        .map(item => item.index);
      stageResults = await analyzeRecordingStages({
        source: recording.source,
        segments,
        workDir,
        matchIndexes: stageFallbackIndexes,
      });
    } catch (error) {
      console.warn(`Stage analysis unavailable: ${error.message}`);
    }
    const stageResultsByMatch = new Map(stageResults.map(result => [result.id, result]));
    for (const result of personalResults.filter(result => result.confidence >= 0.9)) {
      stageResultsByMatch.set(result.id, {
        id: result.id,
        stage: result.stage,
        rule: result.rule,
        stageAsset: stageCatalog.assets.get(`${result.stage}\u0000${result.rule}`) || null,
        confidence: result.confidence,
        evidence: result.evidence,
        source: result.source,
      });
    }
    const countRules = new Set(['エリア', 'ヤグラ', 'ホコ', 'アサリ']);
    const directlyDetectedRules = matches.map((match, index) => {
      const automatic = stageResultsByMatch.get(`match-${String(match.number).padStart(2, '0')}`);
      return automatic?.confidence >= 0.65 && countRules.has(automatic.rule) ? automatic.rule : null;
    });
    // Result headers can be absent after a knockout or a schedule update. A
    // recording normally contains consecutive matches from the same rotation,
    // so retain the nearest confidently read rule for the HUD layout only.
    const gameCountRules = directlyDetectedRules.map((rule, index) => {
      if (rule) return rule;
      for (let distance = 1; distance < matches.length; distance += 1) {
        if (directlyDetectedRules[index - distance]) return directlyDetectedRules[index - distance];
        if (directlyDetectedRules[index + distance]) return directlyDetectedRules[index + distance];
      }
      return null;
    });
    const directIdentityResults = await mapWithConcurrency(matches, ANALYSIS_CONCURRENCY, async (match, index) => {
      const detectedAt = segments[index].resultBoundary?.detectedAt;
      if (!Number.isFinite(detectedAt)) {
        return null;
      }
      const frame = await extractRgbFrame(recording.source, detectedAt);
      return {
        time: detectedAt,
        frame,
        personalResult: personalResultsByMatch.get(`match-${String(index + 1).padStart(2, '0')}`) || null,
      };
    });
    let previousIdentityResult = null;
    const identityReferences = directIdentityResults.map(result => {
      const reference = result || previousIdentityResult;
      if (result) previousIdentityResult = result;
      return reference;
    });
    const expectedRosterWeapons = new Map(matches.map((match, index) => [
      `match-${String(match.number).padStart(2, '0')}`,
      directIdentityResults[index]?.personalResult?.weapon || recordingPersonalWeapon?.name || null,
    ]));
    let weaponRostersByMatch = new Map();
    try {
      await this.store.patch(id, { status: 'analyzing', phase: 'バトル開始直後の味方・相手ブキを照合中', progress: 0.68 });
      weaponRostersByMatch = await analyzeRecordingWeaponRosters({
        matches,
        source: recording.source,
        workDir,
        expectedWeapons: expectedRosterWeapons,
      });
    } catch (error) {
      console.warn(`Opening weapon roster analysis unavailable: ${error.message}`);
    }
    const scanConcurrency = matches.length > 1 ? 1 : ANALYSIS_CONCURRENCY;
    let completedMatches = 0;
    await mapWithConcurrency(matches, ANALYSIS_CONCURRENCY, async (match, index) => {
      const cacheKey = segmentCacheKey(segments[index]);
      const gameplayKey = gameplayCacheKey(segments[index]);
      const clipPath = recording.source;
      const thumbnailName = `match-${String(match.number).padStart(2, '0')}.jpg`;
      await extractJpeg(clipPath, match.start + Math.min(35, Math.max(1, match.duration / 3)), path.join(thumbnailDir, thumbnailName), 640);
      const gameplayEnd = Math.max(0, segments[index].activeEnd - match.start);
      const automaticStage = stageResultsByMatch.get(`match-${String(match.number).padStart(2, '0')}`);
      const acceptedStage = automaticStage?.confidence >= 0.65 ? automaticStage : null;
      const gameCountRule = gameCountRules[index];
      const weaponRoster = weaponRostersByMatch.get(`match-${String(match.number).padStart(2, '0')}`) || null;
      const hudCache = path.join(workDir, `battle-hud-match-${String(match.number).padStart(2, '0')}.json`);
      const respawnCache = path.join(workDir, `respawn-hud-match-${String(match.number).padStart(2, '0')}.json`);
      const perceptionCache = path.join(workDir, `perception-match-${String(match.number).padStart(2, '0')}.json`);
      const gameCountCache = path.join(workDir, `game-count-match-${String(match.number).padStart(2, '0')}.json`);
      const mapCache = path.join(workDir, `map-candidates-match-${String(match.number).padStart(2, '0')}.json`);
      const [battleHud, respawnSamples, perceptionSamples, gameCountSamples, mapCandidates] = await mapWithConcurrency([
        async () => {
          try {
            const cached = JSON.parse(await fs.readFile(hudCache, 'utf8'));
            if (cached.version !== 3 || !matchesGameplayCache(cached.cacheKey, segments[index]) || !cached.samples?.length || !cached.samples[0].self) throw new Error('古いHUDキャッシュ');
            return cached.samples;
          } catch {
            const samples = await sampleBattleHud(clipPath, match.duration, { startTime: match.start,
              onProgress: ratio => updateAnalysisProgress(
                `試合${index + 1}/${matches.length}の生存人数を検出中`,
                0.68 + ((index + ratio) / matches.length) * 0.3,
              ).catch(console.error),
            });
            await fs.writeFile(hudCache, `${JSON.stringify({ version: 3, cacheKey: gameplayKey, samples })}\n`);
            return samples;
          }
        },
        async () => {
          try {
            const cached = JSON.parse(await fs.readFile(respawnCache, 'utf8'));
            if (cached.modelVersion !== respawnModelVersion || !matchesGameplayCache(cached.cacheKey, segments[index]) || !cached.samples?.length) throw new Error('古い復活UIキャッシュ');
            return cached.samples;
          } catch {
            const samples = await sampleRespawnHud(clipPath, match.duration, { startTime: match.start });
            await fs.writeFile(respawnCache, `${JSON.stringify({ modelVersion: respawnModelVersion, cacheKey: gameplayKey, samples })}\n`);
            return samples;
          }
        },
        async () => {
          try {
            const cached = JSON.parse(await fs.readFile(perceptionCache, 'utf8'));
            if (cached.version !== 1 || !matchesGameplayCache(cached.cacheKey, segments[index]) || !cached.samples?.length) throw new Error('古い映像認識キャッシュ');
            return cached.samples;
          } catch {
            let previousPerceptionFrame = null;
            const samples = await sampleRgbWindow(clipPath, match.start, match.start + gameplayEnd, { timeOrigin: match.start,
              interval: 0.5,
              width: 480,
              height: 270,
              onFrame: (frame, width, height, time) => {
                const result = analyzeEnemyColorFrame(frame, previousPerceptionFrame, width, height, time);
                previousPerceptionFrame = frame;
                return result;
              },
            });
            await fs.writeFile(perceptionCache, `${JSON.stringify({ version: 1, cacheKey: gameplayKey, samples })}\n`);
            return samples;
          }
        },
        async () => {
          try {
            const cached = JSON.parse(await fs.readFile(gameCountCache, 'utf8'));
            if (cached.modelVersion !== gameCountModelVersion || cached.rule !== gameCountRule
              || !matchesGameplayCache(cached.cacheKey, segments[index]) || !cached.samples?.length) throw new Error('古いゲームカウントキャッシュ');
            return cached.samples;
          } catch {
            const samples = await sampleGameCountFrames(clipPath, match.duration, { startTime: match.start,
              interval: 0.5,
              crop: gameCountFrameRegionForRule(gameCountRule),
              onFrame: (frame, width, _height, time) => analyzeGameCountFrame(frame, width, time, { rule: gameCountRule }),
              onProgress: ratio => updateAnalysisProgress(
                `試合${index + 1}/${matches.length}のゲームカウントを読取中`,
                0.68 + ((index + 0.84 + ratio * 0.12) / matches.length) * 0.3,
              ).catch(console.error),
            });
            await fs.writeFile(gameCountCache, `${JSON.stringify({ modelVersion: gameCountModelVersion, rule: gameCountRule, cacheKey: gameplayKey, samples })}\n`);
            return samples;
          }
        },
        async () => {
          try {
            const cached = JSON.parse(await fs.readFile(mapCache, 'utf8'));
            if (cached.version !== 9 || !matchesGameplayCache(cached.cacheKey, segments[index]) || !cached.samples?.length) throw new Error('古いマップ候補キャッシュ');
            return cached.samples;
          } catch {
            const samples = stabilizeMapVisibility(await sampleRgbWindow(clipPath, match.start, match.start + gameplayEnd, { timeOrigin: match.start,
              interval: 0.5,
              onFrame: (frame, width, height, time) => analyzeMapCandidate(frame, width, height, time),
            }));
            await fs.writeFile(mapCache, `${JSON.stringify({ version: 9, cacheKey: gameplayKey, samples })}\n`);
            return samples;
          }
        },
      ], scanConcurrency, task => task());
      await updateAnalysisProgress(
        `試合${index + 1}/${matches.length}の本人ブキを照合中`,
        0.68 + ((index + 0.82) / matches.length) * 0.3,
      );
      const hudIdentityFrame = await extractRgbFrame(recording.source, match.start + Math.min(20, Math.max(8, gameplayEnd / 3)));
      const directIdentityResult = directIdentityResults[index];
      const identityReference = identityReferences[index];
      const identityMatch = identityReference
        ? identifySelfHudSlot(identityReference.frame, hudIdentityFrame)
        : null;
      let weaponEvidence = null;
      const visionWeaponName = directIdentityResult?.personalResult?.weapon || null;
      const acceptedWeaponName = visionWeaponName || recordingPersonalWeapon?.name || null;
      const visionWeapon = acceptedWeaponName
        ? weaponCatalogEntries().find(item => item.name === acceptedWeaponName)
        : null;
      if (visionWeapon) {
        weaponEvidence = {
          id: visionWeapon.id,
          name: visionWeapon.name,
          status: visionWeaponName ? 'identified-from-personal-result' : 'confirmed-by-recording-personal-results',
          confidence: visionWeaponName ? directIdentityResult.personalResult.confidence : 0.9,
          source: visionWeaponName ? directIdentityResult.personalResult.source : 'personal-result-recording-consensus',
          catalogVersion: weaponCatalogMetadata.version,
          observations: visionWeaponName ? 1 : recordingPersonalWeapon.observations,
        };
      }
      let identityConfirmed = Boolean(identityMatch && identityMatch.confidence >= 0.05);
      const identity = {
        status: identityConfirmed ? 'confirmed' : 'unconfirmed',
        method: directIdentityResult ? 'personal-result-weapon-match' : identityReference ? 'carried-personal-result-weapon-match' : 'personal-result-not-found',
        hudSlot: identityConfirmed ? identityMatch.slot : null,
        confidence: identityMatch?.confidence || 0,
        resultTime: directIdentityResult?.time == null ? null : Number((directIdentityResult.time - match.start).toFixed(2)),
        scores: identityMatch?.scores || [],
        weapon: weaponEvidence,
      };
      const resultAnalysis = resultAnalyses[index];
      const outcome = outcomeAnalyses[index];
      const gameplayStart = detectGameplayStart(battleHud, { gameplayEnd });
      const respawnRuns = detectRespawnRuns(respawnSamples, { gameplayStart, gameplayEnd });
      const slotCandidates = (battleHud[0]?.team || []).map((_, slot) => {
        const selfHud = battleHud.map(sample => ({ time: sample.time, ...sample.team[slot] }));
        const hudDeaths = detectSelfDeaths(selfHud, { duration: match.duration, gameplayStart, gameplayEnd });
        return { slot, deaths: attachRespawnEvidence(hudDeaths, respawnRuns) };
      });
      const selectedCandidates = chooseDeathCandidateSet(
        slotCandidates,
        resultAnalysis?.deathCount,
        identityConfirmed ? identityMatch.slot : null,
      );
      if (selectedCandidates && selectedCandidates.countDistance === 0 && !identityConfirmed) {
        identityConfirmed = true;
        identity.status = 'confirmed';
        identity.method = 'result-count-and-respawn-match';
        identity.hudSlot = selectedCandidates.slot;
        identity.confidence = Number(Math.min(0.9, 0.35 + selectedCandidates.respawnConfirmed * 0.1).toFixed(3));
      }
      const deathCandidates = selectedCandidates?.deaths || respawnRuns;
      const deaths = reconcileDeathsWithResult(deathCandidates, resultAnalysis?.deathCount);
      const deathCountMatched = Boolean(resultAnalysis && resultAnalysis.deathCount === deaths.length);
      const detections = [
        ...buildDeathCameraDetections(deaths),
        ...detectEnemyColorMotionRuns(perceptionSamples, deaths),
      ].sort((left, right) => left.frames[0][0] - right.frames[0][0]);
      const hiddenTimes = mapCandidates.filter(sample => sample.mapUi?.visible).map(sample => sample.time);
      const playerCounts = detectPlayerCounts(battleHud, { gameplayEnd, hiddenTimes });
      const gameCounts = detectGameCounts(gameCountSamples, { gameplayEnd, hiddenTimes, rule: gameCountRule });
      const stageMap = acceptedStage?.stageAsset
        ? {
          imageUrl: `/assets/stage-maps/${encodeURIComponent(acceptedStage.stageAsset)}`,
          source: acceptedStage.source,
          confidence: acceptedStage.confidence,
          stage: acceptedStage.stage,
          rule: acceptedStage.rule,
          evidence: acceptedStage.evidence || null,
          coordinateSpace: { width: 1000, height: 1000 },
        }
        : null;
      const describedDeaths = describeSelfDeaths(deaths, { detections, playerCounts });
      const deathSequenceResult = await analyzeDeathSequencesWithCodex({
        clipPath, deaths: describedDeaths, workDir, matchNumber: index + 1, videoRange: { start: match.start, end: match.end },
        analysisContext: {
          source: { fileName: recording.fileName, start: match.start, end: match.end },
          media: { ...media, duration: match.duration }, events: describedDeaths,
          gameFlow: { deaths: { self: deaths.map(death => [death.time, death.duration]) }, playerCounts, gameCounts },
          playerStats: resultAnalysis, playerIdentity: identity, weaponRoster, outcome, stageMap,
        },
      });
      const analyzedDeaths = deathSequenceResult.deaths;
      const events = [...analyzedDeaths].sort((a, b) => a.time - b.time);
      const series = classified
        .filter(sample => sample.time >= match.start && sample.time <= match.end)
        .map(sample => ({
          time: sample.time - match.start,
          motion: Number(sample.difference.toFixed(2)),
          hud: Number(sample.gameScore.toFixed(3)),
          gameplay: sample.gameplay,
        }));
      const analysis = {
        version: 28,
        recordingId: id,
        matchId: match.id,
        generatedAt: new Date().toISOString(),
        source: { fileName: recording.fileName, start: match.start, end: match.end },
        media: { duration: match.duration, codec: media.codec, width: media.width, height: media.height, fps: media.fps },
        events,
        deathAnalysis: deathSequenceResult.analysis,
        series,
        gameFlow: {
          deaths: { self: deaths.map(death => [death.time, death.duration]) },
          playerCounts,
          gameCounts,
        },
        playerStats: resultAnalysis ? {
          kills: resultAnalysis.killCount ?? null,
          deaths: resultAnalysis.deathCount,
          source: resultAnalysis.source,
          confidence: resultAnalysis.confidence,
        } : null,
        playerIdentity: identity,
        weaponRoster,
        outcome,
        validation: {
          outcome: {
            detected: outcome?.value ?? null,
            confidence: outcome?.confidence ?? null,
            observations: outcome?.observations ?? 0,
            source: outcome?.source || 'post-match-announcement-not-found',
            announcementTime: outcome?.time ?? null,
          },
          deaths: {
            expected: resultAnalysis?.deathCount ?? null,
            observed: deaths.length,
            candidates: deathCandidates.length,
            gameplayStart,
            gameplayStartSource: 'stable-match-timer-hud',
            source: resultAnalysis?.source || 'personal-result-not-found',
            resultTime: resultAnalysis?.time ?? null,
            matched: resultAnalysis ? deathCountMatched : null,
          },
        },
        stageMap,
        capabilities: {
          segmentation: 'automatic-hud-heuristic',
          deaths: !resultAnalysis
            ? 'unavailable-no-personal-result'
            : !deathCountMatched
              ? deaths.length
                ? 'partial-detected-deaths-below-result-count'
                : 'unavailable-death-candidates-do-not-match-result'
            : respawnRuns.length
              ? 'result-count-validated-hud-and-respawn-timing-fusion'
              : identityConfirmed
                ? 'result-count-validated-self-hud'
                : 'unavailable-no-death-evidence',
          deathExplanation: analyzedDeaths.some(death => death.analysisSource?.startsWith('codex-vision')) ? 'codex-vision-sequence' : 'automatic-fallback',
          deathSequenceAnalysis: deathSequenceResult.analysis ? 'codex-vision-sequence' : 'available-on-demand',
          playerWeapon: weaponEvidence && weaponEvidence.status !== 'candidate-only'
            ? weaponEvidence.status
            : 'unavailable-personal-result-not-found',
          weaponRoster: weaponRoster?.complete
            ? 'opening-battle-hud-two-frame-validated'
            : weaponRoster
              ? 'partial-opening-battle-hud-two-frame-validated'
              : 'unavailable-opening-battle-hud-not-confident',
          playerCounts: 'automatic-battle-hud',
          matchOutcome: outcome
            ? 'automatic-post-match-win-lose-announcement'
            : 'unavailable-post-match-announcement-not-found',
          stageMap: automaticStage?.confidence >= 0.65
            ? automaticStage.source === 'personal-result-codex-vision'
              ? 'automatic-personal-result-stage-and-rule'
              : 'automatic-match-intro-stage-and-rule'
            : 'unavailable-stage-and-map-not-found',
          gameCountOcr: 'automatic-multi-threshold-hud-ocr',
        },
      };
      const analysisName = `match-${String(match.number).padStart(2, '0')}.json`;
      await fs.writeFile(path.join(analysisDir, analysisName), `${JSON.stringify(analysis, null, 2)}\n`);
      Object.assign(match, {
        status: 'ready',
        sourceVideoUrl: `/media/recordings/${encodeURIComponent(id)}/source.mp4`, sourceVideoStart: match.start,
        thumbnailUrl: relativeMediaPath('thumbnails', id, thumbnailName),
        analysisUrl: `/api/analysis/${encodeURIComponent(id)}/${encodeURIComponent(analysisName)}`,
        eventCount: events.length,
      });
      completedMatches += 1;
      await updateAnalysisProgress(
        `試合${completedMatches}/${matches.length}を分析済み`,
        0.68 + (completedMatches / matches.length) * 0.3,
      );
      return match;
    });

    await this.store.patch(id, {
      matches,
      status: 'ready',
      phase: '分析済み',
      progress: 1,
      completedAt: new Date().toISOString(),
    });
  }
}
