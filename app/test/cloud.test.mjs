import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { R2Api, CAPACITY_BYTES, validateConfig, publicError } from '../src/r2-api.mjs';
import { CloudService } from '../src/cloud-service.mjs';
import { cloudRoute, localCloudRequest, transferControlRequest } from '../src/cloud-routes.mjs';
import { playbackRecording, isRemoteAccess } from '../public/media-access.js';

const config = { accountId: 'a'.repeat(32), bucket: 'test-videos', accessKeyId: 'b'.repeat(32), secretAccessKey: 'c'.repeat(64) };
async function temp(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'splatoon-r2-test-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
const recording = () => ({ id: 'r1', source: '/recording.mp4', status: 'ready', progress: 1, matches: [{ number: 1, start: 0, end: 10, duration: 10, fileName: 'match.mp4', videoUrl: '/media/matches/r1/match.mp4', status: 'ready' }] });
function fakeStore(item) { const store = new EventEmitter(); store.list = () => [item]; store.get = id => id === item.id ? item : undefined; return store; }
const baseApi = () => ({ identity: 'test-bucket', load: async () => {}, usage: async () => 10, upload: async job => { job.totalBytes = 100; job.sha256 = 'hash'; }, verify: async () => {}, playbackUrl: async () => 'https://example.r2.cloudflarestorage.com/signed' });

test('pause aborts an active transfer without discarding its multipart state; resume finishes it', async t => {
  const root = await temp(t), item = recording(), api = baseApi(); let notify, signalSeen, calls = 0;
  const started = new Promise(resolve => { notify = resolve; });
  api.upload = async (job, save, { signal }) => {
    calls++; signalSeen = signal; job.uploadId = 'kept-upload'; job.bytes = 8; job.totalBytes = 20; await fs.mkdir(path.dirname(job.file), { recursive: true }); await fs.writeFile(job.file, 'prepared'); await save();
    if (calls === 1) { notify(); await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }
  };
  const service = new CloudService(fakeStore(item), { root, api, prepare: async () => {} }); await service.load(); await service.tick(); await started;
  await service.setPaused(true); await service.uploadPromise;
  assert.equal(signalSeen.aborted, true); assert.equal(service.jobs['r1:1'].uploadId, 'kept-upload'); assert.equal(service.jobs['r1:1'].bytes, 8); assert.equal(service.jobs['r1:1'].attempts, 0);
  assert.equal(service.decorate([item])[0].matches[0].cloud.status, 'paused'); assert.equal(item.matches[0].status, 'ready');
  await service.tick(); assert.equal(calls, 1);
  const restarted = new CloudService(fakeStore(item), { root, api }); await restarted.load(); await restarted.tick(); assert.equal(restarted.paused, true); assert.equal(calls, 1);
  await restarted.setPaused(false);
  // The event-triggered tick is asynchronous; wait until its upload promise is assigned.
  for (let i = 0; i < 100 && !restarted.uploadPromise; i++) await new Promise(resolve => setTimeout(resolve, 1));
  await restarted.uploadPromise; assert.equal(calls, 2); assert.equal(restarted.jobs['r1:1'].status, 'ready');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'controls.json'), 'utf8')), { paused: false });
});
test('pausing during preparation prevents any upload; ready videos remain playable', async t => {
  const root = await temp(t), item = recording(), api = baseApi(); let release, notify, uploads = 0;
  const started = new Promise(resolve => { notify = resolve; }), held = new Promise(resolve => { release = resolve; });
  api.upload = async () => { uploads++; };
  const service = new CloudService(fakeStore(item), { root, api, prepare: async () => { notify(); await held; } }); await service.load(); await service.tick(); await started;
  await service.setPaused(true); release(); await service.uploadPromise; assert.equal(uploads, 0);
  service.jobs['r1:1'].status = 'ready'; assert.equal(service.decorate([item])[0].matches[0].cloud.status, 'ready');
  assert.match(await service.playbackUrl('r1', 1), /^https:/);
});
test('multipart cancellation reaches the pending S3 request and retains its upload ID', async t => {
  const root = await temp(t), file = path.join(root, 'clip.mp4'); await fs.writeFile(file, Buffer.alloc(64));
  const api = new R2Api(); api.config = config; const controller = new AbortController(); let notify, completed = false;
  const started = new Promise(resolve => { notify = resolve; });
  api.client = { send: async (command, { abortSignal }) => {
    const name = command.constructor.name;
    if (name === 'HeadObjectCommand') return null;
    if (name === 'ListObjectsV2Command' || name === 'ListMultipartUploadsCommand') return {};
    if (name === 'CreateMultipartUploadCommand') return { UploadId: 'keep-me' };
    if (name === 'UploadPartCommand') { notify(); return new Promise((resolve, reject) => abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true })); }
    if (name === 'CompleteMultipartUploadCommand') { completed = true; return {}; }
    throw new Error(name);
  } };
  const job = { file, objectKey: 'clip' }, uploading = api.upload(job, async () => {}, { signal: controller.signal });
  const rejected = assert.rejects(uploading, error => error.name === 'AbortError'); await started; controller.abort(); await rejected;
  assert.equal(job.uploadId, 'keep-me'); assert.equal(completed, false); assert.equal((await fs.stat(file)).size, 64);
});
test('transfer control accepts same-origin Tailscale but still rejects cross-site requests and remote configuration', () => {
  const url = new URL('http://pc.example.ts.net/api/cloud/transfer');
  const request = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'tailscale-user-login': 'user@example.com', origin: 'https://pc.example.ts.net', 'sec-fetch-site': 'same-origin' } };
  assert.equal(transferControlRequest(request, url), true); assert.equal(localCloudRequest(request, url), false);
  assert.equal(transferControlRequest({ ...request, headers: { ...request.headers, origin: 'https://evil.test' } }, url), false);
  assert.equal(transferControlRequest({ ...request, headers: {} }, url), false);
});

