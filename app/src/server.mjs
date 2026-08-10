import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Pipeline } from './pipeline.mjs';
import { Store } from './store.mjs';
import { analyzeDeathSequencesWithCodex } from './codex-death-analysis.mjs';
import { ANALYSIS_ROOT, MATCH_ROOT, POSITION_PLANS_FILE, PROJECT_ROOT, PUBLIC_ROOT, THUMBNAIL_ROOT, WORK_ROOT } from './paths.mjs';

const PORT = Number(process.env.PORT || 4310);
const store = new Store();
await store.load();
const pipeline = new Pipeline(store);
const runningDeathAnalyses = new Set();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
};

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

async function readPositionPlans() {
  try { return JSON.parse(await fsp.readFile(POSITION_PLANS_FILE, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

function positionPlanKey(stage, rule) {
  return `${stage.trim()}\u0000${rule.trim()}`;
}

function validateMapPoint(value, label) {
  const x = Number(value?.x), y = Number(value?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1000 || y < 0 || y > 1000) {
    throw new Error(`${label}の座標が不正です`);
  }
  return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
}

function validatePositionPlan(value) {
  const legacy = Array.isArray(value) ? value : null;
  const source = legacy
    ? { strongPositions: [], briefings: legacy.length ? [{ id: 'legacy', title: '旧位置取り', situation: '', movement: '', route: legacy }] : [] }
    : value || {};
  const strongPositions = source.strongPositions || [], briefings = source.briefings || [];
  if (!Array.isArray(strongPositions) || strongPositions.length > 20) throw new Error('有利なポジションは20件以内で指定してください');
  if (!Array.isArray(briefings) || briefings.length > 20) throw new Error('ブリーフィングは20件以内で指定してください');
  return {
    strongPositions: strongPositions.map((spot, index) => ({
      id: String(spot.id || `spot-${index + 1}`).slice(0, 80),
      title: String(spot.title || '').trim().slice(0, 100),
      position: validateMapPoint(spot.position, `有利なポジション${index + 1}`),
      target: validateMapPoint(spot.target, `ターゲット${index + 1}`),
      tips: String(spot.tips || '').trim().slice(0, 500),
    })),
    briefings: briefings.map((briefing, index) => {
      const route = briefing.route || [];
      if (!Array.isArray(route) || route.length > 30) throw new Error(`ブリーフィング${index + 1}の経路は30地点以内で指定してください`);
      return {
        id: String(briefing.id || `briefing-${index + 1}`).slice(0, 80),
        title: String(briefing.title || '').trim().slice(0, 100),
        situation: String(briefing.situation || '').trim().slice(0, 500),
        movement: String(briefing.movement || '').trim().slice(0, 1000),
        route: route.map((point, pointIndex) => validateMapPoint(point, `ブリーフィング${index + 1}の経路${pointIndex + 1}`)),
      };
    }),
  };
}

function safeJoin(root, segments) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments.map(decodeURIComponent));
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('Invalid path');
  return target;
}

async function serveFile(request, response, file) {
  const stat = await fsp.stat(file);
  if (!stat.isFile()) throw new Error('Not a file');
  const type = mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = request.headers.range;
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (!match || start > end || start >= stat.size) {
      response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      response.end();
      return;
    }
    response.writeHead(206, {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(file, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(file).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const parts = url.pathname.split('/').filter(Boolean);

    if (request.method === 'GET' && url.pathname === '/api/recordings') {
      response.setHeader('Cache-Control', 'no-store');
      json(response, 200, store.list());
      return;
    }
    if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'recordings' && parts[3] === 'retry') {
      const recording = store.get(decodeURIComponent(parts[2]));
      if (!recording) return json(response, 404, { error: 'Recording not found' });
      pipeline.enqueue(recording.id, true);
      json(response, 202, { ok: true });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/scan') {
      await readJson(request);
      await pipeline.scan();
      json(response, 202, { ok: true });
      return;
    }
    if (url.pathname === '/api/position-plan') {
      if (request.method === 'GET') {
        const stage = url.searchParams.get('stage') || '', rule = url.searchParams.get('rule') || '';
        if (!stage || !rule) return json(response, 400, { error: 'stage and rule are required' });
        const plans = await readPositionPlans();
        response.setHeader('Cache-Control', 'no-store');
        json(response, 200, { stage, rule, plan: validatePositionPlan(plans[positionPlanKey(stage, rule)] || {}) });
        return;
      }
      if (request.method === 'PUT') {
        const body = await readJson(request), stage = String(body.stage || ''), rule = String(body.rule || '');
        if (!stage.trim() || !rule.trim()) return json(response, 400, { error: 'stage and rule are required' });
        const plan = validatePositionPlan(body.plan);
        const plans = await readPositionPlans();
        plans[positionPlanKey(stage, rule)] = plan;
        await fsp.mkdir(path.dirname(POSITION_PLANS_FILE), { recursive: true });
        await fsp.writeFile(POSITION_PLANS_FILE, `${JSON.stringify(plans, null, 2)}\n`);
        json(response, 200, { stage, rule, plan });
        return;
      }
    }
    if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'analysis' && parts[4] === 'ai-death-sequence') {
      const recordingId = decodeURIComponent(parts[2] || '');
      const analysisName = decodeURIComponent(parts[3] || '');
      const recording = store.get(recordingId);
      const match = recording?.matches?.find(item => path.basename(item.analysisUrl || '') === analysisName);
      if (!recording || !match) return json(response, 404, { error: '試合の分析データが見つかりません' });
      const jobKey = `${recordingId}/${analysisName}`;
      if (runningDeathAnalyses.has(jobKey)) return json(response, 409, { error: 'この試合のAIシーケンス分析は実行中です' });
      runningDeathAnalyses.add(jobKey);
      try {
        const body = await readJson(request);
        const analysisPath = safeJoin(ANALYSIS_ROOT, [recordingId, analysisName]);
        const analysis = JSON.parse(await fsp.readFile(analysisPath, 'utf8'));
        const deaths = (analysis.events || []).filter(event => event.type === 'death');
        if (!deaths.length) return json(response, 400, { error: '分析できるデスがありません' });
        const result = await analyzeDeathSequencesWithCodex({
          clipPath: safeJoin(MATCH_ROOT, [recordingId, match.fileName]),
          deaths,
          workDir: path.join(WORK_ROOT, recordingId),
          matchNumber: match.number,
          force: true,
          refresh: body.refresh === true,
          required: true,
        });
        analysis.version = Math.max(25, Number(analysis.version) || 0);
        analysis.events = result.deaths;
        analysis.deathAnalysis = result.analysis;
        analysis.capabilities = {
          ...(analysis.capabilities || {}),
          deathExplanation: 'codex-vision-sequence',
          deathSequenceAnalysis: 'codex-vision-sequence',
        };
        const temporaryPath = `${analysisPath}.tmp`;
        await fsp.writeFile(temporaryPath, `${JSON.stringify(analysis, null, 2)}\n`, 'utf8');
        await fsp.rename(temporaryPath, analysisPath);
        response.setHeader('Cache-Control', 'no-store');
        json(response, 200, analysis);
        return;
      } catch (error) {
        console.error('AI death sequence analysis failed:', error);
        json(response, /ログイン|login/i.test(error.message) ? 503 : 500, { error: `AIシーケンス分析に失敗しました: ${error.message}` });
        return;
      } finally {
        runningDeathAnalyses.delete(jobKey);
      }
    }
    if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'analysis') {
      // Re-analysis replaces the JSON at the same URL. Never let the browser
      // keep showing stale death markers or event timestamps.
      response.setHeader('Cache-Control', 'no-store');
      await serveFile(request, response, safeJoin(ANALYSIS_ROOT, parts.slice(2)));
      return;
    }
    if (request.method === 'GET' && parts[0] === 'media' && parts[1] === 'matches') {
      await serveFile(request, response, safeJoin(MATCH_ROOT, parts.slice(2)));
      return;
    }
    if (request.method === 'GET' && parts[0] === 'media' && parts[1] === 'thumbnails') {
      await serveFile(request, response, safeJoin(THUMBNAIL_ROOT, parts.slice(2)));
      return;
    }
    if (request.method === 'GET' && parts[0] === 'assets' && parts[1] === 'stage-maps') {
      await serveFile(request, response, safeJoin(path.join(PROJECT_ROOT, 'assets', 'stage-maps', 'images'), parts.slice(2)));
      return;
    }
    if (request.method === 'GET') {
      const relative = url.pathname === '/' ? ['index.html'] : parts;
      await serveFile(request, response, safeJoin(PUBLIC_ROOT, relative));
      return;
    }
    json(response, 404, { error: 'Not found' });
  } catch (error) {
    if (error.code === 'ENOENT') json(response, 404, { error: 'Not found' });
    else {
      console.error(error);
      json(response, 500, { error: error.message });
    }
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`Battle Review: http://127.0.0.1:${PORT}`);
  try {
    await pipeline.start({ autoProcess: process.env.AUTO_PROCESS !== 'false' });
  } catch (error) {
    console.error('Pipeline initialization failed:', error);
  }
});
