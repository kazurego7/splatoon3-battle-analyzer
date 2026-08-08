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

function analyzeHudIcon(frame, frameWidth, height, startX, width, time) {
  let saturated = 0;
  let gray = 0;
  let diagonalDownGray = 0;
  let diagonalDownPixels = 0;
  let diagonalUpGray = 0;
  let diagonalUpPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * frameWidth + startX + x) * 3;
      const r = frame[at];
      const g = frame[at + 1];
      const b = frame[at + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max ? (max - min) / max : 0;
      if (saturation >= 0.35 && max >= 70) saturated += 1;
      const isGray = saturation <= 0.14 && max >= 35 && max <= 210;
      if (isGray) gray += 1;
      if (x >= 7 && x <= 60 && y >= 7 && y <= 55) {
        const diagonalDownX = 9 + (y - 9) * 1.02;
        const diagonalUpX = 58 - (y - 9) * 1.02;
        if (Math.abs(x - diagonalDownX) <= 4) {
          diagonalDownPixels += 1;
          if (isGray) diagonalDownGray += 1;
        }
        if (Math.abs(x - diagonalUpX) <= 4) {
          diagonalUpPixels += 1;
          if (isGray) diagonalUpGray += 1;
        }
      }
    }
  }
  const pixels = width * height;
  return {
    time,
    saturatedRatio: saturated / pixels,
    grayRatio: gray / pixels,
    diagonalDown: diagonalDownGray / Math.max(1, diagonalDownPixels),
    diagonalUp: diagonalUpGray / Math.max(1, diagonalUpPixels),
  };
}

function analyzeHudRegion(frame, frameWidth, startX, startY, width, height) {
  let dark = 0;
  let white = 0;
  let edge = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = ((startY + y) * frameWidth + startX + x) * 3;
      const r = frame[at];
      const g = frame[at + 1];
      const b = frame[at + 2];
      if (r < 48 && g < 48 && b < 48) dark += 1;
      if (r > 190 && g > 190 && b > 190) white += 1;
      if (x > 0) {
        const left = at - 3;
        if (Math.abs(r - frame[left]) + Math.abs(g - frame[left + 1]) + Math.abs(b - frame[left + 2]) > 150) edge += 1;
      }
    }
  }
  const pixels = width * height;
  return { darkRatio: dark / pixels, whiteRatio: white / pixels, edgeRatio: edge / pixels };
}

export async function sampleSelfHud(source, duration, { interval = 0.25, onProgress } = {}) {
  const width = 70;
  const height = 60;
  const frameSize = width * height * 3;
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, [
      '-hide_banner', '-loglevel', 'error', '-hwaccel', 'auto', '-i', source,
      '-vf', `fps=1/${interval},scale=1920:1080,crop=140:120:790:0,scale=${width}:${height}`,
      '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1',
    ], { windowsHide: true });
    const samples = [];
    let pending = Buffer.alloc(0);
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.stdout.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= frameSize) {
        const frame = pending.subarray(0, frameSize);
        pending = pending.subarray(frameSize);
        const sample = analyzeHudIcon(frame, width, height, 0, width, samples.length * interval);
        samples.push(sample);
        if (samples.length % 40 === 0) onProgress?.(Math.min(1, sample.time / duration));
      }
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(samples);
      else reject(new Error(`自分のデス状態サンプリングに失敗しました: ${stderr.slice(-1500)}`));
    });
  });
}

export async function sampleBattleHud(source, duration, { interval = 0.25, onProgress } = {}) {
  const battleWidth = 495;
  const selfWidth = 70;
  const width = battleWidth + selfWidth;
  const height = 60;
  const iconWidth = 70;
  const iconStarts = [8, 60, 113, 165, 275, 325, 375, 425];
  const frameSize = width * height * 3;
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, [
      '-hide_banner', '-loglevel', 'error', '-hwaccel', 'auto', '-i', source,
      '-vf', `fps=1/${interval},scale=1920:1080,split=2[battle][self];[battle]crop=990:120:460:0,scale=${battleWidth}:${height}[wide];[self]crop=140:120:790:0,scale=${selfWidth}:${height}[own];[wide][own]hstack=inputs=2`,
      '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1',
    ], { windowsHide: true });
    const samples = [];
    let pending = Buffer.alloc(0);
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.stdout.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= frameSize) {
        const frame = pending.subarray(0, frameSize);
        pending = pending.subarray(frameSize);
        const time = samples.length * interval;
        const icons = iconStarts.map(startX => analyzeHudIcon(frame, width, height, startX, iconWidth, time));
        const timer = analyzeHudRegion(frame, width, 230, 5, 55, 50);
        const self = analyzeHudIcon(frame, width, height, battleWidth, selfWidth, time);
        samples.push({ time, timer, team: icons.slice(0, 4), enemy: icons.slice(4), self });
        if (samples.length % 40 === 0) onProgress?.(Math.min(1, time / duration));
      }
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(samples);
      else reject(new Error(`生存枚数サンプリングに失敗しました: ${stderr.slice(-1500)}`));
    });
  });
}