test('local readiness is independent; remote waits until range verification completes', async t => {
  const root = await temp(t), item = recording(), store = fakeStore(item), api = baseApi(); let release, notify;
  const started = new Promise(resolve => { notify = resolve; }); const held = new Promise(resolve => { release = resolve; });
  api.verify = async () => { notify(); await held; };
  const service = new CloudService(store, { root, api, prepare: async () => {} }); await service.load(); await service.tick(); await started;
  const decorated = service.decorate([item])[0]; assert.equal(decorated.matches[0].cloud.status, 'verifying');
  assert.equal(playbackRecording(decorated, false).status, 'ready'); assert.equal(playbackRecording(decorated, true).status, 'cloud-pending');
  release(); await service.uploadPromise;
  assert.equal(playbackRecording(service.decorate([item])[0], true).status, 'ready');
  assert.equal(service.decorate([item])[0].matches[0].cloud.url, '/api/cloud/r1/1/play');
  assert.equal(item.matches[0].status, 'ready');
});
test('existing and new ready matches queue automatically; configuration is required', async t => {
  const root = await temp(t), item = recording(), api = baseApi(); api.identity = null;
  const service = new CloudService(fakeStore(item), { root, api }); await service.load(); await service.tick();
  assert.equal(service.jobs['r1:1'].status, 'queued'); assert.equal(service.decorate([item])[0].matches[0].cloud.status, 'setup'); assert.equal(service.uploadPromise, undefined);
  api.identity = 'bucket'; service.prepare = async () => {}; await service.tick(); await service.uploadPromise;
  assert.equal(service.jobs['r1:1'].status, 'ready');
  item.matches.push({ ...item.matches[0], number: 2 }); await service.tick(); await service.uploadPromise; assert.equal(service.jobs['r1:2'].status, 'ready');
});
test('transfer errors back off without changing local status or exposing credentials', async t => {
  const root = await temp(t), item = recording(), api = baseApi(); api.upload = async () => { throw new Error('https://secret:password@bad.invalid/?signature=private'); };
  const service = new CloudService(fakeStore(item), { root, api, prepare: async () => {}, now: () => 100 }); await service.load(); await service.tick(); await service.uploadPromise;
  assert.equal(service.jobs['r1:1'].status, 'error'); assert.ok(service.jobs['r1:1'].nextCheck > 100); assert.equal(item.status, 'ready'); assert.doesNotMatch(JSON.stringify(service.summary()), /password|private|sha256|objectKey|signature/);
});
test('destination and match changes invalidate cloud readiness; live finalization preserves the same clip', async t => {
  const root = await temp(t), item = recording(), api = baseApi(); delete item.matches[0].fileName; delete item.matches[0].videoUrl; item.matches[0].start = 5;
  const service = new CloudService(fakeStore(item), { root, api, prepare: async () => {} }); await service.load(); await service.tick(); await service.uploadPromise;
  item.matches[0].sourceVideoStart = 5; assert.equal(service.decorate([item])[0].matches[0].cloud.status, 'ready');
  item.matches[0].end = 20; assert.equal(service.decorate([item])[0].matches[0].cloud.status, 'queued'); item.matches[0].end = 10;
  api.identity = 'other'; assert.equal(service.decorate([item])[0].matches[0].cloud.status, 'queued');
  await assert.rejects(service.playbackUrl('r1', 1), /準備中/);
});
test('capacity stop requires explicit retry and never deletes original videos', async t => {
  const root = await temp(t), item = recording(), api = baseApi(); let attempts = 0;
  api.upload = async () => { attempts++; throw Object.assign(new Error('full'), { code: 'capacity' }); };
  const service = new CloudService(fakeStore(item), { root, api, prepare: async () => {}, now: () => 100 }); await service.load(); await service.tick(); await service.uploadPromise; await service.tick();
  assert.equal(attempts, 1); assert.equal(service.jobs['r1:1'].status, 'capacity'); assert.equal(item.matches[0].status, 'ready');
});
test('manual removal from R2 does not trigger an unwanted re-upload', async t => {
  const root = await temp(t), item = recording(), api = baseApi(); let uploads = 0;
  api.upload = async job => { uploads++; job.totalBytes = 100; job.sha256 = 'hash'; };
  const service = new CloudService(fakeStore(item), { root, api, prepare: async () => {} }); await service.load(); await service.tick(); await service.uploadPromise;
  api.verify = async () => { throw Object.assign(new Error('gone'), { code: 'object_missing' }); };
  service.jobs['r1:1'].nextCheck = 0; await service.tick(); await service.tick();
  assert.equal(service.jobs['r1:1'].status, 'missing'); assert.equal(uploads, 1); assert.equal(playbackRecording(service.decorate([item])[0], true).status, 'cloud-pending');
});
test('bucket keys and arbitrary endpoints are never accepted from playback requests', () => {
  assert.deepEqual(validateConfig({ ...config, endpoint: 'http://127.0.0.1:99' }), config);
  assert.throws(() => validateConfig({ ...config, accountId: 'localhost' }));
  assert.doesNotMatch(publicError(new Error(config.secretAccessKey)), new RegExp(config.secretAccessKey));
});

