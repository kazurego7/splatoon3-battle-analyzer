import fs from 'node:fs';

const catalogLocation = process.env.WEAPON_CATALOG_PATH || new URL('./weapon-catalog.json', import.meta.url);
let catalog = { version: null, source: null, width: 32, height: 20, weapons: [] };
try {
  catalog = JSON.parse(fs.readFileSync(catalogLocation, 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const templates = catalog.weapons.map(item => ({ ...item, pixels: Buffer.from(item.pixels, 'base64') }));
const FEATURE_WIDTH = catalog.width;
const FEATURE_HEIGHT = catalog.height;

function foreground(r, g, b) {
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const luma = r * 0.299 + g * 0.587 + b * 0.114;
  return luma >= 48 && (maximum - minimum >= 16 || luma >= 105);
}

export function weaponFeatureFromCrop(frame, frameWidth, frameHeight, x, y, width, height) {
  let left = width;
  let right = 0;
  let top = height;
  let bottom = 0;
  for (let offsetY = 0; offsetY < height; offsetY += 1) {
    for (let offsetX = 0; offsetX < width; offsetX += 1) {
      const sourceX = Math.max(0, Math.min(frameWidth - 1, x + offsetX));
      const sourceY = Math.max(0, Math.min(frameHeight - 1, y + offsetY));
      const at = (sourceY * frameWidth + sourceX) * 3;
      if (!foreground(frame[at], frame[at + 1], frame[at + 2])) continue;
      left = Math.min(left, offsetX);
      right = Math.max(right, offsetX);
      top = Math.min(top, offsetY);
      bottom = Math.max(bottom, offsetY);
    }
  }
  if (left > right || top > bottom) return null;
  const output = Buffer.alloc(FEATURE_WIDTH * FEATURE_HEIGHT * 4);
  const sourceWidth = right - left + 1;
  const sourceHeight = bottom - top + 1;
  for (let outputY = 0; outputY < FEATURE_HEIGHT; outputY += 1) {
    for (let outputX = 0; outputX < FEATURE_WIDTH; outputX += 1) {
      const sourceX = x + Math.min(right, Math.round(left + (outputX + 0.5) * sourceWidth / FEATURE_WIDTH));
      const sourceY = y + Math.min(bottom, Math.round(top + (outputY + 0.5) * sourceHeight / FEATURE_HEIGHT));
      const sourceAt = (sourceY * frameWidth + sourceX) * 3;
      const targetAt = (outputY * FEATURE_WIDTH + outputX) * 4;
      const r = frame[sourceAt];
      const g = frame[sourceAt + 1];
      const b = frame[sourceAt + 2];
      if (!foreground(r, g, b)) continue;
      output[targetAt] = r;
      output[targetAt + 1] = g;
      output[targetAt + 2] = b;
      output[targetAt + 3] = 255;
    }
  }
  return output;
}

function featureDistance(candidate, reference) {
  let shapeDifference = 0;
  let colorDifference = 0;
  let overlap = 0;
  for (let index = 0; index < candidate.length; index += 4) {
    const candidateVisible = candidate[index + 3] >= 32;
    const referenceVisible = reference[index + 3] >= 32;
    if (candidateVisible !== referenceVisible) shapeDifference += 1;
    if (!candidateVisible || !referenceVisible) continue;
    const candidateMaximum = Math.max(candidate[index], candidate[index + 1], candidate[index + 2], 1);
    const referenceMaximum = Math.max(reference[index], reference[index + 1], reference[index + 2], 1);
    colorDifference += (
      Math.abs(candidate[index] / candidateMaximum - reference[index] / referenceMaximum)
      + Math.abs(candidate[index + 1] / candidateMaximum - reference[index + 1] / referenceMaximum)
      + Math.abs(candidate[index + 2] / candidateMaximum - reference[index + 2] / referenceMaximum)
    ) / 3;
    overlap += 1;
  }
  const pixels = FEATURE_WIDTH * FEATURE_HEIGHT;
  return shapeDifference / pixels * 0.72 + colorDifference / Math.max(1, overlap) * 0.28;
}

export function classifyWeaponFeature(feature, { limit = 5 } = {}) {
  if (!feature || templates.length === 0) return { status: 'unavailable', confidence: 0, candidates: [] };
  const candidates = templates
    .map(item => ({ id: item.id, name: item.name, distance: Number(featureDistance(feature, item.pixels).toFixed(4)) }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, limit);
  const best = candidates[0];
  const second = candidates[1];
  const margin = second ? second.distance - best.distance : 0;
  const confidence = Math.max(0, Math.min(1, margin / Math.max(0.03, second?.distance || 1) * Math.max(0, 1 - best.distance)));
  return {
    status: confidence >= 0.05 && best.distance <= 0.25 ? 'identified' : 'candidate-only',
    id: best.id,
    name: best.name,
    confidence: Number(confidence.toFixed(3)),
    distance: best.distance,
    candidates,
  };
}

export function identifyResultWeapon(frame, rowY, { frameWidth = 960, frameHeight = 540 } = {}) {
  const attempts = [];
  for (const x of [518, 520, 522]) {
    for (const width of [34, 38, 42]) {
      const height = 28;
      const feature = weaponFeatureFromCrop(frame, frameWidth, frameHeight, x, Math.round(rowY - 15), width, height);
      const result = classifyWeaponFeature(feature);
      attempts.push({ ...result, crop: { x, y: Math.round(rowY - 15), width, height } });
    }
  }
  return attempts.sort((left, right) => left.distance - right.distance || right.confidence - left.confidence)[0];
}

export const weaponCatalogMetadata = {
  version: catalog.version,
  source: catalog.source,
  count: templates.length,
  available: templates.length > 0,
};

export function weaponReferenceFeature(id) {
  const template = templates.find(item => item.id === id);
  return template ? Buffer.from(template.pixels) : null;
}
