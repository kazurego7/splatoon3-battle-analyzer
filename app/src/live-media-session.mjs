import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { FFMPEG_PATH } from './paths.mjs';

const READ_SIZE = 1024 * 1024;
const encoderAvailability = new Map();

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function encoderWorks(ffmpegPath, encoder) {
  const key = `${ffmpegPath}\0${encoder}`;
  if (!encoderAvailability.has(key)) {
    encoderAvailability.set(key, new Promise(resolve => {
      const child = spawn(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=size=128x72:rate=1',
        '-frames:v', '1', '-an', '-c:v', encoder, '-f', 'null', '-',
      ], { windowsHide: true, stdio: 'ignore' });
      child.once('error', () => resolve(false));
      child.once('close', code => resolve(code === 0));
    }));
  }
  return encoderAvailability.get(key);
}

export async function resolveLiveProxyEncoder(ffmpegPath = FFMPEG_PATH) {
  const configured = String(process.env.SPLATOON_LIVE_PROXY_ENCODER || '').trim();
  if (configured) {
    if (await encoderWorks(ffmpegPath, configured)) return configured;
    throw new Error(`録画中再生用エンコーダーを利用できません: ${configured}`);
  }
  if (await encoderWorks(ffmpegPath, 'h264_nvenc')) return 'h264_nvenc';
  return 'libx264';
}

export function parseSegmentList(value) {
  return String(value || '').split(/\r?\n/u).flatMap(line => {
    if (!line.trim()) return [];
    const match = line.match(/^"?([^",]+)"?,([\d.]+),([\d.]+)$/u);
    if (!match) return [];
    const start = Number(match[2]);
    const end = Number(match[3]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return [{ fileName: path.basename(match[1]), start, end, duration: end - start }];
  });
}

class RawFramePipe {
  constructor(stream, { width, height, interval, onFrame }) {
    this.frameSize = width * height * 3;
    this.interval = interval;
    this.onFrame = onFrame;
    this.pending = Buffer.alloc(0);
    this.frameNumber = 0;
    stream.on('data', chunk => this.push(chunk));
  }

  push(chunk) {
    this.pending = Buffer.concat([this.pending, chunk]);
    while (this.pending.length >= this.frameSize) {
      const frame = Buffer.from(this.pending.subarray(0, this.frameSize));
      this.pending = this.pending.subarray(this.frameSize);
      const time = Number((this.frameNumber * this.interval).toFixed(3));
      this.frameNumber += 1;
      this.onFrame(frame, time);
    }
  }
}

export class LiveMediaSession extends EventEmitter {
  constructor({ source, outputDir, segmentSeconds = 6, ffmpegPath = FFMPEG_PATH, pollMilliseconds = 200, proxyEncoder = null }) {
    super();
    this.source = source;
    this.outputDir = outputDir;
    this.segmentSeconds = segmentSeconds;
    this.ffmpegPath = ffmpegPath;
    this.pollMilliseconds = pollMilliseconds;
    this.proxyEncoder = proxyEncoder;
    this.child = null;
    this.childClosed = null;
    this.position = 0;
    this.stopping = false;
    this.completed = null;
    this.stderr = '';
  }

