import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalCloudSignature } from './source-matches.mjs';
import { runFfmpeg, probeMedia } from './ffmpeg.mjs';
import { R2Api, R2_ROOT, CAPACITY_BYTES, writePrivateJson, publicError } from './r2-api.mjs';

const keyFor = (recording, match) => recording.id + ':' + match.number;
const signatureFor = (recording, match) => JSON.stringify([recording.id, recording.source, match.number, match.start, match.end, match.duration, null, Number(match.sourceVideoStart ?? match.start ?? 0)]);

export async function prepareCloudFile(recording, match, output) {
  try { await fs.access(output); return output; } catch {}
  const source = recording.source;
  const duration = Number(match.duration ?? match.end - match.start);
  if (!source || !Number.isFinite(duration) || duration <= 0) throw new Error('試合動画の区間を確認できません。');
  await fs.mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.tmp.mp4`;
  try {
    await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-ss', String(match.sourceVideoStart ?? match.start ?? 0), '-i', source,
      '-t', String(duration), '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-maxrate', '2500k', '-bufsize', '5000k', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-y', temporary]);
    const media = await probeMedia(temporary);
    if (Math.abs(media.duration - duration) > 1) throw new Error('試合末尾まで動画を準備できていません。録画データが揃ってから再試行します。');
    await fs.rename(temporary, output);
    return output;
  } finally { await fs.rm(temporary, { force: true }); }
}

export class CloudService {
  constructor(store, { root = R2_ROOT, api = new R2Api({ root }), prepare = prepareCloudFile, now = Date.now } = {}) {
    Object.assign(this, { store, root, api, prepare, now }); this.jobs = {}; this.writeChain = Promise.resolve(); this.controlChain = Promise.resolve(); this.paused = false;
    this.onChange = () => { void this.tick().catch(() => console.error('R2 queue update failed')); };
  }
  async load() {
    await this.api.load();
    try { this.paused = JSON.parse(await fs.readFile(path.join(this.root, 'controls.json'), 'utf8')).paused === true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { this.jobs = JSON.parse(await fs.readFile(path.join(this.root, 'jobs.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  save() { this.writeChain = this.writeChain.catch(() => {}).then(() => writePrivateJson(path.join(this.root, 'jobs.json'), this.jobs)); return this.writeChain; }
  start() { this.store.on('change', this.onChange); this.onChange(); this.timer = setInterval(this.onChange, 10000); this.timer.unref(); }
  stop() { clearInterval(this.timer); this.store.off('change', this.onChange); }
  find(recordingId, number) {
    const recording = this.store.get(recordingId), match = recording?.matches?.find(item => item.number === Number(number));
    if (!recording || !match) throw Object.assign(new Error('対象の試合が見つかりません。'), { localMessage: true });
    return { recording, match, key: keyFor(recording, match) };
  }
  currentJob(recording, match) {
    const job = this.jobs[keyFor(recording, match)];
    return canonicalCloudSignature(job?.signature) === signatureFor(recording, match) && job?.destination === this.api.identity ? job : null;
  }
  publicJob(job) {
    if (!this.api.identity) return { status: 'setup', message: '自宅PCでR2の接続設定をしてください。' };
    if (!job) return { status: 'queued', message: 'クラウド転送待ち' };
    let { status, message, updatedAt, totalBytes, bytes } = job;
    if (this.paused && !['ready', 'capacity', 'missing'].includes(status)) { status = 'paused'; message = 'R2転送を一時停止中'; }
    return { status, message, updatedAt, totalBytes, progress: totalBytes ? Math.min(1, (bytes || 0) / totalBytes) : 0,
      url: status === 'ready' ? `/api/cloud/${encodeURIComponent(job.recordingId)}/${job.number}/play` : null };
  }
  decorate(recordings) { return recordings.map(recording => ({ ...recording, matches: (recording.matches || []).map(match => ({ ...match, cloud: this.publicJob(this.currentJob(recording, match)) })) })); }
  summary() { return { paused: this.paused, connected: Boolean(this.api.identity), bucket: this.api.config?.bucket || '', usedBytes: this.api.usedBytes ?? null, usageCheckedAt: this.api.usageCheckedAt || null, limitBytes: CAPACITY_BYTES, recordings: this.decorate(this.store.list()) }; }
  async setPaused(paused) {
    this.paused = paused;
    if (paused) this.uploadController?.abort();
    this.controlChain = this.controlChain.catch(() => {}).then(() => writePrivateJson(path.join(this.root, 'controls.json'), { paused }));
    await this.controlChain;
    if (!this.paused) this.onChange();
    return { paused: this.paused };
  }
  async configure(value) {
    if (this.uploadPromise || this.running || this.configuring) throw Object.assign(new Error('動画の転送・確認が終わってから設定を変更してください。'), { localMessage: true });
    this.configuring = true;
    try { await this.api.configure(value); } finally { this.configuring = false; }
    this.onChange();
  }
  async retry(recordingId, number) {
    const { recording, match, key } = this.find(recordingId, number);
    if (this.activeKey === key) return;
    const job = this.currentJob(recording, match) || this.makeJob(recording, match);
    job.status = job.status === 'ready' ? 'ready' : 'queued'; job.nextCheck = 0; job.attempts = 0;
    this.jobs[key] = job; await this.save(); this.onChange();
  }
  makeJob(recording, match) {
    const signature = signatureFor(recording, match), hash = createHash('sha256').update(signature).digest('hex');
    return { recordingId: recording.id, number: match.number, signature, destination: this.api.identity,
      objectKey: `splatoon/v1/${hash}.mp4`, file: path.join(this.root, 'uploads', `${hash}.mp4`), status: 'queued', attempts: 0, nextCheck: 0 };
  }
  async update(job, patch) { Object.assign(job, patch, { updatedAt: new Date(this.now()).toISOString() }); await this.save(); }
  async playbackUrl(recordingId, number) {
    const { recording, match } = this.find(recordingId, number), job = this.currentJob(recording, match);
    if (!this.api.identity || match.status !== 'ready' || job?.status !== 'ready') throw Object.assign(new Error('クラウドで再生準備中です。'), { localMessage: true });
    return this.api.playbackUrl(job.objectKey);
  }
  async tick() {
    if (this.running || this.configuring) return;
    this.running = true;
    try {
      const candidates = []; let changed = false;
      for (const recording of this.store.list()) for (const match of recording.matches || []) {
        if (match.status !== 'ready') continue;
        const key = keyFor(recording, match);
        if (this.activeKey === key) continue;
        if (!this.currentJob(recording, match)) { this.jobs[key] = this.makeJob(recording, match); changed = true; }
        candidates.push({ recording, match, key, job: this.jobs[key] });
      }
      if (changed) await this.save();
      if (!this.api.identity || this.paused) return;
      for (const { job } of candidates.filter(item => item.job.status === 'ready' && item.job.nextCheck <= this.now())) {
        if (this.paused) return;
        try { await this.api.verify(job); await this.update(job, { nextCheck: this.now() + 6 * 3600000 }); }
        catch (error) { await this.update(job, error.code === 'object_missing'
          ? { status: 'missing', message: 'R2の動画が削除されています。必要な場合だけ再転送してください。', nextCheck: 0 }
          : { status: 'error', message: 'クラウド動画を再確認しています。', nextCheck: this.now() + 60000 }); }
      }
      if (!this.uploadPromise && !this.paused) {
        const candidate = candidates.find(({ job }) => !['ready', 'capacity', 'missing'].includes(job.status) && job.nextCheck <= this.now());
        if (candidate) {
          this.activeKey = candidate.key;
          this.uploadController = new AbortController();
          this.uploadPromise = this.process(candidate, this.uploadController.signal).catch(() => console.error('R2 upload state save failed')).finally(() => { this.uploadPromise = null; this.activeKey = null; this.uploadController = null; });
        }
      }
    } finally { this.running = false; }
  }
  async process({ recording, match, job }, signal) {
    try {
      signal?.throwIfAborted();
      // A crash after completing the object must not require re-encoding or re-uploading it.
      if (job.sha256 && job.totalBytes) {
        try { await this.api.verify(job, { signal }); signal?.throwIfAborted(); await this.complete(job); return; } catch {}
      }
      signal?.throwIfAborted();
      await this.update(job, { status: 'preparing', message: 'クラウド用動画を準備中' });
      if (job.uploadId) await fs.access(job.file); else await this.prepare(recording, match, job.file);
      signal?.throwIfAborted();
      await this.update(job, { status: 'uploading', message: 'R2へ転送中' });
      await this.api.upload(job, () => this.save(), { signal });
      signal?.throwIfAborted();
      await this.update(job, { status: 'verifying', message: 'R2から再生できるか確認中' });
      await this.api.verify(job, { signal }); signal?.throwIfAborted(); await this.complete(job);
    } catch (error) {
      if (signal?.aborted) { await this.update(job, { status: 'queued', message: 'クラウド転送待ち', nextCheck: 0 }); return; }
      const attempts = (job.attempts || 0) + 1;
      await this.update(job, { status: error.code === 'capacity' ? 'capacity' : 'error', message: publicError(error), attempts, nextCheck: this.now() + Math.min(3600000, 30000 * 2 ** Math.min(attempts, 7)) });
    }
  }
  async complete(job) {
    await this.update(job, { status: 'ready', message: 'クラウドで再生できます', bytes: job.totalBytes, nextCheck: this.now() + 6 * 3600000 });
    // Only the disposable transcode is removed; local source and match videos are retained.
    await fs.rm(job.file, { force: true });
    if (!this.paused) { try { await this.api.usage(); } catch {} }
  }
}
