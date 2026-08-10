import path from 'node:path';
import { sampleGameCountFrames } from '../../../src/ffmpeg.mjs';
import { countRois, extractDigitGlyphs } from '../../../src/game-count-vision.mjs';

const source = path.resolve(process.argv[2]);
if (!process.argv[2]) throw new Error('動画ファイルを指定してください');
const duration = Number(process.argv[3]);
if (!Number.isFinite(duration)) throw new Error('動画の長さを秒で指定してください');
const times = (process.argv[4] || '').split(',').map(Number).filter(Number.isFinite);
const samples = await sampleGameCountFrames(source, duration, {
  onFrame(frame, width, _height, time) {
    return {
      time,
      left: extractDigitGlyphs(frame, width, countRois.leftX, countRois.y, countRois.leftWidth, countRois.leftThreshold),
      right: extractDigitGlyphs(frame, width, countRois.rightX, countRois.y, countRois.rightWidth, countRois.rightThreshold),
      rightVariants: [105, 130, 150, 175].map(threshold => ({ threshold, glyphs: extractDigitGlyphs(frame, width, countRois.rightX, countRois.y, countRois.rightWidth, threshold) })),
    };
  },
});

const inspected = times.map(time => {
  const sample = samples.reduce((closest, item) => Math.abs(item.time - time) < Math.abs(closest.time - time) ? item : closest);
  return {
    requested: time,
    time: sample.time,
    left: sample.left.map(glyph => ({ bounds: glyph.bounds, width: glyph.width, height: glyph.height, pixels: glyph.pixels })),
    right: sample.right.map(glyph => ({ bounds: glyph.bounds, width: glyph.width, height: glyph.height, pixels: glyph.pixels })),
    rightVariants: sample.rightVariants.map(variant => ({ threshold: variant.threshold, glyphs: variant.glyphs.map(glyph => ({ bounds: glyph.bounds, width: glyph.width, height: glyph.height, pixels: glyph.pixels })) })),
  };
});
console.log(JSON.stringify(inspected, null, 2));
