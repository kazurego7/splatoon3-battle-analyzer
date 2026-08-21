import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeWeaponReferenceSheets } from '../src/weapon-reference-sheets.mjs';

const SOURCE_PAGE = 'https://wikiwiki.jp/splatoon3mix/icon';
const MINIMUM_WEAPONS = 170;
const EXPECTED_WEAPONS = 173;
const DOWNLOAD_CONCURRENCY = 8;
const CATEGORY_ICONS = new Set([
  'シューター', 'ローラー', 'チャージャー', 'ブラスター', 'スロッシャー', 'スピナー',
  'フデ', 'マニューバー', 'シェルター', 'ストリンガー', 'ワイパー',
]);
const WEAPON_TYPES = new Set(CATEGORY_ICONS);

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(appRoot, '..');
const assetRoot = path.join(projectRoot, 'assets', 'weapon-icons');
const imageRoot = path.join(assetRoot, 'images');
const manifestPath = path.join(assetRoot, 'manifest.json');
const catalogPath = path.join(appRoot, 'src', 'weapon-catalog.json');
const ffmpeg = path.join(projectRoot, 'tools', 'runtime', 'video-split', 'imageio_ffmpeg', 'binaries', 'ffmpeg-win-x86_64-v7.1.exe');

function decodeEntities(value) {
  return value.replaceAll('&amp;', '&').replaceAll('&#039;', "'").replaceAll('&quot;', '"');
}

function weaponName(alt) {
  return decodeEntities(alt)
    .replace(/\.png(?:\.webp)?$/i, '')
    .replace(/\.webp$/i, '')
    .trim();
}

function weaponEntries(html) {
  const sectionStart = html.indexOf('<h2 id="h2_content_1_0"');
  const subWeaponStart = html.indexOf('alt="スプラッシュボム.webp"', sectionStart);
  if (sectionStart < 0 || subWeaponStart < 0) throw new Error('指定ページからメインブキ欄を特定できませんでした');
  const section = html.slice(sectionStart, subWeaponStart);
  const imagePattern = /<img[^>]+src="(?<url>[^"]*cdn\.wikiwiki\.jp\/to\/w\/splatoon3mix\/icon\/::ref\/[^"]+)"[^>]+alt="(?<name>[^"]+)"/gu;
  const entries = new Map();
  let type = null;
  for (const match of section.matchAll(imagePattern)) {
    const name = weaponName(match.groups.name);
    if (!name) continue;
    if (name.endsWith('_フチ')) {
      const candidateType = name.slice(0, -'_フチ'.length);
      if (WEAPON_TYPES.has(candidateType)) type = candidateType;
      continue;
    }
    if (CATEGORY_ICONS.has(name)) continue;
    if (!type) throw new Error(`${name} のブキ種別を特定できませんでした`);
    entries.set(name, { name, type, url: decodeEntities(match.groups.url) });
  }
  return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name, 'ja'));
}

function safeBaseName(name) {
  return encodeURIComponent(name).replaceAll('%', '_');
}

function imageExtension(contentType, url) {
  if (contentType.includes('webp') || /\.webp(?:\?|$)/i.test(url)) return 'webp';
  return 'png';
}

async function mapConcurrent(values, concurrency, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index], index);
    }
  }));
  return results;
}

