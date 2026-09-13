import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import webpush from 'web-push';

export function validateSubscription(value) {
  const url = new URL(value?.endpoint);
  const hosts = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com'];
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !(hosts.includes(url.hostname) || url.hostname.endsWith('.notify.windows.com'))) throw new Error('対応していない通知先です');
  if (!/^[\w-]{80,100}$/.test(value?.keys?.p256dh || '') || !/^[\w-]{20,30}$/.test(value?.keys?.auth || '')) throw new Error('通知の登録情報が正しくありません');
  return { endpoint: url.href, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
}
export class AnalysisNotifications {
  constructor({ stateFile, analysisRoot, store, send = webpush.sendNotification.bind(webpush) }) {
    Object.assign(this, { stateFile, analysisRoot, store, send });
    this.cache = new Map(); this.busy = false;
  }
  async load() {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    try { this.state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.state = { keys: webpush.generateVAPIDKeys(), subscriptions: {}, seen: {}, pending: [] }; }
    await this.scan(true); this.save();
  }
  save() {
    const temp = this.stateFile + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(this.state), { mode: 0o600 }); fs.renameSync(temp, this.stateFile);
  }
  subscribe(subscription, base) {
    const valid = validateSubscription(subscription);
    const id = createHash('sha256').update(valid.endpoint).digest('hex');
    if (!this.state.subscriptions[id] && Object.keys(this.state.subscriptions).length >= 100) throw new Error('通知端末の登録数が上限です');
    this.state.subscriptions[id] = { subscription: valid, base: base === '/sba' ? '/sba' : '', since: this.state.subscriptions[id]?.since ?? Date.now() }; this.save(); return id;
  }
  unsubscribe(endpoint) {
    const id = createHash('sha256').update(String(endpoint)).digest('hex');
    delete this.state.subscriptions[id]; this.state.pending = this.state.pending.filter(item => item.id !== id); this.save();
  }
  async scan(baseline = false) {
    if (this.busy) return; this.busy = true;
    try {
      for (const recording of this.store.list()) for (const match of recording.matches || []) {
        if (!match.analysisUrl) continue;
        const name = path.basename(decodeURIComponent(match.analysisUrl));
        const file = path.join(this.analysisRoot, recording.id, name);
        try {
          const stat = await fsp.stat(file), stamp = `${stat.mtimeMs}:${stat.size}`;
          if (this.cache.get(file) === stamp) continue;
          const analysis = JSON.parse(await fsp.readFile(file, 'utf8'));
          this.cache.set(file, stamp);
          if (!analysis.deathAnalysis || (analysis.deathAnalysisState?.status && analysis.deathAnalysisState.status !== 'complete')) continue;
          const key = `${recording.id}/${match.number}`;
          const version = createHash('sha256').update(JSON.stringify([analysis.deathAnalysis, analysis.deathAnalysisState?.updatedAt])).digest('hex');
          if (this.state.seen[key] === version) continue;
          const known = Object.hasOwn(this.state.seen, key);
          this.state.seen[key] = version;
          if (baseline && !known) continue;
          for (const [id, subscriber] of Object.entries(this.state.subscriptions)) {
            if (stat.mtimeMs < (subscriber.since || 0)) continue;
            this.state.pending.push({ id, attempts: 0, next: 0, payload: { title: 'AI分析が完了しました', body: `${recording.fileName} / 試合 ${String(match.number).padStart(2, '0')}`, tag: `analysis-${key}-${version.slice(0,12)}`, url: `${subscriber.base}/?recording=${encodeURIComponent(recording.id)}&match=${match.number}` } });
          }
          this.save();
        } catch (error) { if (!['ENOENT', 'EBUSY'].includes(error.code) && !(error instanceof SyntaxError)) console.error('Notification scan failed:', error.code || error.name); }
      }
      if (!baseline) await this.flush();
    } finally { this.busy = false; }
  }
  async flush() {
    for (const item of [...this.state.pending]) {
      if (item.next > Date.now()) continue;
      const subscriber = this.state.subscriptions[item.id];
      let remove = !subscriber;
      if (subscriber) try {
        await this.send(subscriber.subscription, JSON.stringify(item.payload), { TTL: 86400, timeout: 10000, vapidDetails: { subject: 'https://github.com/kazurego7/splatoon3-battle-analyzer', ...this.state.keys } });
        remove = true;
      } catch (error) {
        if ([404, 410].includes(error.statusCode)) { delete this.state.subscriptions[item.id]; remove = true; }
        else { item.attempts++; item.next = Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(item.attempts, 7)); if (item.attempts >= 24) remove = true; }
      }
      if (remove) this.state.pending = this.state.pending.filter(other => other !== item);
      this.save();
    }
  }
  start() { this.timer = setInterval(() => void this.scan().catch(() => console.error('Notification worker failed')), 15000); this.timer.unref(); }
}
