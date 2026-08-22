import fs from 'node:fs/promises';
import path from 'node:path';
import { probeMedia, runFfmpeg } from './ffmpeg.mjs';

const REMOTE_VIDEO_VERSION = 1;
const activeJobs = new Map();
const encoderPromises = new Map();

function metadataPath(output) {
  return `${output}.remote.json`;
}

async function sourceSignature(source) {
  const stat = await fs.stat(source);
  return { size: stat.size, modified: stat.mtimeMs };
}

async function compatibleEncoder(codec) {
  if (!['h264', 'hevc'].includes(codec)) throw new Error(`未対応のネットワーク動画コーデックです: ${codec}`);
  if (!encoderPromises.has(codec)) encoderPromises.set(codec, runFfmpeg(['-hide_banner', '-encoders']).then(({ stdout }) => {
    if (codec === 'hevc' && stdout.includes('hevc_nvenc')) return {
      input: ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
      output: ['-c:v', 'hevc_nvenc', '-preset', 'p5', '-tag:v', 'hvc1', '-b:v', '2500k', '-maxrate', '3500k', '-bufsize', '7000k'],
      softwareOutput: ['-c:v', 'libx265', '-preset', 'veryfast', '-tag:v', 'hvc1', '-crf', '25', '-maxrate', '3500k', '-bufsize', '7000k'],
      hardware: true,
    };
    if (codec === 'hevc' && stdout.includes('libx265')) return {
      input: [],
      output: ['-c:v', 'libx265', '-preset', 'veryfast', '-tag:v', 'hvc1', '-crf', '25', '-maxrate', '3500k', '-bufsize', '7000k'],
      hardware: false,
    };
    if (codec === 'h264' && stdout.includes('h264_nvenc')) return {
      input: ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
      output: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-profile:v', 'high', '-b:v', '3500k', '-maxrate', '4500k', '-bufsize', '9000k'],
      softwareOutput: ['-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-crf', '23', '-maxrate', '4500k', '-bufsize', '9000k'],
      hardware: true,
    };
    if (codec === 'h264' && stdout.includes('libx264')) return {
      input: [],
      output: ['-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-crf', '23', '-maxrate', '4500k', '-bufsize', '9000k'],
      hardware: false,
    };
    throw new Error(`ネットワーク再生用の${codec === 'hevc' ? 'HEVC' : 'H.264'}エンコーダーがありません`);
  }));
  return encoderPromises.get(codec);
}

export async function remoteVideoReady(source, output, codec = 'h264') {
  try {
    const [signature, metadata, outputStat] = await Promise.all([
      sourceSignature(source),
      fs.readFile(metadataPath(output), 'utf8').then(JSON.parse),
      fs.stat(output),
    ]);
    return outputStat.isFile()
      && outputStat.size > 0
      && metadata.version === REMOTE_VIDEO_VERSION
      && metadata.source?.size === signature.size
      && metadata.source?.modified === signature.modified
      && metadata.media?.codec === codec;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return false;
    throw error;
  }
}

async function transcodeRemoteVideo(source, output, codec) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.${Date.now()}.tmp.mp4`;
  const encoder = await compatibleEncoder(codec);
  const commonOutput = [
    '-map', '0:v:0', '-map', '0:a?', '-vf', 'scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30',
    ...encoder.output, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', temporary,
  ];
  try {
    try {
      await runFfmpeg([
        '-hide_banner', '-loglevel', 'error', '-fflags', '+discardcorrupt', '-err_detect', 'ignore_err',
        ...encoder.input, '-i', source, ...commonOutput,
      ]);
    } catch (error) {
      if (!encoder.hardware) throw error;
      await fs.rm(temporary, { force: true });
      await runFfmpeg([
        '-hide_banner', '-loglevel', 'error', '-fflags', '+discardcorrupt', '-err_detect', 'ignore_err',
        '-i', source,
        '-map', '0:v:0', '-map', '0:a?', '-vf', 'scale=w=1280:h=720:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30',
        ...encoder.softwareOutput, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', temporary,
      ]);
    }
    const [signature, media, stat] = await Promise.all([
      sourceSignature(source),
      probeMedia(temporary),
      fs.stat(temporary),
    ]);
    if (media.codec !== codec) throw new Error(`ネットワーク用動画のコーデックが一致しません: ${media.codec}`);
    await fs.rename(temporary, output);
    const metadata = {
      version: REMOTE_VIDEO_VERSION,
      generatedAt: new Date().toISOString(),
      source: signature,
      output: { size: stat.size },
      media,
    };
    const metadataTemporary = `${metadataPath(output)}.${process.pid}.tmp`;
    await fs.writeFile(metadataTemporary, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    await fs.rename(metadataTemporary, metadataPath(output));
    return metadata;
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function remoteVideoState(source, output, codec = 'h264') {
  if (await remoteVideoReady(source, output, codec)) return { status: 'ready', codec };
  const job = activeJobs.get(path.resolve(output));
  if (!job) return { status: 'missing', codec };
  if (job.status === 'error') return { status: 'error', codec, message: job.message };
  return { status: 'preparing', codec };
}

export async function prepareRemoteVideo(source, output, codec = 'h264') {
  if (await remoteVideoReady(source, output, codec)) return { status: 'ready', codec };
  const key = path.resolve(output);
  const existing = activeJobs.get(key);
  if (existing?.status === 'preparing') return { status: 'preparing', promise: existing.promise };
  const job = { status: 'preparing', message: null, promise: null };
  job.promise = transcodeRemoteVideo(source, output, codec)
    .then(() => { activeJobs.delete(key); return { status: 'ready', codec }; })
    .catch(error => {
      job.status = 'error';
      job.message = error.message;
      throw error;
    });
  job.promise.catch(() => {});
  activeJobs.set(key, job);
  return { status: 'preparing', promise: job.promise };
}
