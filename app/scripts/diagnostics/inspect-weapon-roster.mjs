import path from 'node:path';
import { extractRgbFrame } from '../../src/ffmpeg.mjs';
import { classifyWeaponHudFrame, weaponCatalogMetadata } from '../../src/weapon-analysis.mjs';

const clip = process.argv[2] ? path.resolve(process.argv[2]) : null;
const times = (process.argv.slice(3).length ? process.argv.slice(3) : ['12', '14', '16'])
  .map(Number)
  .filter(Number.isFinite);
const expectedWeapon = process.env.EXPECTED_WEAPON || null;
const expectedRoster = String(process.env.EXPECTED_ROSTER || '').split('|').map(value => value.trim()).filter(Boolean);
if (!clip) throw new Error('使い方: node scripts/diagnostics/inspect-weapon-roster.mjs <試合動画> [秒 ...]');
if (!weaponCatalogMetadata.hudAvailable) throw new Error('先に npm run sync:weapons を実行してください');

const frames = [];
for (const time of times) {
  const frame = await extractRgbFrame(clip, time, { width: 960, height: 540 });
  frames.push({ time, slots: classifyWeaponHudFrame(frame, 960, 540, { limit: expectedWeapon || expectedRoster.length ? 173 : 5 }) });
}

for (const { time, slots } of frames) {
  console.log(`\n${time.toFixed(2)}秒`);
  for (const slot of slots) {
    const candidates = slot.candidates.slice(0, 3).map(item => `${item.name}:${item.distance}/${item.shapeDistance}`).join(', ');
    const expectedName = expectedRoster[slot.slot] || expectedWeapon;
    const expected = expectedName
      ? slot.candidates.findIndex(item => item.name === expectedName)
      : -1;
    const expectedText = expected >= 0
      ? ` expected=${expectedName}@${expected + 1}:${slot.candidates[expected].distance}/${slot.candidates[expected].shapeDistance}`
      : '';
    console.log(`${slot.team} ${slot.slot % 4 + 1}: ${slot.name} (${slot.status}, conf=${slot.confidence}) [${candidates}]${expectedText}`);
  }
}
