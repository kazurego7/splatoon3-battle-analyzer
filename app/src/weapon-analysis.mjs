import fs from 'node:fs';

const catalogLocation = process.env.WEAPON_CATALOG_PATH || new URL('./weapon-catalog.json', import.meta.url);
let catalog = { version: null, source: null, width: 32, height: 20, hudWidth: 48, hudHeight: 48, weapons: [] };
let iconFilesByName = new Map();
try {
  catalog = JSON.parse(fs.readFileSync(catalogLocation, 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
try {
  const manifest = JSON.parse(fs.readFileSync(new URL('../../assets/weapon-icons/manifest.json', import.meta.url), 'utf8'));
  iconFilesByName = new Map((manifest.weapons || []).map(item => [item.name, item.file]));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const templates = catalog.weapons.map(item => ({
  ...item,
  pixels: Buffer.from(item.pixels, 'base64'),
  hudPixels: item.hudPixels ? Buffer.from(item.hudPixels, 'base64') : null,
}));
const FEATURE_WIDTH = catalog.width;
const FEATURE_HEIGHT = catalog.height;
const HUD_FEATURE_WIDTH = catalog.hudWidth || 48;
const HUD_FEATURE_HEIGHT = catalog.hudHeight || 48;
export const WEAPON_HUD_CENTERS = Object.freeze([
  [288, 37], [330, 37], [373, 37], [417, 37],
  [544, 37], [587, 37], [633, 37], [677, 37],
]);

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

export function weaponHudFeatureFromCrop(frame, frameWidth, frameHeight, centerX, centerY, width = 50, height = 28) {
  const startX = Math.round(centerX - width / 2);
  const startY = Math.round(centerY - height / 2);
  const background = hudBackgroundColor(frame, frameWidth, frameHeight, centerX, centerY);
  const backgroundMaximum = Math.max(...background, 1);
  const backgroundChroma = background.map(value => value / backgroundMaximum);
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.max(0, Math.min(frameWidth - 1, startX + x));
      const sourceY = Math.max(0, Math.min(frameHeight - 1, startY + y));
      const at = (sourceY * frameWidth + sourceX) * 3;
      const r = frame[at], g = frame[at + 1], b = frame[at + 2];
      const maximum = Math.max(r, g, b, 1);
      const minimum = Math.min(r, g, b);
      const chromaDifference = (
        Math.abs(r / maximum - backgroundChroma[0])
        + Math.abs(g / maximum - backgroundChroma[1])
        + Math.abs(b / maximum - backgroundChroma[2])
      ) / 3;
      if (maximum - minimum >= 30 && chromaDifference <= 0.21 && Math.abs(maximum - backgroundMaximum) <= 145) {
        ink[y * width + x] = 1;
      }
    }
  }
  const foreground = new Uint8Array(width * height);
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (ink[y * width + x]) continue;
      let nearbyInk = false;
      for (let neighborY = Math.max(0, y - 2); neighborY <= Math.min(height - 1, y + 2) && !nearbyInk; neighborY += 1) {
        for (let neighborX = Math.max(0, x - 2); neighborX <= Math.min(width - 1, x + 2); neighborX += 1) {
          if (ink[neighborY * width + neighborX]) { nearbyInk = true; break; }
        }
      }
      if (!nearbyInk) continue;
      foreground[y * width + x] = 1;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return null;
  const output = Buffer.alloc(FEATURE_WIDTH * FEATURE_HEIGHT * 4);
  const sourceWidth = right - left + 1;
  const sourceHeight = bottom - top + 1;
  for (let outputY = 0; outputY < FEATURE_HEIGHT; outputY += 1) {
    for (let outputX = 0; outputX < FEATURE_WIDTH; outputX += 1) {
      const cropX = Math.min(right, Math.round(left + (outputX + 0.5) * sourceWidth / FEATURE_WIDTH));
      const cropY = Math.min(bottom, Math.round(top + (outputY + 0.5) * sourceHeight / FEATURE_HEIGHT));
      if (!foreground[cropY * width + cropX]) continue;
      const sourceX = Math.max(0, Math.min(frameWidth - 1, startX + cropX));
      const sourceY = Math.max(0, Math.min(frameHeight - 1, startY + cropY));
      const sourceAt = (sourceY * frameWidth + sourceX) * 3;
      const targetAt = (outputY * FEATURE_WIDTH + outputX) * 4;
      output[targetAt] = frame[sourceAt];
      output[targetAt + 1] = frame[sourceAt + 1];
      output[targetAt + 2] = frame[sourceAt + 2];
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

function hudPixelDistance(reference, referenceAt, frame, frameAt) {
  const alpha = reference[referenceAt + 3] / 255;
  const referenceR = reference[referenceAt];
  const referenceG = reference[referenceAt + 1];
  const referenceB = reference[referenceAt + 2];
  const frameR = frame[frameAt];
  const frameG = frame[frameAt + 1];
  const frameB = frame[frameAt + 2];
  const rgb = (Math.abs(referenceR - frameR) + Math.abs(referenceG - frameG) + Math.abs(referenceB - frameB)) / 765;
  const referenceMax = Math.max(referenceR, referenceG, referenceB, 1);
  const frameMax = Math.max(frameR, frameG, frameB, 1);
  const chroma = (
    Math.abs(referenceR / referenceMax - frameR / frameMax)
    + Math.abs(referenceG / referenceMax - frameG / frameMax)
    + Math.abs(referenceB / referenceMax - frameB / frameMax)
  ) / 3;
  const referenceLuma = referenceR * 0.299 + referenceG * 0.587 + referenceB * 0.114;
  const frameLuma = frameR * 0.299 + frameG * 0.587 + frameB * 0.114;
  const luma = Math.abs(referenceLuma - frameLuma) / 255;
  return alpha * (rgb * 0.5 + chroma * 0.32 + luma * 0.18);
}

function hudBackgroundColor(frame, frameWidth, frameHeight, centerX, centerY) {
  const buckets = new Map();
  for (let offsetY = -21; offsetY <= 21; offsetY += 1) {
    for (let offsetX = -21; offsetX <= 21; offsetX += 1) {
      if (offsetX * offsetX + offsetY * offsetY > 21 * 21) continue;
      const x = Math.round(centerX + offsetX);
      const y = Math.round(centerY + offsetY);
      if (x < 0 || y < 0 || x >= frameWidth || y >= frameHeight) continue;
      const at = (y * frameWidth + x) * 3;
      const r = frame[at], g = frame[at + 1], b = frame[at + 2];
      const maximum = Math.max(r, g, b);
      const minimum = Math.min(r, g, b);
      if (maximum < 70 || maximum - minimum < 45) continue;
      const key = `${r >> 5}:${g >> 5}:${b >> 5}`;
      const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      buckets.set(key, bucket);
    }
  }
  const best = [...buckets.values()].sort((left, right) => right.count - left.count)[0];
  return best
    ? [best.r / best.count, best.g / best.count, best.b / best.count]
    : [128, 128, 128];
}

function hudCompositeDistance(frame, frameWidth, frameHeight, centerX, centerY, reference, background, scale, offsetX, offsetY) {
  let distance = 0;
  let pixels = 0;
  for (let y = -22; y <= 22; y += 1) {
    for (let x = -22; x <= 22; x += 1) {
      if (x * x + y * y > 22 * 22) continue;
      const frameX = Math.round(centerX + x);
      const frameY = Math.round(centerY + y);
      if (frameX < 0 || frameY < 0 || frameX >= frameWidth || frameY >= frameHeight) continue;
      const referenceX = Math.round((x - offsetX) / scale + (HUD_FEATURE_WIDTH - 1) / 2);
      const referenceY = Math.round((y - offsetY) / scale + (HUD_FEATURE_HEIGHT - 1) / 2);
      let alpha = 0;
      let referenceR = background[0], referenceG = background[1], referenceB = background[2];
      if (referenceX >= 0 && referenceY >= 0 && referenceX < HUD_FEATURE_WIDTH && referenceY < HUD_FEATURE_HEIGHT) {
        const referenceAt = (referenceY * HUD_FEATURE_WIDTH + referenceX) * 4;
        alpha = reference[referenceAt + 3] / 255;
        referenceR = reference[referenceAt];
        referenceG = reference[referenceAt + 1];
        referenceB = reference[referenceAt + 2];
      }
      const predictedR = referenceR * alpha + background[0] * (1 - alpha);
      const predictedG = referenceG * alpha + background[1] * (1 - alpha);
      const predictedB = referenceB * alpha + background[2] * (1 - alpha);
      const frameAt = (frameY * frameWidth + frameX) * 3;
      distance += (
        Math.abs(predictedR - frame[frameAt])
        + Math.abs(predictedG - frame[frameAt + 1])
        + Math.abs(predictedB - frame[frameAt + 2])
      ) / 765;
      pixels += 1;
    }
  }
  return distance / Math.max(1, pixels);
}

function hudTemplateDistance(frame, frameWidth, frameHeight, centerX, centerY, reference, background) {
  if (!reference) return Infinity;
  let best = Infinity;
  for (const scale of [0.72, 0.8, 0.88, 0.96]) {
    for (const offsetY of [-4, 0, 4]) {
      for (const offsetX of [-4, 0, 4]) {
      let distance = 0;
      let weight = 0;
      let referenceLumaSum = 0;
      let frameLumaSum = 0;
      let referenceLumaSquared = 0;
      let frameLumaSquared = 0;
      let lumaProduct = 0;
      for (let y = 0; y < HUD_FEATURE_HEIGHT; y += 1) {
        const frameY = Math.round(centerY + (y - (HUD_FEATURE_HEIGHT - 1) / 2) * scale + offsetY);
        if (frameY < 0 || frameY >= frameHeight) continue;
        for (let x = 0; x < HUD_FEATURE_WIDTH; x += 1) {
          const referenceAt = (y * HUD_FEATURE_WIDTH + x) * 4;
          const alpha = reference[referenceAt + 3];
          if (alpha < 48) continue;
          const frameX = Math.round(centerX + (x - (HUD_FEATURE_WIDTH - 1) / 2) * scale + offsetX);
          if (frameX < 0 || frameX >= frameWidth) continue;
          const frameAt = (frameY * frameWidth + frameX) * 3;
          const pixelWeight = alpha / 255;
          const referenceLuma = reference[referenceAt] * 0.299 + reference[referenceAt + 1] * 0.587 + reference[referenceAt + 2] * 0.114;
          const frameLuma = frame[frameAt] * 0.299 + frame[frameAt + 1] * 0.587 + frame[frameAt + 2] * 0.114;
          distance += hudPixelDistance(reference, referenceAt, frame, frameAt);
          weight += pixelWeight;
          referenceLumaSum += referenceLuma * pixelWeight;
          frameLumaSum += frameLuma * pixelWeight;
          referenceLumaSquared += referenceLuma * referenceLuma * pixelWeight;
          frameLumaSquared += frameLuma * frameLuma * pixelWeight;
          lumaProduct += referenceLuma * frameLuma * pixelWeight;
        }
      }
      const referenceDistance = distance / Math.max(1, weight);
      const covariance = lumaProduct - referenceLumaSum * frameLumaSum / Math.max(1, weight);
      const referenceVariance = referenceLumaSquared - referenceLumaSum * referenceLumaSum / Math.max(1, weight);
      const frameVariance = frameLumaSquared - frameLumaSum * frameLumaSum / Math.max(1, weight);
      const correlation = covariance / Math.sqrt(Math.max(1, referenceVariance * frameVariance));
      const correlationDistance = (1 - Math.max(-1, Math.min(1, correlation))) / 2;
      const compositeDistance = hudCompositeDistance(
        frame, frameWidth, frameHeight, centerX, centerY, reference, background, scale, offsetX, offsetY,
      );
      best = Math.min(best, referenceDistance * 0.2 + compositeDistance * 0.2 + correlationDistance * 0.6);
      }
    }
  }
  return best;
}

export function classifyWeaponHudSlot(frame, frameWidth, frameHeight, centerX, centerY, { limit = 5 } = {}) {
  if (!frame || !templates.some(item => item.hudPixels)) return { status: 'unavailable', confidence: 0, candidates: [] };
  const background = hudBackgroundColor(frame, frameWidth, frameHeight, centerX, centerY);
  const shapeFeature = weaponHudFeatureFromCrop(frame, frameWidth, frameHeight, centerX, centerY);
  const shapeDistances = new Map(classifyWeaponFeature(shapeFeature, { limit: templates.length }).candidates
    .map(item => [item.id, item.distance]));
  const candidates = templates
    .filter(item => item.hudPixels)
    .map(item => ({
      id: item.id,
      name: item.name,
      distance: Number((
        hudTemplateDistance(frame, frameWidth, frameHeight, centerX, centerY, item.hudPixels, background) * 0.8
        + (shapeDistances.get(item.id) ?? 1) * 0.2
      ).toFixed(4)),
      shapeDistance: shapeDistances.get(item.id) ?? null,
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, limit);
  const best = candidates[0];
  const second = candidates[1];
  const margin = Math.max(0, (second?.distance ?? best.distance) - best.distance);
  const confidence = Math.max(0, Math.min(1, margin / 0.08 * Math.max(0, 1 - best.distance / 0.55)));
  return {
    status: best.distance <= 0.34 && confidence >= 0.08 ? 'identified' : 'candidate-only',
    id: best.id,
    name: best.name,
    confidence: Number(confidence.toFixed(3)),
    distance: best.distance,
    margin: Number(margin.toFixed(4)),
    candidates,
  };
}

export function classifyWeaponHudFrame(frame, frameWidth, frameHeight, { centers = WEAPON_HUD_CENTERS, limit = 5 } = {}) {
  return centers.map(([centerX, centerY], slot) => ({
    slot,
    team: slot < 4 ? 'ally' : 'enemy',
    ...classifyWeaponHudSlot(frame, frameWidth, frameHeight, centerX, centerY, { limit }),
  }));
}


export const weaponCatalogMetadata = {
  version: catalog.version,
  source: catalog.source,
  count: templates.length,
  available: templates.length > 0,
  hudAvailable: templates.some(item => item.hudPixels),
};

export function weaponCatalogEntries() {
  return templates.map(({ id, name, type }) => ({
    id,
    name,
    type,
    iconUrl: iconFilesByName.has(name) ? `/assets/weapon-icons/${encodeURIComponent(iconFilesByName.get(name))}` : null,
  }));
}

export function weaponReferenceFeature(id) {
  const template = templates.find(item => item.id === id);
  return template ? Buffer.from(template.pixels) : null;
}
