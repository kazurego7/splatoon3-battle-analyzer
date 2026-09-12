import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

// Copied into each analysis workspace; uses only Node built-ins.
export function frameTimes({ time, start, end, step = 1 }, duration) {
  const times = time !== undefined ? [Number(time)] : [];
  if (time === undefined) {
    start = Number(start); end = Number(end); step = Number(step);
    if (![start, end, step].every(Number.isFinite) || step <= 0 || end < start) throw new Error('Invalid start/end/step');
    if (Math.floor((end - start) / step) + 1 > 120) throw new Error('At most 120 frames per call; split the interval into multiple calls');
    for (let t = start; t <= end + 1e-7; t += step) times.push(Number(t.toFixed(4)));
  }
  if (!times.length || times.some(t => !Number.isFinite(t) || t < 0 || t >= duration)) throw new Error('Time must be within the match video (seconds from clip start)');
  return times;
}

export async function inspectVideo(workspace, request) {
  const manifest = JSON.parse(await fs.readFile(path.join(workspace, 'context.json'), 'utf8'));
  if (request.action === 'info') return manifest;
  if (request.action === 'stage_map') return { stageMapImage: manifest.stageMapImage || null };
  if (request.action === 'data') {
    const data = JSON.parse(await fs.readFile(path.join(workspace, 'preanalysis.json'), 'utf8'));
    return request.key ? request.key.split('.').reduce((value, key) => value?.[key], data) ?? null : data;
  }
  if (!['frame', 'frames'].includes(request.action)) throw new Error('Use info, data, frame or frames');
  const times = frameTimes(request, manifest.duration);
  const width = Number(request.width ?? 1280);
  if (!Number.isInteger(width) || width < 320 || width > 3840) throw new Error('width must be 320–3840');
  let filter = `scale=${width}:-2`;
  if (request.crop) {
    const { x, y, width: w, height: h } = request.crop;
    if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1
      || x + w > manifest.width || y + h > manifest.height) throw new Error('crop must be inside the original video dimensions');
    filter = `crop=${w}:${h}:${x}:${y},${filter}`;
  }
  const dir = await fs.mkdtemp(path.join(workspace, 'frames-'));
  const frames = [];
  for (const time of times) {
    const output = path.join(dir, `${time.toFixed(4)}.jpg`);
    await new Promise((resolve, reject) => {
      const child = spawn(manifest.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(time + (manifest.sourceOffset || 0)), '-i', manifest.video,
        '-frames:v', '1', '-vf', filter, '-q:v', '2', '-y', output], { windowsHide: true });
      let error = '';
      child.stderr.on('data', chunk => { error += chunk; });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(new Error(error.slice(-2000))));
    });
    await fs.access(output);
    frames.push({ time, path: output });
  }
  await fs.appendFile(path.join(workspace, 'inspections.jsonl'), JSON.stringify({ at: new Date().toISOString(), request, frames }) + '\n');
  return { frames, instruction: 'Open these files with the image viewing tool to inspect the actual pixels. File creation alone is not visual evidence.' };
}

export function serveVideoTools(workspace, input = process.stdin, output = process.stdout) {
  const reader = readline.createInterface({ input });
  const respond = value => output.write(JSON.stringify(value) + '\n');
  const schema = { type: 'object', properties: {
    action: { type: 'string', enum: ['info', 'data', 'frame', 'frames', 'stage_map'] },
    key: { type: 'string', description: 'Optional dot path into preanalysis, e.g. gameFlow.gameCounts' },
    time: { type: 'number', description: 'Single frame time in seconds from match clip start' },
    start: { type: 'number' }, end: { type: 'number' }, step: { type: 'number' }, width: { type: 'integer' },
    crop: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' } }, required: ['x', 'y', 'width', 'height'], additionalProperties: false },
  }, required: ['action'], additionalProperties: false };
  reader.on('line', async line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id === undefined) return;
    try {
      let result;
      if (message.method === 'initialize') result = { protocolVersion: message.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'match-video', version: '1.0.0' } };
      else if (message.method === 'ping') result = {};
      else if (message.method === 'tools/list') result = { tools: [{ name: 'inspect_match',
        description: 'Read the assigned match video metadata or preanalysis; inspect any chosen video time or interval. frame/frames returns actual image content with timestamps, optionally cropped. Up to 12 frames per call; repeat freely for further investigation. No shell commands needed.',
        inputSchema: schema, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }] };
      else if (message.method === 'tools/call') {
        if (message.params?.name !== 'inspect_match') throw new Error('Unknown tool');
        const request = message.params.arguments || {};
        if (['frame', 'frames'].includes(request.action)) {
          const manifest = JSON.parse(await fs.readFile(path.join(workspace, 'context.json'), 'utf8'));
          if (frameTimes(request, manifest.duration).length > 12) throw new Error('At most 12 images per tool call; choose fewer times or split the interval');
        }
        const data = await inspectVideo(workspace, request);
        const content = [{ type: 'text', text: JSON.stringify(data) }];
        for (const frame of data?.frames || []) {
          content.push({ type: 'text', text: `Match time: ${frame.time} seconds` });
          content.push({ type: 'image', mimeType: 'image/jpeg', data: (await fs.readFile(frame.path)).toString('base64') });
        }
        if (data?.stageMapImage) content.push({ type: 'image', mimeType: /\.png$/i.test(data.stageMapImage) ? 'image/png' : /\.webp$/i.test(data.stageMapImage) ? 'image/webp' : 'image/jpeg', data: (await fs.readFile(data.stageMapImage)).toString('base64') });
        result = { content };
      } else { respond({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }); return; }
      respond({ jsonrpc: '2.0', id: message.id, result });
    } catch (error) { respond({ jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: error.message }] } }); }
  });
  return reader;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--mcp') {
  serveVideoTools(path.dirname(fileURLToPath(import.meta.url)));
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    // Request file avoids Windows shell quoting issues with inline JSON.
    const request = JSON.parse(await fs.readFile(path.resolve(process.argv[2]), 'utf8'));
    console.log(JSON.stringify(await inspectVideo(path.dirname(fileURLToPath(import.meta.url)), request)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