  async start() {
    if (this.completed) return this.completed;
    await fs.mkdir(this.outputDir, { recursive: true });
    const listPath = path.join(this.outputDir, 'segments.csv');
    const segmentPattern = path.join(this.outputDir, 'segment-%06d.mp4');
    const proxyEncoder = this.proxyEncoder || await resolveLiveProxyEncoder(this.ffmpegPath);
    // These compressed fragments are for remote playback. Local playback reads
    // the original recording directly, including while OBS is still writing.
    const proxyVideoOptions = proxyEncoder === 'h264_nvenc'
      ? ['-c:v', proxyEncoder, '-preset', 'p4', '-tune', 'll', '-b:v', '3M', '-maxrate', '4M', '-bufsize', '6M', '-forced-idr', '1']
      : ['-c:v', proxyEncoder, '-preset', 'ultrafast', '-crf', '26', '-maxrate', '4M', '-bufsize', '6M', '-sc_threshold', '0'];
    const args = [
      '-hide_banner', '-loglevel', 'error', '-fflags', '+genpts+discardcorrupt', '-i', 'pipe:0',
      '-map', '0:v:0', '-map', '0:a?', '-vf', 'scale=-2:720', ...proxyVideoOptions,
      '-profile:v', 'high', '-level:v', '4.0', '-pix_fmt', 'yuv420p', '-g', '120', '-keyint_min', '120',
      '-force_key_frames', `expr:gte(t,n_forced*${this.segmentSeconds})`, '-c:a', 'aac', '-b:a', '96k',
      '-f', 'segment', '-segment_time', String(this.segmentSeconds), '-reset_timestamps', '1',
      '-segment_list', listPath, '-segment_list_type', 'csv',
      '-segment_format', 'mp4', '-segment_format_options', 'movflags=+frag_keyframe+empty_moov+default_base_moof',
      '-y', segmentPattern,
      '-map', '0:v:0', '-vf', 'fps=4,scale=1920:1080,split=2[battle][self];[battle]crop=990:120:460:0,scale=495:60[wide];[self]crop=140:120:790:0,scale=70:60[own];[wide][own]hstack=inputs=2',
      '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:3',
      '-map', '0:v:0', '-vf', 'fps=4,scale=1920:1080,crop=440:120:1480:940,scale=220:60',
      '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:4',
      '-map', '0:v:0', '-vf', 'fps=2,scale=160:90',
      '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:5',
      '-map', '0:v:0', '-vf', 'fps=4,scale=960:540',
      '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:6',
      '-map', '0:v:0', '-vf', 'fps=2,scale=480:270',
      '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:7',
      '-map', '0:v:0', '-vf', 'fps=2,scale=1920:1080,crop=380:180:760:120',
      '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:8',
      '-map', '0:v:0', '-vf', 'fps=2,scale=1920:1080,crop=1000:150:460:135',
      '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:9',
    ];
    this.child = spawn(this.ffmpegPath, args, {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
    });
    // Register immediately. A short or already-finished input can exit in the
    // small interval between closing stdin and awaiting the process; attaching
    // the listener later would miss that close event and wait forever.
    this.childClosed = once(this.child, 'close');
    this.child.stderr.on('data', chunk => {
      this.stderr += chunk.toString();
      if (this.stderr.length > 8000) this.stderr = this.stderr.slice(-8000);
    });
    new RawFramePipe(this.child.stdio[3], { width: 565, height: 60, interval: 0.25, onFrame: (frame, time) => this.emit('battle-hud', frame, time) });
    new RawFramePipe(this.child.stdio[4], { width: 220, height: 60, interval: 0.25, onFrame: (frame, time) => this.emit('respawn-hud', frame, time) });
    new RawFramePipe(this.child.stdio[5], { width: 160, height: 90, interval: 0.5, onFrame: (frame, time) => this.emit('coarse', frame, time) });
    new RawFramePipe(this.child.stdio[6], { width: 960, height: 540, interval: 0.25, onFrame: (frame, time) => this.emit('full', frame, time) });
    new RawFramePipe(this.child.stdio[7], { width: 480, height: 270, interval: 0.5, onFrame: (frame, time) => this.emit('perception', frame, time) });
    new RawFramePipe(this.child.stdio[8], { width: 380, height: 180, interval: 0.5, onFrame: (frame, time) => this.emit('score-count', frame, time) });
    new RawFramePipe(this.child.stdio[9], { width: 1000, height: 150, interval: 0.5, onFrame: (frame, time) => this.emit('objective-count', frame, time) });
    this.completed = this.run().catch(error => {
      this.emit('error', error);
      throw error;
    });
    return this.completed;
  }

  async writeInput(chunk) {
    if (this.child.stdin.write(chunk)) return;
    await once(this.child.stdin, 'drain');
  }

  async run() {
    const handle = await fs.open(this.source, 'r');
    const buffer = Buffer.allocUnsafe(READ_SIZE);
    try {
      while (true) {
        const stat = await handle.stat();
        if (stat.size < this.position) break;
        if (stat.size === this.position) {
          if (this.stopping) break;
          await delay(this.pollMilliseconds);
          continue;
        }
        const length = Math.min(buffer.length, stat.size - this.position);
        const { bytesRead } = await handle.read(buffer, 0, length, this.position);
        if (!bytesRead) {
          await delay(this.pollMilliseconds);
          continue;
        }
        await this.writeInput(buffer.subarray(0, bytesRead));
        this.position += bytesRead;
        this.emit('progress', { bytesRead: this.position, fileSize: stat.size });
      }
    } finally {
      await handle.close();
      this.child.stdin.end();
    }
    const [code] = await this.childClosed;
    if (code !== 0) throw new Error(`リアルタイム映像処理に失敗しました: ${this.stderr.slice(-2000)}`);
    const segments = await this.segments();
    this.emit('complete', segments);
    return segments;
  }

  async segments() {
    try {
      return parseSegmentList(await fs.readFile(path.join(this.outputDir, 'segments.csv'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  stop() {
    this.stopping = true;
  }
}
