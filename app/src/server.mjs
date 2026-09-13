import { AnalysisNotifications } from './analysis-notifications.mjs';
import { notificationRoute } from './notification-routes.mjs';
import http from 'node:http';
import { sendBody } from './http-performance.mjs';
import { ListAssets } from './list-assets.mjs';
import { LiveDetailService } from './live-detail-service.mjs';
import { migrateSourceMatches } from './source-matches.mjs';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Pipeline } from './pipeline.mjs';
import { Store } from './store.mjs';
import { analyzeDeathSequencesWithCodex } from './codex-death-analysis.mjs';
import { deathAnalysisFailure } from './death-analysis-errors.mjs';
import { parseByteRange } from './http-range.mjs';
import { APP_DATA_ROOT, ANALYSIS_ROOT, LIVE_MEDIA_ROOT, MATCH_ROOT, POSITION_PLANS_FILE, PROJECT_ROOT, PUBLIC_ROOT, RAW_ROOT, REMOTE_MATCH_ROOT, THUMBNAIL_ROOT, WORK_ROOT } from './paths.mjs';
import { MatchAnalyticsService } from './match-analytics.mjs';

import { weaponCatalogEntries, weaponCatalogMetadata } from './weapon-analysis.mjs';
import { CloudService } from './cloud-service.mjs';
import { cloudRoute } from './cloud-routes.mjs';
import { appBase, appDataUrl, appUrl, mountedHtml } from '../public/app-path.js';

const PORT = Number(process.env.PORT || 4310);
const HOST = process.env.HOST || '127.0.0.1';
const store = new Store();
const listAssets = new ListAssets();
await store.load();
await migrateSourceMatches(store);
const cloud = new CloudService(store);
await cloud.load();
const notifications = new AnalysisNotifications({ stateFile: path.join(APP_DATA_ROOT, 'notifications.json'), analysisRoot: ANALYSIS_ROOT, store });
await notifications.load();
const pipeline = new Pipeline(store);
const matchAnalytics = new MatchAnalyticsService(store);
await matchAnalytics.load();
const runningDeathAnalyses = new Map();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
};

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value, (_, item) => appDataUrl(item, response.appBasePath || '')));
  sendBody(response.req, response, body, 'application/json; charset=utf-8', { status, cache: response.getHeader('Cache-Control') || 'private, no-cache' });
}

function runFolderLauncher(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', ...options });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Folder launcher exited with code ${code}`));
    });
  });
}

