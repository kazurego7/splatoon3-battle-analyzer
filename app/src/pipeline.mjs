import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ANALYSIS_ROOT, MATCH_ROOT, RAW_ROOT, THUMBNAIL_ROOT, WORK_ROOT } from './paths.mjs';
import { ensureFfmpeg, extractJpeg, extractJpegCrop, extractRgbFrame, probeMedia, runFfmpeg, sampleBattleHud, sampleGameCountFrames, sampleRespawnHud, sampleRgbWindow, sampleVideo } from './ffmpeg.mjs';
import { classifySamples, detectMatchSegments } from './segmentation.mjs';
import { describeSelfDeaths, detectPlayerCounts, detectSelfDeaths } from './battle-analysis.mjs';
import { findIdentityResult, identifySelfHudSlot } from './player-identity.mjs';
import { analyzeGameCountFrame, detectGameCounts, gameCountModelVersion } from './game-count-vision.mjs';
import { analyzeMapCandidate, buildEnemySightPredictions, buildEnemyThreatZones, buildEntityPredictions, buildPlayerRoute, buildShortPredictions, detectAllyTracks, detectSpatialObservations, selectObservedMapFrame } from './map-analysis.mjs';
import { detectRespawnRuns, respawnModelVersion } from './respawn-vision.mjs';
import { applyVerifiedDeathWindows, attachRespawnEvidence, verifiedAnalysis } from './analysis-overrides.mjs';
import { analyzeEnemyColorFrame, buildDeathCameraDetections, detectEnemyColorMotionRuns } from './perception-analysis.mjs';
import { identifyResultWeapon, weaponCatalogMetadata } from './weapon-analysis.mjs';
import { analyzeDeathSequencesWithCodex } from './codex-death-analysis.mjs';
import { analyzeResultLocally, chooseDeathCandidateSet, reconcileDeathsWithResult } from './result-analysis.mjs';
import { refineResultBoundaries, resultBoundaryModelVersion } from './result-boundary.mjs';
import { analyzeRecordingStages } from './stage-analysis.mjs';
import { analyzeOutcomeLocally, outcomeModelVersion } from './outcome-analysis.mjs';

function slug(value) {
  return value.normalize('NFKC').replace(/\.[^.]+$/, '').replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase();
}

function recordingId(fileName, size) {
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

async function encoderArgs(codec) {
  const { stdout } = await runFfmpeg(['-hide_banner', '-encoders']);
  if (codec === 'hevc') {
    if (stdout.includes('hevc_nvenc')) return ['-c:v', 'hevc_nvenc', '-preset', 'p5', '-cq', '18', '-tag:v', 'hvc1'];
    if (stdout.includes('libx265')) return ['-c:v', 'libx265', '-preset', 'veryfast', '-crf', '18', '-tag:v', 'hvc1'];
  }
  if (codec === 'h264') {
    if (stdout.includes('h264_nvenc')) return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '18'];
    if (stdout.includes('libx264')) return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18'];
  }
  throw new Error(`入力コーデック ${codec} を維持できるエンコーダーがありません`);
}

async function cutMatch(source, destination, segment, codecArgs) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-fflags', '+discardcorrupt', '-err_detect', 'ignore_err',
    '-ss', segment.start.toFixed(3), '-i', source,
    '-t', (segment.end - segment.start).toFixed(3), '-map', '0:v:0', '-map', '0:a?',
    ...codecArgs, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', '-y', destination,
  ]);
  return probeMedia(destination);
}

function matchRecord(id, segment, number, clipMedia) {
  const fileName = `match-${String(number).padStart(2, '0')}.mp4`;
  return {
    id: `${id}-match-${String(number).padStart(2, '0')}`,
    number,
    fileName,
    start: segment.start,
    end: segment.end,
    duration: clipMedia.duration,
    status: 'split',
  };
}

async function reusableMatches(id, finalClips, segments) {
  const matches = [];
  try {
    for (let index = 0; index < segments.length; index += 1) {
      const number = index + 1;
      const fileName = `match-${String(number).padStart(2, '0')}.mp4`;
      const clipMedia = await probeMedia(path.join(finalClips, fileName));
      const expectedDuration = segments[index].end - segments[index].start;
      if (!clipMedia.audioCodec || Math.abs(clipMedia.duration - expectedDuration) > 0.75) return null;
      matches.push(matchRecord(id, segments[index], number, clipMedia));
    }
    return matches;
  } catch {
    return null;
  }
}

