import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ANALYSIS_ROOT, MATCH_ROOT, RAW_ROOT, THUMBNAIL_ROOT, WORK_ROOT } from './paths.mjs';
import { ensureFfmpeg, extractJpeg, probeMedia, runFfmpeg, sampleVideo } from './ffmpeg.mjs';
import { analysisEvents, classifySamples, detectMatchSegments } from './segmentation.mjs';

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
    '-hide_banner', '-loglevel', 'error', '-ss', segment.start.toFixed(3), '-i', source,
    '-t', (segment.end - segment.start).toFixed(3), '-map', '0:v:0', '-map', '0:a?',
    ...codecArgs, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', '-y', destination,
  ]);
  return probeMedia(destination);
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
    const segments = detectMatchSegments(classified, media.duration, 2);
    if (!segments.length) throw new Error('試合区間を検出できませんでした。HUD検出しきい値の調整が必要です');
    await fs.writeFile(path.join(workDir, 'manifest.json'), `${JSON.stringify({ source: recording.source, segments }, null, 2)}\n`);

    const codecArgs = await encoderArgs(media.codec);
    const matches = [];
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
      matches.push({
        id: `${id}-match-${String(number).padStart(2, '0')}`,
        number,
        fileName,
        start: segments[index].start,
        end: segments[index].end,
        duration: clipMedia.duration,
        status: 'split',
      });
    }

    await fs.rm(finalClips, { recursive: true, force: true });
    await fs.rename(temporaryClips, finalClips);
    await this.store.patch(id, { matches, status: 'analyzing', phase: '各試合を分析中', progress: 0.68 });

    const analysisDir = path.join(ANALYSIS_ROOT, id);
    const thumbnailDir = path.join(THUMBNAIL_ROOT, id);
    await Promise.all([fs.mkdir(analysisDir, { recursive: true }), fs.mkdir(thumbnailDir, { recursive: true })]);
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const clipPath = path.join(finalClips, match.fileName);
      const thumbnailName = `match-${String(match.number).padStart(2, '0')}.jpg`;
      await extractJpeg(clipPath, Math.min(35, Math.max(1, match.duration / 3)), path.join(thumbnailDir, thumbnailName), 640);
      const events = analysisEvents(classified, match.start, match.end);
      const series = classified
        .filter(sample => sample.time >= match.start && sample.time <= match.end)
        .map(sample => ({
          time: sample.time - match.start,
          motion: Number(sample.difference.toFixed(2)),
          hud: Number(sample.gameScore.toFixed(3)),
          gameplay: sample.gameplay,
        }));
      const analysis = {
        version: 1,
        recordingId: id,
        matchId: match.id,
        generatedAt: new Date().toISOString(),
        source: { fileName: recording.fileName, start: match.start, end: match.end },
        media: { duration: match.duration, codec: media.codec, width: media.width, height: media.height, fps: media.fps },
        events,
        series,
        capabilities: {
          segmentation: 'automatic-hud-heuristic',
          sceneAnalysis: 'frame-difference',
          deaths: 'candidate-only',
          playerRoute: 'not-yet-available',
          gameCountOcr: 'not-yet-available',
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