async function downloadWeapon(entry, index, total) {
  const response = await fetch(entry.url, {
    headers: { 'User-Agent': 'splatoon-video-analyzer/0.1 (+local asset sync)' },
  });
  if (!response.ok) throw new Error(`${entry.name} の取得に失敗しました: HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  const extension = imageExtension(contentType, entry.url);
  const file = `${safeBaseName(entry.name)}.${extension}`;
  const output = path.join(imageRoot, file);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 512) throw new Error(`${entry.name} の画像サイズが不正です: ${bytes.length} bytes`);
  fs.writeFileSync(output, bytes);
  process.stderr.write(`\r${index + 1}/${total} ${entry.name}                    `);
  return {
    name: entry.name,
    type: entry.type,
    url: entry.url,
    file,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function rgbaFrame(file, width, height, filter) {
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-i', file,
    '-vf', filter,
    '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1',
  ], { encoding: null, maxBuffer: width * height * 8, windowsHide: true });
  if (result.status !== 0 || result.stdout.length < width * height * 4) {
    throw new Error(`画像変換に失敗しました: ${file}\n${result.stderr}`);
  }
  return result.stdout.subarray(0, width * height * 4);
}

function tightFeature(file) {
  const size = 96;
  const pixels = rgbaFrame(file, size, size, `scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=black@0`);
  let left = size;
  let right = -1;
  let top = size;
  let bottom = -1;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (pixels[(y * size + x) * 4 + 3] < 32) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error(`透明でない画素がありません: ${file}`);
  const output = Buffer.alloc(32 * 20 * 4);
  const sourceWidth = right - left + 1;
  const sourceHeight = bottom - top + 1;
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const sourceX = Math.min(right, Math.round(left + (x + 0.5) * sourceWidth / 32));
      const sourceY = Math.min(bottom, Math.round(top + (y + 0.5) * sourceHeight / 20));
      const sourceAt = (sourceY * size + sourceX) * 4;
      pixels.copy(output, (y * 32 + x) * 4, sourceAt, sourceAt + 4);
    }
  }
  return output;
}

function hudFeature(file) {
  return rgbaFrame(file, 48, 48, 'scale=48:48:force_original_aspect_ratio=decrease,pad=48:48:(ow-iw)/2:(oh-ih)/2:color=black@0');
}

if (!fs.existsSync(ffmpeg)) throw new Error(`FFmpegが見つかりません: ${ffmpeg}`);
fs.mkdirSync(imageRoot, { recursive: true });

const pageResponse = await fetch(SOURCE_PAGE, {
  headers: { 'User-Agent': 'splatoon-video-analyzer/0.1 (+local asset sync)' },
});
if (!pageResponse.ok) throw new Error(`ブキアイコンページを取得できません: HTTP ${pageResponse.status}`);
const html = await pageResponse.text();
const entries = weaponEntries(html);
if (entries.length < MINIMUM_WEAPONS) throw new Error(`メインブキが不足しています: ${entries.length}/${MINIMUM_WEAPONS}`);
if (entries.length !== EXPECTED_WEAPONS) {
  process.stderr.write(`\n注意: 現在のページは ${entries.length} 種です（検証済み ${EXPECTED_WEAPONS} 種）\n`);
}

const downloaded = await mapConcurrent(entries, DOWNLOAD_CONCURRENCY, (entry, index) => downloadWeapon(entry, index, entries.length));
process.stderr.write('\n');
const versionHash = crypto.createHash('sha256')
  .update(downloaded.map(item => `${item.name}\t${item.sha256}`).join('\n'))
  .digest('hex');
const version = `wikiwiki-icon-${versionHash.slice(0, 12)}`;
const generatedAt = new Date().toISOString();

const weapons = downloaded.map((item, index) => {
  process.stderr.write(`\r特徴生成 ${index + 1}/${downloaded.length} ${item.name}                    `);
  const file = path.join(imageRoot, item.file);
  return {
    id: `wikiwiki:${item.name}`,
    name: item.name,
    type: item.type,
    pixels: tightFeature(file).toString('base64'),
    hudPixels: hudFeature(file).toString('base64'),
  };
});
process.stderr.write('\n');
const referenceSheets = await writeWeaponReferenceSheets(downloaded, imageRoot);

const manifest = {
  version,
  generatedAt,
  sourcePage: SOURCE_PAGE,
  pageLastModified: pageResponse.headers.get('last-modified'),
  count: downloaded.length,
  referenceSheets,
  weapons: downloaded,
};
const catalog = {
  version,
  generatedAt,
  source: SOURCE_PAGE,
  width: 32,
  height: 20,
  hudWidth: 48,
  hudHeight: 48,
  weapons,
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
fs.writeFileSync(catalogPath, `${JSON.stringify(catalog)}\n`, 'utf8');
process.stdout.write(`ブキアイコン ${weapons.length} 種を更新しました (${version})\n`);