export class Pipeline {
  constructor(store) {
    this.store = store;
    this.queue = [];
    this.processing = false;
    this.scanTimer = null;
  }

  async start({ autoProcess = true } = {}) {
    await ensureFfmpeg();
    await Promise.all([
      fs.mkdir(RAW_ROOT, { recursive: true }),
      fs.mkdir(MATCH_ROOT, { recursive: true }),
      fs.mkdir(ANALYSIS_ROOT, { recursive: true }),
      fs.mkdir(THUMBNAIL_ROOT, { recursive: true }),
      fs.mkdir(WORK_ROOT, { recursive: true }),
    ]);
    await this.scan({ enqueue: autoProcess });
    if (autoProcess) this.scanTimer = setInterval(() => this.scan().catch(error => console.error(error)), 5000);
  }

  async scan({ enqueue = true } = {}) {
    const files = (await fs.readdir(RAW_ROOT, { withFileTypes: true }))
      .filter(entry => entry.isFile() && /\.(mp4|mov|mkv|webm)$/i.test(entry.name));
    for (const entry of files) {
      const source = path.join(RAW_ROOT, entry.name);
      const stat = await fs.stat(source);
      const id = recordingId(entry.name, stat.size);
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
      if (enqueue && recording.status === 'queued' && !this.queue.includes(id)) this.enqueue(id);
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
    const temporaryClips = path.join(workDir, 'clips');
    const finalClips = path.join(MATCH_ROOT, id);
    await fs.mkdir(workDir, { recursive: true });
    await fs.mkdir(temporaryClips, { recursive: true });

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
      try {
        const inspectionName = path.basename(recording.fileName, path.extname(recording.fileName)).replace(/[^\p{Letter}\p{Number}]+/gu, '-');
        const inspection = JSON.parse(await fs.readFile(path.join(WORK_ROOT, inspectionName, 'inspection.json'), 'utf8'));
        if (!inspection.samples?.length || inspection.samples[0].centerDarkRatio == null) throw new Error('診断サンプルなし');
        samples = inspection.samples;
      } catch {
        samples = await sampleVideo(recording.source, media.duration, {
          interval: 2,
          onProgress: ratio => this.store.patch(id, {
            status: 'splitting',
            phase: '試合区間を検出中',
            progress: 0.05 + ratio * 0.25,
          }).catch(console.error),
        });
      }
      await fs.writeFile(sampleCache, `${JSON.stringify(samples)}\n`);
    }
    const classified = classifySamples(samples, 2);
    await fs.writeFile(path.join(workDir, 'classified.json'), `${JSON.stringify(classified)}\n`);
    const coarseSegments = detectMatchSegments(classified, media.duration, 2);
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

    let matches = await reusableMatches(id, finalClips, segments);
    if (matches) {
      await this.store.patch(id, { status: 'splitting', phase: '分割済み動画を確認中', progress: 0.65 });
    } else {
      const codecArgs = await encoderArgs(media.codec);
      matches = [];
      for (let index = 0; index < segments.length; index += 1) {
        const number = index + 1;
        const fileName = `match-${String(number).padStart(2, '0')}.mp4`;
        const temporary = path.join(temporaryClips, fileName);
        await this.store.patch(id, {
          status: 'splitting',
          phase: `試合${number}/${segments.length}を分割中`,
          progress: 0.3 + (index / segments.length) * 0.35,
        });
        const clipMedia = await cutMatch(recording.source, temporary, segments[index], codecArgs);
        if (!clipMedia.audioCodec) throw new Error(`試合${number}の音声ストリームを確認できませんでした`);
        matches.push(matchRecord(id, segments[index], number, clipMedia));
      }
      await fs.rm(finalClips, { recursive: true, force: true });
      await fs.rename(temporaryClips, finalClips);
    }
    await this.store.patch(id, { matches, status: 'analyzing', phase: '各試合を分析中', progress: 0.68 });

    const analysisDir = path.join(ANALYSIS_ROOT, id);
    const thumbnailDir = path.join(THUMBNAIL_ROOT, id);
    await Promise.all([fs.mkdir(analysisDir, { recursive: true }), fs.mkdir(thumbnailDir, { recursive: true })]);
    const resultAnalyses = [];
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      try {
        resultAnalyses.push(await analyzeResultLocally({
          source: recording.source,
          matchStart: match.start,
          activeEnd: segments[index].activeEnd,
          matchEnd: match.end,
          directResultTime: null,
          preferredScreenType: segments[index].resultBoundary?.screenType,
          workDir,
          matchNumber: index + 1,
        }));
      } catch (error) {
        console.warn(`Result analysis unavailable for match ${index + 1}: ${error.message}`);
        resultAnalyses.push(null);
      }
    }
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
      outcomeAnalyses = [];
      for (let index = 0; index < matches.length; index += 1) {
        await this.store.patch(id, {
          status: 'analyzing',
          phase: `試合${index + 1}/${matches.length}の勝敗発表を検出中`,
          progress: 0.68,
        });
        try {
          outcomeAnalyses.push(await analyzeOutcomeLocally({
            source: recording.source,
            matchStart: matches[index].start,
            activeEnd: segments[index].activeEnd,
            matchEnd: matches[index].end,
          }));
        } catch (error) {
          console.warn(`Outcome analysis unavailable for match ${index + 1}: ${error.message}`);
          outcomeAnalyses.push(null);
        }
      }
      await fs.writeFile(outcomeCache, `${JSON.stringify({
        version: outcomeModelVersion,
        cacheKey: outcomeCacheKey,
        outcomes: outcomeAnalyses,
      }, null, 2)}\n`);
    }
    let stageResults = [];
    try {
      await this.store.patch(id, { status: 'analyzing', phase: 'リザルトからルールとステージを読取中', progress: 0.68 });
      stageResults = await analyzeRecordingStages({
        source: recording.source,
        segments,
        resultTimes: resultAnalyses.map((result, index) => result ? matches[index].start + result.time : null),
        workDir,
      });
    } catch (error) {
      console.warn(`Stage analysis unavailable: ${error.message}`);
    }
    const stageResultsByMatch = new Map(stageResults.map(result => [result.id, result]));
    let previousIdentityResult = null;
    let previousWeaponEvidence = null;
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const cacheKey = segmentCacheKey(segments[index]);
      const gameplayKey = gameplayCacheKey(segments[index]);
      const clipPath = path.join(finalClips, match.fileName);
      const thumbnailName = `match-${String(match.number).padStart(2, '0')}.jpg`;
      await extractJpeg(clipPath, Math.min(35, Math.max(1, match.duration / 3)), path.join(thumbnailDir, thumbnailName), 640);
      const hudCache = path.join(workDir, `battle-hud-match-${String(match.number).padStart(2, '0')}.json`);
      let battleHud;
      try {
        const cached = JSON.parse(await fs.readFile(hudCache, 'utf8'));
        if (cached.version !== 2 || !matchesGameplayCache(cached.cacheKey, segments[index]) || !cached.samples?.length || !cached.samples[0].self) throw new Error('古いHUDキャッシュ');
        battleHud = cached.samples;
      } catch {
        battleHud = await sampleBattleHud(clipPath, match.duration, {
          onProgress: ratio => this.store.patch(id, {
            status: 'analyzing',
            phase: `試合${index + 1}/${matches.length}の生存人数を検出中`,
            progress: 0.68 + ((index + ratio) / matches.length) * 0.3,
          }).catch(console.error),
        });
        await fs.writeFile(hudCache, `${JSON.stringify({ version: 2, cacheKey: gameplayKey, samples: battleHud })}\n`);
      }
      const gameplayEnd = Math.max(0, segments[index].activeEnd - match.start);
      const identityEnd = match.end;
      await this.store.patch(id, {
        status: 'analyzing',
        phase: `試合${index + 1}/${matches.length}の本人ブキを照合中`,
        progress: 0.68 + ((index + 0.82) / matches.length) * 0.3,
      });
      const hudIdentityFrame = await extractRgbFrame(recording.source, match.start + Math.min(20, Math.max(8, gameplayEnd / 3)));
      const identitySamples = await sampleRgbWindow(recording.source, segments[index].activeEnd, identityEnd);
      const directIdentityResult = findIdentityResult(identitySamples);
      const identityReference = directIdentityResult || previousIdentityResult;
      const identityMatch = identityReference
        ? identifySelfHudSlot(identityReference.frame, identityReference.resultRow, hudIdentityFrame)
        : null;
      if (directIdentityResult) previousIdentityResult = directIdentityResult;
      const directWeapon = directIdentityResult
        ? identifyResultWeapon(directIdentityResult.frame, directIdentityResult.resultRow.rowY)
        : null;
      let weaponEvidence = null;
      if (directWeapon) {
        const consistent = directWeapon.status !== 'identified' && previousWeaponEvidence?.id === directWeapon.id;
        weaponEvidence = {
          id: directWeapon.id,
          name: directWeapon.name,
          status: directWeapon.status === 'identified' ? 'identified-from-result-icon' : consistent ? 'confirmed-by-recording-consistency' : 'candidate-only',
          confidence: Number(Math.max(directWeapon.confidence, consistent ? previousWeaponEvidence.confidence * 0.72 : 0).toFixed(3)),
          source: 'result-icon-template-match',
          crop: directWeapon.crop,
          candidates: directWeapon.candidates,
          catalogVersion: weaponCatalogMetadata.version,
        };
        if (weaponEvidence.status !== 'candidate-only') previousWeaponEvidence = weaponEvidence;
      } else if (previousWeaponEvidence) {
        weaponEvidence = {
          ...previousWeaponEvidence,
          status: 'inferred-from-previous-result',
          confidence: Number((previousWeaponEvidence.confidence * 0.55).toFixed(3)),
          source: 'previous-result-icon-template-match',
        };
      }
      let identityConfirmed = Boolean(identityMatch && identityMatch.confidence >= 0.05);
      const verifiedMatch = verifiedAnalysis(recording.fileName, match.number);
      const identity = {
        status: identityConfirmed ? 'confirmed' : 'unconfirmed',
        method: directIdentityResult ? 'result-row-weapon-match' : identityReference ? 'carried-result-weapon-match' : 'result-not-found',
        hudSlot: identityConfirmed ? identityMatch.slot : null,
        confidence: identityMatch?.confidence || 0,
        resultTime: directIdentityResult?.time == null ? null : Number((directIdentityResult.time - match.start).toFixed(2)),
        scores: identityMatch?.scores || [],
        weapon: weaponEvidence,
      };
      const resultAnalysis = resultAnalyses[index];
      const outcome = outcomeAnalyses[index];
      const respawnCache = path.join(workDir, `respawn-hud-match-${String(match.number).padStart(2, '0')}.json`);
      let respawnSamples;
      try {
        const cached = JSON.parse(await fs.readFile(respawnCache, 'utf8'));
        if (cached.modelVersion !== respawnModelVersion || !matchesGameplayCache(cached.cacheKey, segments[index]) || !cached.samples?.length) throw new Error('古い復活UIキャッシュ');
        respawnSamples = cached.samples;
      } catch {
        respawnSamples = await sampleRespawnHud(clipPath, match.duration);
        await fs.writeFile(respawnCache, `${JSON.stringify({ modelVersion: respawnModelVersion, cacheKey: gameplayKey, samples: respawnSamples })}\n`);
      }
      const respawnRuns = detectRespawnRuns(respawnSamples, { gameplayEnd });
      const slotCandidates = (battleHud[0]?.team || []).map((_, slot) => {
        const selfHud = battleHud.map(sample => ({ time: sample.time, ...sample.team[slot] }));
        const hudDeaths = detectSelfDeaths(selfHud, { duration: match.duration, gameplayEnd });
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
      const deathCandidates = applyVerifiedDeathWindows(selectedCandidates?.deaths || respawnRuns, verifiedMatch);
      const deaths = reconcileDeathsWithResult(deathCandidates, resultAnalysis?.deathCount);
      const deathCountMatched = Boolean(resultAnalysis && resultAnalysis.deathCount === deaths.length);
      const perceptionCache = path.join(workDir, `perception-match-${String(match.number).padStart(2, '0')}.json`);
      let perceptionSamples;
      try {
        const cached = JSON.parse(await fs.readFile(perceptionCache, 'utf8'));
        if (cached.version !== 1 || !matchesGameplayCache(cached.cacheKey, segments[index]) || !cached.samples?.length) throw new Error('古い映像認識キャッシュ');
        perceptionSamples = cached.samples;
      } catch {
        let previousPerceptionFrame = null;
        perceptionSamples = await sampleRgbWindow(clipPath, 0, gameplayEnd, {
          interval: 0.5,
          width: 480,
          height: 270,
          onFrame: (frame, width, height, time) => {
            const result = analyzeEnemyColorFrame(frame, previousPerceptionFrame, width, height, time);
            previousPerceptionFrame = frame;
            return result;
          },
        });
        await fs.writeFile(perceptionCache, `${JSON.stringify({ version: 1, cacheKey: gameplayKey, samples: perceptionSamples })}\n`);
      }
      const detections = [
        ...buildDeathCameraDetections(deaths),
        ...detectEnemyColorMotionRuns(perceptionSamples, deaths),
      ].sort((left, right) => left.frames[0][0] - right.frames[0][0]);
      const playerCounts = detectPlayerCounts(battleHud, { gameplayEnd });
      const gameCountCache = path.join(workDir, `game-count-match-${String(match.number).padStart(2, '0')}.json`);
      let gameCountSamples;
      try {
        const cached = JSON.parse(await fs.readFile(gameCountCache, 'utf8'));
        if (cached.modelVersion !== gameCountModelVersion || !matchesGameplayCache(cached.cacheKey, segments[index]) || !cached.samples?.length) throw new Error('古いゲームカウントキャッシュ');
        gameCountSamples = cached.samples;
      } catch {
        gameCountSamples = await sampleGameCountFrames(clipPath, match.duration, {
          interval: 0.5,
          onFrame: (frame, width, _height, time) => analyzeGameCountFrame(frame, width, time),
          onProgress: ratio => this.store.patch(id, {
            status: 'analyzing',
            phase: `試合${index + 1}/${matches.length}のゲームカウントを読取中`,
            progress: 0.68 + ((index + 0.84 + ratio * 0.12) / matches.length) * 0.3,
          }).catch(console.error),
        });
        await fs.writeFile(gameCountCache, `${JSON.stringify({ modelVersion: gameCountModelVersion, cacheKey: gameplayKey, samples: gameCountSamples })}\n`);
      }
      const mapCache = path.join(workDir, `map-candidates-match-${String(match.number).padStart(2, '0')}.json`);
      let mapCandidates;
      try {
        const cached = JSON.parse(await fs.readFile(mapCache, 'utf8'));
        if (cached.version !== 8 || !matchesGameplayCache(cached.cacheKey, segments[index]) || !cached.samples?.length) throw new Error('古いマップ候補キャッシュ');
        mapCandidates = cached.samples;
      } catch {
        mapCandidates = await sampleRgbWindow(clipPath, 0, gameplayEnd, {
          interval: 1,
          onFrame: (frame, width, height, time) => analyzeMapCandidate(frame, width, height, time),
        });
        await fs.writeFile(mapCache, `${JSON.stringify({ version: 8, cacheKey: gameplayKey, samples: mapCandidates })}\n`);
      }
      const hiddenTimes = mapCandidates.filter(sample => sample.mapUi?.visible).map(sample => sample.time);
      const gameCounts = detectGameCounts(gameCountSamples, { gameplayEnd, hiddenTimes });
      const observedMap = selectObservedMapFrame(mapCandidates, deaths);
      const spatialObservations = detectSpatialObservations(mapCandidates);
      const playerRoute = buildPlayerRoute(spatialObservations);
      const spatialPredictions = buildShortPredictions(spatialObservations);
      const allyTracks = detectAllyTracks(mapCandidates);
      const allyPredictions = buildEntityPredictions(allyTracks);
      const enemyThreatZones = buildEnemyThreatZones(deaths, spatialObservations);
      const enemySightPredictions = buildEnemySightPredictions(detections, playerRoute);
      const automaticStage = stageResultsByMatch.get(`match-${String(match.number).padStart(2, '0')}`);
      const acceptedStage = automaticStage?.confidence >= 0.65
        ? automaticStage
        : verifiedMatch?.stageAsset
          ? { ...verifiedMatch, confidence: 1, source: 'verified-stage-map-asset' }
          : null;
      let stageMap = null;
      let observedImageUrl = null;
      if (observedMap) {
        const mapName = `match-${String(match.number).padStart(2, '0')}-map.jpg`;
        await extractJpegCrop(clipPath, observedMap.time, path.join(thumbnailDir, mapName), {
          x: 440, y: 20, width: 1040, height: 1040, outputWidth: 720, outputHeight: 720,
        });
        observedImageUrl = relativeMediaPath('thumbnails', id, mapName);
      }
      if (acceptedStage || observedMap) {
        stageMap = {
          imageUrl: acceptedStage?.stageAsset
            ? `/assets/stage-maps/${encodeURIComponent(acceptedStage.stageAsset)}`
            : observedImageUrl,
          observedImageUrl,
          observedAt: observedMap?.time ?? null,
          source: acceptedStage?.source || observedMap.source,
          confidence: acceptedStage?.confidence ?? observedMap.confidence,
          stage: acceptedStage?.stage || null,
          rule: acceptedStage?.rule || null,
          evidence: acceptedStage?.evidence || null,
          coordinateSpace: { width: 1000, height: 1000 },
        };
      }
      const describedDeaths = describeSelfDeaths(deaths, { detections, playerCounts });
      const deathSequenceResult = await analyzeDeathSequencesWithCodex({ clipPath, deaths: describedDeaths, workDir, matchNumber: index + 1 });
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
        version: 25,
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
        playerIdentity: identity,
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
            source: resultAnalysis?.source || 'result-screen-not-found',
            resultTime: resultAnalysis?.time ?? null,
            matched: resultAnalysis ? deathCountMatched : null,
          },
        },
        stageMap,
        detections,
        playerRoute,
        spatial: {
          observations: spatialObservations,
          entityTracks: allyTracks,
          predictions: [...spatialPredictions, ...allyPredictions, ...enemySightPredictions].sort((left, right) => left.observedAt - right.observedAt),
          threatZones: enemyThreatZones,
          coordinateSpace: { width: 1000, height: 1000 },
          policy: 'observed-map-information-only',
        },
        capabilities: {
          segmentation: 'automatic-hud-heuristic',
          deaths: !resultAnalysis
            ? 'unavailable-no-result-screen'
            : !deathCountMatched
              ? 'unavailable-death-candidates-do-not-match-result'
            : respawnRuns.length
              ? 'result-count-validated-hud-and-respawn-timing-fusion'
              : identityConfirmed
                ? 'result-count-validated-self-hud'
                : 'unavailable-no-death-evidence',
          deathExplanation: analyzedDeaths.some(death => death.analysisSource?.startsWith('codex-vision')) ? 'codex-vision-sequence' : 'automatic-fallback',
          deathSequenceAnalysis: deathSequenceResult.analysis ? 'codex-vision-sequence' : 'available-on-demand',
          playerWeapon: weaponEvidence && weaponEvidence.status !== 'candidate-only'
            ? weaponEvidence.status
            : 'unavailable-low-confidence-result-icon-match',
          playerCounts: 'automatic-battle-hud',
          matchOutcome: outcome
            ? 'automatic-post-match-win-lose-announcement'
            : 'unavailable-post-match-announcement-not-found',
          playerRoute: playerRoute.length ? 'automatic-observed-self-marker-and-inferred-map-route' : 'unavailable-no-grounded-self-marker',
          mapAllies: allyTracks.length ? 'automatic-observed-map-markers-and-facing-prediction' : 'unavailable-no-ally-map-markers',
          enemyThreats: enemyThreatZones.length ? 'predicted-uncertainty-near-verified-self-deaths' : 'unavailable-no-grounded-enemy-location',
          enemyRoutes: enemySightPredictions.length ? 'predicted-from-video-candidate-and-self-route-heading' : 'unavailable-no-overlapping-video-candidate-and-self-route',
          stageMap: automaticStage?.confidence >= 0.65
            ? 'automatic-result-header-stage-and-rule'
            : stageMap
              ? 'automatic-observed-map-screen'
              : 'unavailable-stage-and-map-not-found',
          gameCountOcr: 'automatic-multi-threshold-hud-ocr',
        },
      };
      const analysisName = `match-${String(match.number).padStart(2, '0')}.json`;
      await fs.writeFile(path.join(analysisDir, analysisName), `${JSON.stringify(analysis, null, 2)}\n`);
      Object.assign(match, {
        status: 'ready',
        videoUrl: relativeMediaPath('matches', id, match.fileName),
        thumbnailUrl: relativeMediaPath('thumbnails', id, thumbnailName),
        analysisUrl: `/api/analysis/${encodeURIComponent(id)}/${encodeURIComponent(analysisName)}`,
        eventCount: events.length,
      });
      await this.store.patch(id, {
        matches,
        status: 'analyzing',
        phase: `試合${index + 1}/${matches.length}を分析中`,
        progress: 0.68 + ((index + 1) / matches.length) * 0.3,
      });
    }

    await this.store.patch(id, {
      matches,
      status: 'ready',
      phase: '分析済み',
      progress: 1,
      completedAt: new Date().toISOString(),
    });
  }
}
