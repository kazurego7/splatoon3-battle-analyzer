import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { PROJECT_ROOT } from './paths.mjs';

const COLUMNS = 10;
const CELL_WIDTH = 120;
const CELL_HEIGHT = 112;
export const WEAPON_HUD_FIXED_RECTS = Object.freeze([
  { label: 'A1', left: 68, top: 24, width: 89, height: 92 },
  { label: 'A2', left: 157, top: 24, width: 85, height: 92 },
  { label: 'A3', left: 242, top: 24, width: 87, height: 92 },
  { label: 'A4', left: 329, top: 24, width: 97, height: 92 },
  { label: 'E1', left: 581, top: 24, width: 89, height: 92 },
  { label: 'E2', left: 670, top: 24, width: 89, height: 92 },
  { label: 'E3', left: 759, top: 24, width: 90, height: 92 },
  { label: 'E4', left: 849, top: 24, width: 92, height: 92 },
]);
export const WEAPONS_PER_REFERENCE_SHEET = 44;
export const WEAPON_REFERENCE_ROOT = path.join(PROJECT_ROOT, 'assets', 'weapon-icons', 'reference-sheets');

function referenceFileName(index) {
  return `weapon-reference-${String(index + 1).padStart(2, '0')}.jpg`;
}

function labelSvg(label, width = CELL_WIDTH, height = 25) {
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#17212d"/>
    <text x="8" y="19" fill="#ffffff" font-family="Arial, sans-serif" font-size="18" font-weight="700">${label}</text>
  </svg>`);
}

export async function writeWeaponReferenceSheets(entries, imageRoot, outputRoot = WEAPON_REFERENCE_ROOT) {
  await fs.mkdir(outputRoot, { recursive: true });
  const sheets = [];
  for (let start = 0; start < entries.length; start += WEAPONS_PER_REFERENCE_SHEET) {
    const page = entries.slice(start, start + WEAPONS_PER_REFERENCE_SHEET);
    const rows = Math.ceil(page.length / COLUMNS);
    const composites = [];
    for (let index = 0; index < page.length; index += 1) {
      const entry = page[index];
      const left = (index % COLUMNS) * CELL_WIDTH;
      const top = Math.floor(index / COLUMNS) * CELL_HEIGHT;
      const icon = await sharp(path.join(imageRoot, entry.file))
        .resize({ width: 104, height: 79, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      composites.push(
        { input: labelSvg(String(start + index + 1).padStart(3, '0')), left, top },
        { input: icon, left: left + 8, top: top + 27 },
      );
    }
    const fileName = referenceFileName(sheets.length);
    const filePath = path.join(outputRoot, fileName);
    await sharp({
      create: {
        width: COLUMNS * CELL_WIDTH,
        height: rows * CELL_HEIGHT,
        channels: 3,
        background: { r: 244, g: 246, b: 248 },
      },
    }).composite(composites).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toFile(filePath);
    sheets.push({ file: fileName, start: start + 1, end: start + page.length });
  }
  return sheets;
}

export function weaponReferenceSheetPaths(weaponCount) {
  const count = Math.ceil(Number(weaponCount) / WEAPONS_PER_REFERENCE_SHEET);
  return Array.from({ length: count }, (_, index) => path.join(WEAPON_REFERENCE_ROOT, referenceFileName(index)));
}

export async function writeWeaponHudSlotSheet(sourcePath, outputPath) {
  const cellWidth = 240;
  const cellHeight = 220;
  const composites = [];
  for (let index = 0; index < WEAPON_HUD_FIXED_RECTS.length; index += 1) {
    const rect = WEAPON_HUD_FIXED_RECTS[index];
    const left = (index % 4) * cellWidth;
    const top = Math.floor(index / 4) * cellHeight;
    const icon = await sharp(sourcePath)
      .extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
      .resize({ width: 220, height: 184, fit: 'contain', background: { r: 9, g: 19, b: 30 } })
      .jpeg({ quality: 97, chromaSubsampling: '4:4:4' })
      .toBuffer();
    composites.push(
      { input: labelSvg(rect.label, cellWidth, 28), left, top },
      { input: icon, left: left + 10, top: top + 31 },
    );
  }
  await sharp({
    create: { width: cellWidth * 4, height: cellHeight * 2, channels: 3, background: { r: 9, g: 19, b: 30 } },
  }).composite(composites).jpeg({ quality: 96, chromaSubsampling: '4:4:4' }).toFile(outputPath);
  return outputPath;
}
