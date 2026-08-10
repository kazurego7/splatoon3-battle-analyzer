import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.resolve(process.argv[2] || path.join(appRoot, '..', 'data', 'work', 'external-splat3-source'));
const ffmpeg = path.join(appRoot, '..', 'tools', 'runtime', 'video-split', 'imageio_ffmpeg', 'binaries', 'ffmpeg-win-x86_64-v7.1.exe');
const version = fs.readFileSync(path.join(sourceRoot, 'data', 'mush', 'latest'), 'utf8').trim();
const weapons = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'data', 'mush', version, 'WeaponInfoMain.json'), 'utf8'))
  .filter(item => item.Type === 'Versus');

function normalizedPixels(file) {
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-i', file,
    '-vf', 'scale=96:96:force_original_aspect_ratio=decrease',
    '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1',
  ], { encoding: null, maxBuffer: 96 * 96 * 8, windowsHide: true });
  if (result.status !== 0 || result.stdout.length < 96 * 96 * 4) throw new Error(`画像変換に失敗: ${file}\n${result.stderr}`);
  const pixels = result.stdout;
  let left = 96;
  let right = 0;
  let top = 96;
  let bottom = 0;
  for (let y = 0; y < 96; y += 1) {
    for (let x = 0; x < 96; x += 1) {
      if (pixels[(y * 96 + x) * 4 + 3] < 32) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const output = Buffer.alloc(32 * 20 * 4);
  const sourceWidth = Math.max(1, right - left + 1);
  const sourceHeight = Math.max(1, bottom - top + 1);
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const sourceX = Math.min(right, Math.round(left + (x + 0.5) * sourceWidth / 32));
      const sourceY = Math.min(bottom, Math.round(top + (y + 0.5) * sourceHeight / 20));
      const sourceAt = (sourceY * 96 + sourceX) * 4;
      const targetAt = (y * 32 + x) * 4;
      pixels.copy(output, targetAt, sourceAt, sourceAt + 4);
    }
  }
  return output.toString('base64');
}

const catalog = weapons.map((weapon, index) => {
  const file = path.join(sourceRoot, 'images', 'weapon_flat', `Path_Wst_${weapon.__RowId}.png`);
  if (!fs.existsSync(file)) throw new Error(`ブキ画像がありません: ${weapon.__RowId}`);
  process.stderr.write(`\r${index + 1}/${weapons.length} ${weapon.Label}                    `);
  return { id: weapon.__RowId, name: weapon.Label, pixels: normalizedPixels(file) };
});
process.stderr.write('\n');
fs.writeFileSync(path.join(appRoot, 'src', 'weapon-catalog.json'), `${JSON.stringify({ version, source: 'Leanny/splat3', width: 32, height: 20, weapons: catalog })}\n`);
