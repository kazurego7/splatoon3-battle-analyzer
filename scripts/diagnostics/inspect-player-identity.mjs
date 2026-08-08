import path from 'node:path';
import { extractRgbFrame, sampleRgbWindow } from '../../src/ffmpeg.mjs';
import { findIdentityResult, identifySelfHudSlot } from '../../src/player-identity.mjs';

const source = path.resolve(process.argv[2]);
const duration = Number(process.argv[3]);
if (!process.argv[2] || !Number.isFinite(duration)) {
  throw new Error('使い方: npm run inspect:identity -- <試合動画> <長さ秒>');
}

const hudFrame = await extractRgbFrame(source, Math.min(20, duration / 3));
const samples = await sampleRgbWindow(source, Math.max(0, duration - 70), duration - 1);
const result = findIdentityResult(samples);
if (!result) {
  console.log(JSON.stringify({ status: 'unconfirmed', reason: '自分を示すリザルト行を検出できませんでした' }, null, 2));
  process.exit(2);
}
const identity = identifySelfHudSlot(result.frame, result.resultRow, hudFrame);
console.log(JSON.stringify({
  status: identity.confidence >= 0.06 ? 'confirmed' : 'low-confidence',
  resultTime: result.time,
  row: result.resultRow,
  ...identity,
}, null, 2));
