import fs from 'node:fs/promises';
import path from 'node:path';
import { LiveMediaSession, resolveLiveProxyEncoder } from '../../src/live-media-session.mjs';

const [source, outputDir] = process.argv.slice(2);
if (!source || !outputDir) {
  throw new Error('usage: node scripts/diagnostics/validate-live-proxy.mjs <source> <output-dir>');
}
const sourceSize = (await fs.stat(source)).size;
const encoder = await resolveLiveProxyEncoder();
const session = new LiveMediaSession({ source, outputDir, segmentSeconds: 2, proxyEncoder: encoder });
session.on('progress', ({ bytesRead }) => { if (bytesRead >= sourceSize) session.stop(); });
const startedAt = Date.now();
const segments = await session.start();
const proxySize = (await Promise.all(segments.map(segment => fs.stat(path.join(outputDir, segment.fileName)))))
  .reduce((total, stat) => total + stat.size, 0);
const elapsedSeconds = (Date.now() - startedAt) / 1000;
const duration = segments.at(-1)?.end || 0;
console.log(JSON.stringify({
  encoder,
  sourceBytes: sourceSize,
  proxyBytes: proxySize,
  sizePercent: Number((proxySize / sourceSize * 100).toFixed(2)),
  elapsedSeconds: Number(elapsedSeconds.toFixed(2)),
  duration: Number(duration.toFixed(3)),
  realtimeMultiple: Number((duration / elapsedSeconds).toFixed(2)),
  fragments: segments.length,
}, null, 2));
