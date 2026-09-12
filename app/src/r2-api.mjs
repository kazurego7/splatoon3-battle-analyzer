import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { S3Client, ListObjectsV2Command, ListMultipartUploadsCommand, ListPartsCommand, HeadObjectCommand, GetObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { APP_DATA_ROOT } from './paths.mjs';

export const R2_ROOT = path.join(APP_DATA_ROOT, 'r2');
export const CAPACITY_BYTES = 8_000_000_000;
const PART_BYTES = 8 * 1024 * 1024;
export async function writePrivateJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(`${file}.tmp`, file);
}
export function validateConfig(value) {
  const config = Object.fromEntries(['accountId', 'bucket', 'accessKeyId', 'secretAccessKey'].map(key => [key, String(value?.[key] || '').trim()]));
  const fail = message => { throw Object.assign(new Error(message), { localMessage: true }); };
  if (!/^[a-f0-9]{32}$/i.test(config.accountId)) fail('CloudflareのアカウントID（32文字）を確認してください。');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket)) fail('R2のバケット名を確認してください。');
  if (!/^[a-f0-9]{32}$/i.test(config.accessKeyId) || !/^[a-f0-9]{64}$/i.test(config.secretAccessKey)) fail('R2のAccess Key IDとSecret Access Keyを確認してください。');
  return config;
}
export const configIdentity = config => config ? `${config.accountId}/${config.bucket}` : null;
export function publicError(error) {
  if (error.code === 'capacity') return '保存量が8GBを超えるため転送を停止しました。R2の不要な動画を整理して再試行してください。';
  if (error.localMessage) return error.message;
  if (['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'NoSuchBucket'].includes(error.name)) return 'R2のバケット名・接続キー・読み書き権限を確認してください。';
  return 'R2との通信または動画の準備に失敗しました。自動で再試行します。';
}
export class R2Api {
  constructor({ root = R2_ROOT, clientFactory, sign = getSignedUrl, fetchImpl = fetch } = {}) {
    Object.assign(this, { root, sign, fetch: fetchImpl });
    this.clientFactory = clientFactory || (config => new S3Client({ region: 'auto', endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`, forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 3 }));
  }
  async load() {
    try { this.config = validateConfig(JSON.parse(await fs.readFile(path.join(this.root, 'config.json'), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.config = null; }
    if (this.config) this.client = this.clientFactory(this.config);
  }
  get identity() { return configIdentity(this.config); }
  async configure(value) {
    const config = validateConfig(value), client = this.clientFactory(config);
    try { await client.send(new ListObjectsV2Command({ Bucket: config.bucket, MaxKeys: 1 }), { abortSignal: AbortSignal.timeout(30000) }); }
    catch (error) { client.destroy?.(); throw error; }
    await writePrivateJson(path.join(this.root, 'config.json'), config);
    this.client?.destroy?.(); this.config = config; this.client = client;
  }
  send(Command, input = {}, signal) { signal?.throwIfAborted(); return this.client.send(new Command({ Bucket: this.config.bucket, ...input }), { abortSignal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000) }); }
  async head(key, signal) {
    try { return await this.send(HeadObjectCommand, { Key: key }, signal); }
    catch (error) { if (error.$metadata?.httpStatusCode === 404 || ['NotFound', 'NoSuchKey'].includes(error.name)) return null; throw error; }
  }
  async parts(key, uploadId, signal) {
    const parts = []; let marker;
    do { const page = await this.send(ListPartsCommand, { Key: key, UploadId: uploadId, PartNumberMarker: marker }, signal); parts.push(...page.Parts || []); marker = page.IsTruncated ? page.NextPartNumberMarker : undefined; } while (marker);
    return parts;
  }
  async usage(signal) {
    let bytes = 0, token, keyMarker, uploadMarker;
    do { const page = await this.send(ListObjectsV2Command, { ContinuationToken: token }, signal); bytes += (page.Contents || []).reduce((sum, item) => sum + (item.Size || 0), 0); token = page.IsTruncated ? page.NextContinuationToken : undefined; } while (token);
    // Count unfinished uploads too, including ones left by another process or an old version.
    do {
      const page = await this.send(ListMultipartUploadsCommand, { KeyMarker: keyMarker, UploadIdMarker: uploadMarker }, signal);
      for (const upload of page.Uploads || []) {
        try { bytes += (await this.parts(upload.Key, upload.UploadId, signal)).reduce((sum, part) => sum + (part.Size || 0), 0); }
        catch (error) { if (error.name !== 'NoSuchUpload') throw error; }
      }
      keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined; uploadMarker = page.NextUploadIdMarker;
    } while (keyMarker);
    this.usedBytes = bytes; this.usageCheckedAt = new Date().toISOString(); return bytes;
  }
  async playbackUrl(key) { return this.sign(this.client, new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { expiresIn: 86400 }); }
  async verify(job, { signal } = {}) {
    const head = await this.head(job.objectKey, signal);
    if (!head) throw Object.assign(new Error('R2 object missing'), { code: 'object_missing' });
    if (head.ContentLength !== job.totalBytes || head.ContentType !== 'video/mp4' || head.Metadata?.sha256 !== job.sha256) throw new Error('R2 object verification failed');
    const response = await this.fetch(await this.playbackUrl(job.objectKey), { headers: { Range: 'bytes=0-31' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    try {
      if (response.status !== 206 || response.headers.get('content-range') !== `bytes 0-31/${job.totalBytes}`) throw new Error('R2 range verification failed');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== 32 || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error('R2 media verification failed');
    } finally { if (!response.bodyUsed) await response.body?.cancel(); }
  }
  async upload(job, save, { signal } = {}) {
    signal?.throwIfAborted();
    const stat = await fs.stat(job.file), handle = await fs.open(job.file, 'r');
    try {
      const hash = createHash('sha256');
      for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) { signal?.throwIfAborted(); hash.update(chunk); }
      const sha256 = hash.digest('hex');
      if (job.sha256 && job.sha256 !== sha256) throw new Error('Prepared file changed during multipart upload');
      job.sha256 = sha256; job.totalBytes = stat.size; await save();
      // Completion may have succeeded even if its response was lost. Never upload it twice.
      const existing = await this.head(job.objectKey, signal);
      if (existing?.ContentLength === stat.size && existing.Metadata?.sha256 === sha256) { job.bytes = stat.size; delete job.uploadId; await save(); return; }
      let parts = [];
      if (job.uploadId) {
        try { parts = await this.parts(job.objectKey, job.uploadId, signal); }
        catch (error) { if (error.name !== 'NoSuchUpload') throw error; delete job.uploadId; await save(); }
      }
      const used = await this.usage(signal), ownBytes = parts.reduce((sum, part) => sum + (part.Size || 0), 0);
      if (used - ownBytes + stat.size > CAPACITY_BYTES) { const error = new Error('Capacity limit'); error.code = 'capacity'; throw error; }
      if (!job.uploadId) {
        const result = await this.send(CreateMultipartUploadCommand, { Key: job.objectKey, ContentType: 'video/mp4', CacheControl: 'private, max-age=3600', Metadata: { sha256 } }, signal);
        job.uploadId = result.UploadId; await save();
      }
      const completed = [];
      job.bytes = ownBytes;
      for (let start = 0, number = 1; start < stat.size; start += PART_BYTES, number++) {
        signal?.throwIfAborted();
        const length = Math.min(PART_BYTES, stat.size - start), prior = parts.find(part => part.PartNumber === number && part.Size === length && part.ETag);
        let etag = prior?.ETag;
        if (!prior) {
          const buffer = Buffer.alloc(length), { bytesRead } = await handle.read(buffer, 0, length, start);
          if (bytesRead !== length) throw new Error('Prepared file truncated');
          const result = await this.send(UploadPartCommand, { Key: job.objectKey, UploadId: job.uploadId, PartNumber: number, Body: buffer, ContentLength: length }, signal); etag = result.ETag;
        }
        completed.push({ PartNumber: number, ETag: etag }); job.bytes = Math.min(stat.size, start + length); await save();
      }
      await this.send(CompleteMultipartUploadCommand, { Key: job.objectKey, UploadId: job.uploadId, MultipartUpload: { Parts: completed } }, signal);
      delete job.uploadId; await save();
    } finally { await handle.close(); }
  }
}