function focusWindowsFolder(folder) {
  const escapedFolder = folder.replaceAll("'", "''");
  const script = `
$ErrorActionPreference = 'Stop'
$target = '${escapedFolder}'
$shell = New-Object -ComObject Shell.Application
function Find-TargetWindow {
  @($shell.Windows()) | Where-Object {
    try {
      $location = [Uri]::UnescapeDataString(([Uri]$_.LocationURL).LocalPath)
      $location -eq $target -and $_.Visible
    } catch { $false }
  } | Select-Object -Last 1
}
$window = Find-TargetWindow
if (-not $window) {
  Start-Process -FilePath 'explorer.exe' -ArgumentList @('/n,', ('"{0}"' -f $target))
  $deadline = (Get-Date).AddSeconds(5)
  do {
    Start-Sleep -Milliseconds 100
    $window = Find-TargetWindow
  } while (-not $window -and (Get-Date) -lt $deadline)
}
if (-not $window) { exit 2 }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FolderWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint attachTo, bool value);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
'@
$handle = [IntPtr]$window.HWND
$foregroundThread = [FolderWindow]::GetWindowThreadProcessId([FolderWindow]::GetForegroundWindow(), [IntPtr]::Zero)
$currentThread = [FolderWindow]::GetCurrentThreadId()
$attached = [FolderWindow]::AttachThreadInput($currentThread, $foregroundThread, $true)
try {
  [FolderWindow]::ShowWindowAsync($handle, 9) | Out-Null
  [FolderWindow]::BringWindowToTop($handle) | Out-Null
  [FolderWindow]::SetForegroundWindow($handle) | Out-Null
  [FolderWindow]::SetFocus($handle) | Out-Null
} finally {
  if ($attached) { [FolderWindow]::AttachThreadInput($currentThread, $foregroundThread, $false) | Out-Null }
}
`;
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
  return runFolderLauncher('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encodedScript], { windowsHide: true });
}

function openFolder(folder) {
  if (process.platform === 'win32') return focusWindowsFolder(folder);
  const launch = process.platform === 'darwin'
    ? { command: 'open', args: [folder] }
    : { command: 'xdg-open', args: [folder] };
  return runFolderLauncher(launch.command, launch.args);
}

async function writeAnalysisAtomic(analysisPath, analysis) {
  const temporaryPath = `${analysisPath}.${process.pid}.tmp`;
  await fsp.writeFile(temporaryPath, `${JSON.stringify(analysis, null, 2)}\n`, 'utf8');
  await fsp.rename(temporaryPath, analysisPath);
}

async function updateAnalysisFile(analysisPath, update) {
  const analysis = JSON.parse(await fsp.readFile(analysisPath, 'utf8'));
  await update(analysis);
  await writeAnalysisAtomic(analysisPath, analysis);
  return analysis;
}

function publicDeathAnalysisState(state) {
  if (!state) return { status: 'idle' };
  const { status, phase, completedDeaths, totalDeaths, startedAt, updatedAt, activity, error, guidance, retryable } = state;
  return { status, phase, completedDeaths, totalDeaths, startedAt, updatedAt, activity, error, guidance, retryable };
}

function savedDeathAnalysisState(jobKey, analysis) {
  const running = runningDeathAnalyses.get(jobKey);
  if (running) return publicDeathAnalysisState(running);
  if (analysis.deathAnalysis) return publicDeathAnalysisState(analysis.deathAnalysisState || { status: 'complete', phase: 'complete' });
  const saved = analysis.deathAnalysisState;
  if (saved?.status === 'sequences' || saved?.status === 'report') return {
    ...publicDeathAnalysisState(saved), status: 'interrupted',
    error: 'アプリの終了によりAI分析が中断されました。',
    guidance: '「分析を再開する」を押すと、保存済みの結果から続行します。', retryable: true,
  };
  return publicDeathAnalysisState(saved);
}

async function runDeathAnalysisJob({ jobKey, analysisPath, clipPath, deaths, workDir, matchNumber, refresh, videoRange = null }) {
  const job = runningDeathAnalyses.get(jobKey);
  try {
    const result = await analyzeDeathSequencesWithCodex({
      clipPath, deaths, workDir, matchNumber, force: true, refresh, required: true, videoRange,
      analysisContext: JSON.parse(await fsp.readFile(analysisPath, 'utf8')),
      onActivity: event => {
        if (event.type === 'item.started' || event.type === 'item.completed') {
          job.activity = event.item?.type === 'mcp_tool_call' && event.item?.server === 'match_video'
            ? (['frame', 'frames'].includes(event.item?.arguments?.action) ? '自分で選んだ時刻の映像を確認しています' : '事前分析データを確認しています')
            : event.item?.type === 'command_execution' ? '映像・事前分析データを調査しています'
            : event.item?.type === 'image_view' ? '選んだ場面の画像を確認しています' : '分析内容を整理しています';
          job.updatedAt = new Date().toISOString();
        }
      },
      onSequences: async sequenceResult => {
        const reportState = {
          ...job,
          status: 'report', phase: 'report', completedDeaths: sequenceResult.deaths.length,
          totalDeaths: deaths.length, updatedAt: new Date().toISOString(),
        };
        await updateAnalysisFile(analysisPath, analysis => {
          analysis.version = Math.max(26, Number(analysis.version) || 0);
          analysis.events = sequenceResult.deaths;
          analysis.deathAnalysis = null;
          analysis.deathAnalysisState = publicDeathAnalysisState(reportState);
          analysis.capabilities = {
            ...(analysis.capabilities || {}), deathExplanation: 'codex-vision-sequence',
            deathSequenceAnalysis: 'codex-vision-sequence',
          };
        });
        Object.assign(job, reportState);
      },
    });
    const completeState = { ...job, status: 'complete', phase: 'complete', completedDeaths: deaths.length, updatedAt: new Date().toISOString() };
    await updateAnalysisFile(analysisPath, analysis => {
      analysis.version = Math.max(26, Number(analysis.version) || 0);
      analysis.events = result.deaths;
      analysis.deathAnalysis = result.analysis;
      analysis.deathAnalysisState = publicDeathAnalysisState(completeState);
      analysis.capabilities = {
        ...(analysis.capabilities || {}), deathExplanation: 'codex-vision-sequence',
        deathSequenceAnalysis: 'codex-vision-sequence',
      };
    });
    Object.assign(job, completeState);
  } catch (error) {
    console.error('AI death sequence analysis failed:', error);
    const failure = deathAnalysisFailure(error);
    const errorState = { ...job, status: 'error', phase: job.phase || 'sequences', ...failure, updatedAt: new Date().toISOString() };
    await updateAnalysisFile(analysisPath, analysis => { analysis.deathAnalysisState = publicDeathAnalysisState(errorState); });
    Object.assign(job, errorState);
  } finally {
    runningDeathAnalyses.delete(jobKey);
  }
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
  if (type.startsWith('image/') && new URL(request.url, 'http://localhost').searchParams.get('size') === 'icon') {
    try { sendBody(request, response, await listAssets.thumbnail(file, 96), 'image/webp'); return; }
    catch { /* Keep the original image available if conversion fails. */ }
  }
  if (!type.startsWith('video/') && !request.headers.range) {
    let body = await fsp.readFile(file);
    if (request.appBasePath && ['.html', '.json', '.webmanifest'].includes(path.extname(file))) {
      const text = body.toString('utf8');
      body = Buffer.from(type.startsWith('text/html') ? mountedHtml(text, request.appBasePath)
        : JSON.stringify(JSON.parse(text), (_, value) => path.extname(file) === '.webmanifest' ? appUrl(value, request.appBasePath) : appDataUrl(value, request.appBasePath)));
    }
    sendBody(request, response, body, type); return;
  }
  if (request.appBasePath && ['.html', '.json', '.webmanifest'].includes(path.extname(file))) {
    const text = await fsp.readFile(file, 'utf8');
    const content = type.startsWith('text/html') ? mountedHtml(text, request.appBasePath)
      : JSON.stringify(JSON.parse(text), (_, value) => path.extname(file) === '.webmanifest' ? appUrl(value, request.appBasePath) : appDataUrl(value, request.appBasePath));
    const body = Buffer.from(content);
    response.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : body); return;
  }
  const range = parseByteRange(request.headers.range, stat.size);
  const commonHeaders = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    ...(type.startsWith('video/') ? { 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': 'inline' } : {}),
  };
  if (range === false) {
      response.writeHead(416, { ...commonHeaders, 'Content-Range': `bytes */${stat.size}`, 'Content-Length': 0 });
      response.end();
      return;
  }
  if (range) {
    const { start, end } = range;
    response.writeHead(206, {
      ...commonHeaders,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
    });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(file, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { ...commonHeaders, 'Content-Length': stat.size });
  if (request.method === 'HEAD') response.end();
  else fs.createReadStream(file).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    request.appBasePath = response.appBasePath = appBase(url);
    if (request.appBasePath) {
      if (url.pathname === request.appBasePath) {
        response.writeHead(308, { Location: `${request.appBasePath}/${url.search}`, 'Cache-Control': 'no-store' }); response.end(); return;
      }
      url.pathname = url.pathname.slice(request.appBasePath.length);
    }
    const parts = url.pathname.split('/').filter(Boolean);

    if (request.method === 'GET' && url.pathname === '/api/recordings') {
      response.setHeader('Cache-Control', 'private, no-cache');
      json(response, 200, await listAssets.recordings(cloud.decorate(store.list()), ANALYSIS_ROOT));
      return;
    }
    if (await notificationRoute(request, response, url, notifications)) return;
    if (await cloudRoute(request, response, url, cloud)) return;
    if (parts[0] === 'api' && parts[1] === 'remote-video') return json(response, 410, { error: '外出先の動画はR2で再生します。ページを開き直してください。' });
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
    if (request.method === 'POST' && url.pathname === '/api/open-recordings-folder') {
      const currentRecording = store.list().find(item => item.status === 'recording' && item.source);
      const recordingsFolder = currentRecording ? path.dirname(currentRecording.source) : RAW_ROOT;
      await fsp.mkdir(recordingsFolder, { recursive: true });
      try {
        await openFolder(recordingsFolder);
        json(response, 200, { ok: true, path: recordingsFolder });
      } catch (error) {
        console.error('Failed to open recordings folder', error);
        json(response, 500, {
          error: '録画フォルダを開けませんでした。',
          guidance: `エクスプローラーを開き、アドレス欄に「${recordingsFolder}」を貼り付けてください。`,
          path: recordingsFolder,
        });
      }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/analytics') {
      if (url.searchParams.get('view') === 'search') {
        const fields = ['recordingId', 'matchNumber', 'analysisUrl', 'recordedAt', 'thumbnailUrl', 'stage', 'rule', 'outcome', 'selfWeapon', 'allyWeapons', 'enemyWeapons', 'playerStats', 'deathCount'];
        response.setHeader('Cache-Control', 'private, no-cache');
        json(response, 200, { records: matchAnalytics.list().map(record => Object.fromEntries(fields.map(key => [key, record[key]]))) });
        return;
      }
      response.setHeader('Cache-Control', 'no-store');
      json(response, 200, {
        records: matchAnalytics.list(),
        status: matchAnalytics.publicStatus(),
        definitions: {
          grain: 'one-record-per-match',
          outcome: '試合終了後のWIN/LOSE発表。未検出は集計分母から除外',
          winRate: '勝敗を取得できた試合に占める勝利数',
          playerStats: '個人リザルトから直接読み取ったキル数・デス数。未取得値は集計から除外',
          samples: 'カードで選んだ指標を取得できた試合だけを有効母数として表示',
          roster: 'GO後から最初のデス前までの画面上部ブキアイコン。8枠の2フレーム照合が完了した試合のみ完全取得',
          rosterSource: weaponCatalogMetadata.source,
          freshness: '動画・AI解析とは別のバックグラウンド収集時刻',
        },
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/analytics/weapons') {
      response.setHeader('Cache-Control', 'public, max-age=3600');
      json(response, 200, { metadata: weaponCatalogMetadata, weapons: weaponCatalogEntries() });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/analytics/refresh') {
      await readJson(request);
      void matchAnalytics.schedule();
      json(response, 202, { ok: true, status: matchAnalytics.publicStatus() });
      return;
    }
    if (request.method === 'PUT' && parts[0] === 'api' && parts[1] === 'analytics' && parts[2] === 'matches' && parts[3]) {
      const updated = await matchAnalytics.updateOverrides(decodeURIComponent(parts[3]), await readJson(request));
      json(response, 200, { record: updated });
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
    if ((request.method === 'GET' || request.method === 'POST') && parts[0] === 'api' && parts[1] === 'analysis' && parts[4] === 'ai-death-sequence') {
      const recordingId = decodeURIComponent(parts[2] || '');
      const analysisName = decodeURIComponent(parts[3] || '');
      const recording = store.get(recordingId);
      const match = recording?.matches?.find(item => path.basename(item.analysisUrl || '') === analysisName);
      if (!recording || !match) return json(response, 404, { error: '試合の分析データが見つかりません' });
      const jobKey = `${recordingId}/${analysisName}`;
      const analysisPath = safeJoin(ANALYSIS_ROOT, [recordingId, analysisName]);
      let analysis = JSON.parse(await fsp.readFile(analysisPath, 'utf8'));
      response.setHeader('Cache-Control', 'no-store');
      if (request.method === 'GET') return json(response, 200, { state: savedDeathAnalysisState(jobKey, analysis), analysis });
      const running = runningDeathAnalyses.get(jobKey);
      if (running) return json(response, 202, { state: publicDeathAnalysisState(running), analysis });
      const body = await readJson(request);
      const deaths = (analysis.events || []).filter(event => event.type === 'death');
      if (!deaths.length) return json(response, 400, { error: '分析できるデスがありません' });
      if (!match.fileName && (recording.live || !match.sourceVideoUrl)) return json(response, 409, {
        error: '録画終了後にAI映像分析を開始できます。',
        guidance: '録画終了後、もう一度このボタンを押してください。',
      });
      const videoRange = match.fileName ? null : { start: match.sourceVideoStart ?? match.start, end: (match.sourceVideoStart ?? match.start) + analysis.media.duration };
      if (videoRange && (!Number.isFinite(videoRange.start) || videoRange.start < 0 || !Number.isFinite(videoRange.end) || videoRange.end <= videoRange.start)) return json(response, 409, { error: '試合の動画区間を確認できませんでした。' });
      const now = new Date().toISOString();
      const job = {
        status: 'sequences', phase: 'sequences', completedDeaths: deaths.filter(death => Array.isArray(death.sequence)).length,
        totalDeaths: deaths.length, startedAt: now, updatedAt: now,
      };
      runningDeathAnalyses.set(jobKey, job);
      analysis.deathAnalysisState = publicDeathAnalysisState(job);
      try { await writeAnalysisAtomic(analysisPath, analysis); }
      catch (error) { runningDeathAnalyses.delete(jobKey); throw error; }
      void runDeathAnalysisJob({
        jobKey, analysisPath, clipPath: match.fileName ? safeJoin(MATCH_ROOT, [recordingId, match.fileName]) : recording.source, deaths, videoRange,
        workDir: path.join(WORK_ROOT, recordingId), matchNumber: match.number, refresh: body.refresh === true,
      });
      json(response, 202, { state: publicDeathAnalysisState(job), analysis });
      return;
    }
    if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'analysis') {
      // Re-analysis replaces the JSON at the same URL. Never let the browser
      // keep showing stale death markers or event timestamps.
      response.setHeader('Cache-Control', 'no-store');
      await serveFile(request, response, safeJoin(ANALYSIS_ROOT, parts.slice(2)));
      return;
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && parts[0] === 'media' && parts[1] === 'matches') {
      await serveFile(request, response, safeJoin(MATCH_ROOT, parts.slice(2)));
      return;
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && parts[0] === 'media' && parts[1] === 'live') {
      await serveFile(request, response, safeJoin(LIVE_MEDIA_ROOT, parts.slice(2)));
      return;
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && parts[0] === 'media' && parts[1] === 'recordings' && parts[2]) {
      const recording = store.get(decodeURIComponent(parts[2]));
      if (!recording?.source) return json(response, 404, { error: '元の録画が見つかりません' });
      await serveFile(request, response, recording.source);
      return;
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && parts[0] === 'media' && parts[1] === 'thumbnails') {
      if (url.searchParams.get('size') === 'list') {
        const file = safeJoin(THUMBNAIL_ROOT, parts.slice(2));
        try { sendBody(request, response, await listAssets.thumbnail(file), 'image/webp'); }
        catch { await serveFile(request, response, file); }
        return;
      }
      await serveFile(request, response, safeJoin(THUMBNAIL_ROOT, parts.slice(2)));
      return;
    }
    if (request.method === 'GET' && parts[0] === 'assets' && parts[1] === 'stage-maps') {
      await serveFile(request, response, safeJoin(path.join(PROJECT_ROOT, 'assets', 'stage-maps', 'images'), parts.slice(2)));
      return;
    }
    if (request.method === 'GET' && parts[0] === 'assets' && parts[1] === 'weapon-icons') {
      await serveFile(request, response, safeJoin(path.join(PROJECT_ROOT, 'assets', 'weapon-icons', 'images'), parts.slice(2)));
      return;
    }
    if (request.method === 'GET' && parts[0] === 'assets' && parts[1] === 'rule-icons') {
      await serveFile(request, response, safeJoin(path.join(PROJECT_ROOT, 'assets', 'rule-icons', 'images'), parts.slice(2)));
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

server.listen(PORT, HOST, async () => {
  const localHost = HOST === '0.0.0.0' || HOST === '::' ? '127.0.0.1' : HOST;
  console.log(`Battle Review: http://${localHost}:${PORT}`);
  if (process.env.BATTLE_REVIEW_REMOTE_URL) console.log(`Battle Review (Tailscale): ${process.env.BATTLE_REVIEW_REMOTE_URL}`);
  notifications.start();
  matchAnalytics.start();
  new LiveDetailService(store).start();
  cloud.start();
  try {
    await pipeline.start({ autoProcess: process.env.AUTO_PROCESS !== 'false' });
  } catch (error) {
    console.error('Pipeline initialization failed:', error);
  }
});