function mockS3(handler, options = {}) {
  const calls = [], api = new R2Api({ ...options }); api.config = config;
  api.client = { send: async command => { calls.push(command); return handler(command.constructor.name, command.input); } };
  return { api, calls };
}
test('multipart resumes from server parts after restart even if local part progress was lost', async t => {
  const root = await temp(t), file = path.join(root, 'clip.mp4'), size = 8 * 1024 * 1024 + 200;
  await fs.writeFile(file, Buffer.alloc(size, 7)); const job = { file, objectKey: 'splatoon/v1/test.mp4', uploadId: 'resume-id' }; let completed;
  const { api, calls } = mockS3((name, input) => {
    if (name === 'HeadObjectCommand') return null;
    if (name === 'ListPartsCommand') return { Parts: [{ PartNumber: 1, ETag: 'existing-part', Size: 8 * 1024 * 1024 }] };
    if (name === 'ListObjectsV2Command') return { Contents: [] };
    if (name === 'ListMultipartUploadsCommand') return { Uploads: [{ Key: job.objectKey, UploadId: job.uploadId }] };
    if (name === 'UploadPartCommand') { assert.equal(input.PartNumber, 2); assert.equal(input.Body.length, 200); return { ETag: 'new-part' }; }
    if (name === 'CompleteMultipartUploadCommand') { completed = input; return {}; } throw new Error(name);
  });
  await api.upload(job, async () => {});
  assert.equal(calls.filter(command => command.constructor.name === 'UploadPartCommand').length, 1);
  assert.equal(completed.MultipartUpload.Parts[0].ETag, 'existing-part'); assert.equal(job.bytes, size); assert.equal(job.uploadId, undefined);
});
test('lost final response recovers the existing object without another upload', async t => {
  const root = await temp(t), file = path.join(root, 'clip.mp4'), buffer = Buffer.alloc(64, 3); await fs.writeFile(file, buffer);
  const job = { file, objectKey: 'clip', uploadId: 'old' };
  const { api, calls } = mockS3(name => { assert.equal(name, 'HeadObjectCommand'); return { ContentLength: 64, Metadata: { sha256: createHash('sha256').update(buffer).digest('hex') } }; });
  await api.upload(job, async () => {}); assert.equal(calls.length, 1); assert.equal(job.uploadId, undefined);
});
test('all bucket objects and unfinished uploads count against the cap before beginning upload', async t => {
  const root = await temp(t), file = path.join(root, 'clip.mp4'); await fs.writeFile(file, Buffer.alloc(64));
  const { api, calls } = mockS3(name => {
    if (name === 'HeadObjectCommand') return null;
    if (name === 'ListObjectsV2Command') return { Contents: [{ Size: CAPACITY_BYTES - 100 }] };
    if (name === 'ListMultipartUploadsCommand') return { Uploads: [{ Key: 'another', UploadId: 'other' }] };
    if (name === 'ListPartsCommand') return { Parts: [{ Size: 50 }] }; throw new Error(name);
  });
  await assert.rejects(api.upload({ file, objectKey: 'clip' }, async () => {}), error => error.code === 'capacity');
  assert.equal(calls.some(command => command.constructor.name === 'CreateMultipartUploadCommand'), false);
});
test('expired multipart sessions restart safely', async t => {
  const root = await temp(t), file = path.join(root, 'clip.mp4'); await fs.writeFile(file, Buffer.alloc(64)); const job = { file, objectKey: 'clip', uploadId: 'expired' };
  const { api } = mockS3((name, input) => {
    if (name === 'HeadObjectCommand') return null;
    if (name === 'ListPartsCommand') throw Object.assign(new Error('gone'), { name: 'NoSuchUpload' });
    if (name === 'ListObjectsV2Command' || name === 'ListMultipartUploadsCommand') return {};
    if (name === 'CreateMultipartUploadCommand') return { UploadId: 'new-id' };
    if (name === 'UploadPartCommand') { assert.equal(input.UploadId, 'new-id'); return { ETag: 'new' }; }
    if (name === 'CompleteMultipartUploadCommand') return {}; throw new Error(name);
  });
  await api.upload(job, async () => {}); assert.equal(job.bytes, 64);
});
test('ready requires matching object metadata and real MP4 byte-range read', async () => {
  let range; const buffer = Buffer.alloc(32); buffer.write('ftyp', 4);
  const { api } = mockS3(() => ({ ContentLength: 100, ContentType: 'video/mp4', Metadata: { sha256: 'hash' } }), {
    sign: async () => 'https://r2.test/video', fetchImpl: async (url, options) => { range = options.headers.Range; return new Response(buffer, { status: 206, headers: { 'content-range': 'bytes 0-31/100' } }); },
  });
  await api.verify({ objectKey: 'clip', totalBytes: 100, sha256: 'hash' }); assert.equal(range, 'bytes=0-31');
  await assert.rejects(api.verify({ objectKey: 'clip', totalBytes: 101, sha256: 'hash' }));
  api.fetch = async () => new Response(buffer, { status: 200 }); await assert.rejects(api.verify({ objectKey: 'clip', totalBytes: 100, sha256: 'hash' }));
});
test('settings writes reject remote, cross-site, and Tailscale proxy requests', () => {
  const url = new URL('http://localhost:4310/api/cloud/config'), request = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(localCloudRequest(request, url), true);
  for (const headers of [{ origin: 'https://evil.test' }, { 'tailscale-user-login': 'user' }, { 'sec-fetch-site': 'cross-site' }]) assert.equal(localCloudRequest({ ...request, headers }, url), false);
  assert.equal(localCloudRequest({ ...request, socket: { remoteAddress: '100.70.1.2' } }, url), false);
});
test('playback route redirects directly without fetching or proxying video bytes', async t => {
  const service = { playbackUrl: async (id, number) => { assert.equal(id, 'r1'); assert.equal(number, 1); return 'https://r2.example/clip?signature=demo'; } };
  const server = http.createServer(async (request, response) => { await cloudRoute(request, response, new URL(request.url, `http://${request.headers.host}`), service); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/cloud/r1/1/play`, { redirect: 'manual', headers: { Range: 'bytes=20-30' } });
  assert.equal(response.status, 307); assert.equal(response.headers.get('location'), 'https://r2.example/clip?signature=demo'); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(await response.text(), '');
});
test('auto source recognizes LAN and Tailscale independently of local processing', () => {
  for (const hostname of ['localhost', '192.168.1.20', '10.0.0.2', '172.16.1.5', 'pc.local']) assert.equal(isRemoteAccess({ hostname }), false);
  for (const hostname of ['100.70.1.2', 'pc.example.ts.net', 'example.com']) assert.equal(isRemoteAccess({ hostname }), true);
});
