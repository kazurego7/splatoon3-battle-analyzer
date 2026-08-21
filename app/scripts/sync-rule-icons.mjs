import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_PAGE = 'https://wikiwiki.jp/splatoon3mix/icon';
const rules = [
  { name: 'ナワバリ', sourceName: 'ルール_ナワバリバトル.png', file: 'turf.png' },
  { name: 'エリア', sourceName: 'ルール_ガチエリア.png', file: 'zones.png' },
  { name: 'ヤグラ', sourceName: 'ルール_ガチヤグラ.png', file: 'tower.png' },
  { name: 'ホコ', sourceName: 'ルール_ガチホコ.png', file: 'rainmaker.png' },
  { name: 'アサリ', sourceName: 'ルール_ガチアサリ.png', file: 'clams.png' },
];

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(appRoot, '..');
const assetRoot = path.join(projectRoot, 'assets', 'rule-icons');
const imageRoot = path.join(assetRoot, 'images');
const manifestPath = path.join(assetRoot, 'manifest.json');

const response = await fetch(SOURCE_PAGE, { headers: { 'User-Agent': 'splatoon-video-analyzer/0.1 (+local asset sync)' } });
if (!response.ok) throw new Error(`ルールアイコンページを取得できません: HTTP ${response.status}`);
const html = await response.text();
fs.mkdirSync(imageRoot, { recursive: true });

const downloaded = [];
for (const rule of rules) {
  const escaped = rule.sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<img[^>]+src="([^"]*cdn\\.wikiwiki\\.jp/to/w/splatoon3mix/icon/::ref/[^"]+)"[^>]+alt="${escaped}"`, 'u');
  const match = html.match(pattern);
  if (!match) throw new Error(`${rule.sourceName} のURLを取得できませんでした`);
  const url = match[1].replaceAll('&amp;', '&');
  const imageResponse = await fetch(url, { headers: { 'User-Agent': 'splatoon-video-analyzer/0.1 (+local asset sync)' } });
  if (!imageResponse.ok) throw new Error(`${rule.name} の取得に失敗しました: HTTP ${imageResponse.status}`);
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  if (bytes.length < 512) throw new Error(`${rule.name} の画像サイズが不正です: ${bytes.length} bytes`);
  fs.writeFileSync(path.join(imageRoot, rule.file), bytes);
  downloaded.push({ ...rule, url, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
}

const manifest = { sourcePage: SOURCE_PAGE, generatedAt: new Date().toISOString(), count: downloaded.length, rules: downloaded };
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`ルールアイコン ${downloaded.length} 種を更新しました`);
