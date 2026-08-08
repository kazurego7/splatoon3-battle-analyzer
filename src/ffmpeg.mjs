import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { FFMPEG_PATH } from './paths.mjs';

export async function ensureFfmpeg() {
  await fsp.access(FFMPEG_PATH, fs.constants.X_OK);
  return FFMPEG_PATH;
}

export function runFfmpeg(args, { onStderr, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, args, { windowsHide: true, signal });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      onStderr?.(text);
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`FFmpeg exited with ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

export async function probeMedia(source) {
  const { stderr } = await runFfmpeg([
    '-hide_banner', '-i', source, '-frames:v', '1', '-f', 'null', 'NUL',
  ]);
  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const videoMatch = stderr.match(/Video:\s*([^,\s]+).*?(\d{2,5})x(\d{2,5}).*?(\d+(?:\.\d+)?)\s*fps/);
  const audioMatch = stderr.match(/Audio:\s*([^,\s]+)/);
  if (!durationMatch || !videoMatch) throw new Error('動画メタデータを読み取れませんでした');
  const duration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
  return {
    duration,
    codec: videoMatch[1].toLowerCase(),
    width: Number(videoMatch[2]),
    height: Number(videoMatch[3]),
    fps: Number(videoMatch[4]),
    audioCodec: audioMatch?.[1] || null,
  };
}

export async function extractJpeg(source, at, output, width = 640) {
  await fsp.mkdir(path.dirname(output), { recursive: true });
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, at)), '-i', source,
    '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '5', '-y', output,
  ]);
  return output;
}

export function analyzeRgbFrame(buffer, previous, width, height, time) {
  let brightness = 0;
  let saturation = 0;
  let difference = 0;
  let edges = 0;
  let topCenterWhite = 0;
  let topCenterEdges = 0;
  let topCenterPixels = 0;
  let centerDark = 0;
  let centerWhite = 0;
  let centerEdges = 0;
  let centerPixels = 0;
  const pixelCount = width * height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      const r = buffer[index];
      const g = buffer[index + 1];
      const b = buffer[index + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      brightness += (r + g + b) / 3;
      saturation += max ? (max - min) / max : 0;
      if (previous) difference += (Math.abs(r - previous[index]) + Math.abs(g - previous[index + 1]) + Math.abs(b - previous[index + 2])) / 3;
      if (x > 0) {
        const left = index - 3;
        const edge = Math.abs(r - buffer[left]) + Math.abs(g - buffer[left + 1]) + Math.abs(b - buffer[left + 2]);
        if (edge > 150) edges += 1;
      }
      if (y < Math.round(height * 0.17) && x > width * 0.35 && x < width * 0.65) {
        topCenterPixels += 1;
        if (r > 185 && g > 185 && b > 185) topCenterWhite += 1;
        if (x > 0) {
          const left = index - 3;
          if (Math.abs(r - buffer[left]) + Math.abs(g - buffer[left + 1]) + Math.abs(b - buffer[left + 2]) > 150) topCenterEdges += 1;
        }
      }
      if (y > height * 0.2 && y < height * 0.76 && x > width * 0.24 && x < width * 0.76) {
        centerPixels += 1;
        if (r < 42 && g < 42 && b < 42) centerDark += 1;
        if (r > 190 && g > 190 && b > 190) centerWhite += 1;
        if (x > 0) {
          const left = index - 3;
          if (Math.abs(r - buffer[left]) + Math.abs(g - buffer[left + 1]) + Math.abs(b - buffer[left + 2]) > 150) centerEdges += 1;
        }
      }
    }
  }
  return {
    time,
    brightness: brightness / pixelCount,
    saturation: saturation / pixelCount,
    difference: previous ? difference / pixelCount : 0,
    edgeRatio: edges / pixelCount,
    hudWhiteRatio: topCenterWhite / Math.max(1, topCenterPixels),
    hudEdgeRatio: topCenterEdges / Math.max(1, topCenterPixels),
    centerDarkRatio: centerDark / Math.max(1, centerPixels),
    centerWhiteRatio: centerWhite / Math.max(1, centerPixels),
    centerEdgeRatio: centerEdges / Math.max(1, centerPixels),
  };
}

export async function frameFeaturesAt(source, at, width = 160, height = 90) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, [
      '-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', source,
      '-frames:v', '1', '-vf', `scale=${width}:${height}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1',
    ], { windowsHide: true });
    const chunks = [];
    let stderr = '';
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      const frame = Buffer.concat(chunks);
      if (code === 0 && frame.length >= width * height * 3) resolve(analyzeRgbFrame(frame.subarray(0, width * height * 3), null, width, height, at));
      else reject(new Error(`フレーム特徴を取得できません: ${stderr.slice(-800)}`));
    });
  });
}

export async function sampleVideo(source, duration, { interval = 2, width = 160, onProgress } = {}) {
  const height = 90;
  const frameSize = width * height * 3;
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'error', '-hwaccel', 'auto', '-i', source,
      '-vf', `fps=1/${interval},scale=${width}:${height}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1',
    ];
    const child = spawn(FFMPEG_PATH, args, { windowsHide: true });
    const samples = [];
    let pending = Buffer.alloc(0);
    let previous = null;
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.stdout.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= frameSize) {
        const frame = Buffer.from(pending.subarray(0, frameSize));
        pending = pending.subarray(frameSize);
        const sample = analyzeRgbFrame(frame, previous, width, height, samples.length * interval);
        samples.push(sample);
        previous = frame;
        if (samples.length % 10 === 0) onProgress?.(Math.min(1, sample.time / duration));
      }
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(samples);
      else reject(new Error(`動画サンプリングに失敗しました: ${stderr.slice(-1500)}`));
    });
  });
}
