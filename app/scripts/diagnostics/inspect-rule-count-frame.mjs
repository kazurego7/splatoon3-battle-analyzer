import path from 'node:path';
import { extractRgbFrame } from '../../src/ffmpeg.mjs';
import { analyzeGameCountFrame, countUiProfileForRule, extractDigitGlyphs, gameCountFrameRegionForRule, rankGlyph } from '../../src/game-count-vision.mjs';

const source = path.resolve(process.argv[2] || '');
const rule = process.argv[3] || null;
const time = Number(process.argv[4] || 0);
if (!source) throw new Error('動画パス、ルール、時刻を指定してください');

const sourceWidth = 1920;
const sourceHeight = 1080;
const region = gameCountFrameRegionForRule(rule);
const frame = await extractRgbFrame(source, time, { width: sourceWidth, height: sourceHeight });
const cropped = Buffer.alloc(region.width * region.height * 3);
for (let y = 0; y < region.height; y += 1) {
  frame.copy(
    cropped,
    y * region.width * 3,
    ((region.y + y) * sourceWidth + region.x) * 3,
    ((region.y + y) * sourceWidth + region.x + region.width) * 3,
  );
}

const profile = countUiProfileForRule(rule);
const rawGlyphs = profile.dynamic ? Object.fromEntries(['left', 'right'].map(side => {
  const startX = side === 'left' ? profile.leftX : profile.rightX;
  const width = side === 'left' ? profile.leftWidth : profile.rightWidth;
  return [side, Object.fromEntries([145, 160, 175, 190, 'white'].map(threshold => [threshold,
    extractDigitGlyphs(cropped, region.width, startX, profile.y, width, threshold, profile.boxHeight)
      .filter(glyph => glyph.height >= 20)
      .map(glyph => ({ bounds: glyph.bounds, width: glyph.width, height: glyph.height, pixels: glyph.pixels, ranked: rankGlyph(glyph) })),
  ]))];
})) : null;

console.log(JSON.stringify({ source, rule, time, region, ...analyzeGameCountFrame(cropped, region.width, time, { rule }), rawGlyphs }, null, 2));
