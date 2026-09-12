import { appFetch as fetch } from './app-path.js';
import { cloudStatusText } from './media-access.js';
const byId = id => document.getElementById(id), source = byId('source');
try { const saved = localStorage.getItem('video-source') || 'auto'; source.value = saved === 'youtube' ? 'cloud' : saved; } catch {}
source.addEventListener('change', () => { try { localStorage.setItem('video-source', source.value); byId('message').textContent = '再生先を保存しました。録画ライブラリを開き直すと反映されます。'; } catch { byId('message').textContent = 'ブラウザに設定を保存できませんでした。'; } });
const gb = bytes => `${(bytes / 1e9).toFixed(2)} GB`;
function node(tag, text, className) { const element = document.createElement(tag); element.textContent = text; if (className) element.className = className; return element; }
let initialized = false, transferPaused = false, transferBusy = false;
async function refresh() {
  try {
    const response = await fetch('/api/cloud', { cache: 'no-store' }); if (!response.ok) throw new Error('接続状態を取得できませんでした。');
    const state = await response.json();
    byId('connection').textContent = state.connected ? `接続先：${state.bucket}` : 'R2は未設定です。ローカル動画は引き続き再生できます。';
    if (!transferBusy) {
      transferPaused = state.paused === true;
      byId('transfer-status').textContent = transferPaused ? '一時停止中 · 自動では再開しません' : '自動転送が有効です';
      byId('transfer-toggle').textContent = transferPaused ? '転送を再開' : '転送を一時停止';
      byId('transfer-toggle').disabled = !state.connected || !state.canControlTransfer;
    }
    byId('capacity').textContent = state.usedBytes == null ? '容量は最初の転送時に確認します。転送上限：8 GB' : `R2の使用量：${gb(state.usedBytes)} / 転送上限 ${gb(state.limitBytes)}（このバケット・転送途中の分を含む）`;
    byId('config').hidden = !state.canConfigure; byId('local-only').hidden = state.canConfigure;
    if (!initialized) { byId('setup').open = !state.connected; initialized = true; }
    const cards = [];
    for (const recording of state.recordings) for (const match of recording.matches || []) {
      if (match.status !== 'ready') continue;
      const job = match.cloud || {}, card = node('section', '', 'cloud-job');
      card.append(node('h2', `${recording.fileName} · 試合 ${match.number}`), node('p', cloudStatusText(job)));
      if (job.status === 'uploading' || (job.status === 'paused' && job.totalBytes)) { const progress = document.createElement('progress'); progress.max = 1; progress.value = job.progress || 0; progress.setAttribute('aria-label', '転送の進み具合'); card.append(progress, node('span', ` ${Math.round((job.progress || 0) * 100)}%`)); }
      if (state.canConfigure && ['capacity', 'error', 'missing'].includes(job.status)) {
        const retry = node('button', '再試行'); retry.type = 'button'; retry.addEventListener('click', async () => {
          retry.disabled = true;
          try { const response = await fetch(`/api/cloud/${encodeURIComponent(recording.id)}/${match.number}`, { method: 'POST' }); const result = await response.json(); if (!response.ok) throw new Error(result.error); await refresh(); }
          catch (error) { byId('message').textContent = error.message; } finally { retry.disabled = false; }
        }); card.append(retry);
      }
      cards.push(card);
    }
    byId('jobs').replaceChildren(...cards);
  } catch (error) { byId('connection').textContent = error.message; }
}
byId('transfer-toggle').addEventListener('click', async () => {
  if (transferBusy) return;
  transferBusy = true; const paused = !transferPaused, button = byId('transfer-toggle'); button.disabled = true;
  button.textContent = paused ? '停止しています…' : '再開しています…';
  try {
    const response = await fetch('/api/cloud/transfer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    byId('message').textContent = result.paused ? 'R2転送を一時停止しました。再開するまで停止を維持します。' : 'R2転送を再開しました。転送済みの部分から続けます。';
  } catch (error) { byId('message').textContent = error.message; }
  finally { transferBusy = false; await refresh(); }
});
byId('config').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button'); button.disabled = true;
  byId('message').textContent = '接続を確認しています…';
  try {
    const value = Object.fromEntries(new FormData(form));
    const response = await fetch('/api/cloud/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    form.reset(); byId('setup').open = false; byId('message').textContent = 'R2に接続しました。準備できた試合から自動転送します。'; await refresh();
  } catch (error) { byId('message').textContent = error.message; } finally { button.disabled = false; }
});
await refresh();
async function poll(){if(!document.hidden)await refresh();setTimeout(poll,transferPaused?30000:5000);}
setTimeout(poll,5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
