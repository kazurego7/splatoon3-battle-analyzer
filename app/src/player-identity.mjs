const FRAME_WIDTH = 960;
const FRAME_HEIGHT = 540;
const HUD_SLOT_X = [238, 290, 343, 395];
const HUD_SLOT_Y = 0;
const HUD_SLOT_WIDTH = 70;
const HUD_SLOT_HEIGHT = 62;

function rgbAt(frame, width, x, y) {
  const at = (y * width + x) * 3;
  return [frame[at], frame[at + 1], frame[at + 2]];
}

function grayCrop(frame, frameWidth, x, y, width, height, outputWidth = 112, outputHeight = 72) {
  const output = new Uint8Array(outputWidth * outputHeight);
  for (let oy = 0; oy < outputHeight; oy += 1) {
    const sourceY = Math.max(0, Math.min(FRAME_HEIGHT - 1, Math.round(y + (oy + 0.5) * height / outputHeight)));
    for (let ox = 0; ox < outputWidth; ox += 1) {
      const sourceX = Math.max(0, Math.min(frameWidth - 1, Math.round(x + (ox + 0.5) * width / outputWidth)));
      const [r, g, b] = rgbAt(frame, frameWidth, sourceX, sourceY);
      output[oy * outputWidth + ox] = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
    }
  }
  return { pixels: output, width: outputWidth, height: outputHeight };
}

function colorCrop(frame, frameWidth, x, y, width, height, outputWidth = 112, outputHeight = 72) {
  const output = new Uint8Array(outputWidth * outputHeight * 3);
  for (let oy = 0; oy < outputHeight; oy += 1) {
    const sourceY = Math.max(0, Math.min(FRAME_HEIGHT - 1, Math.round(y + (oy + 0.5) * height / outputHeight)));
    for (let ox = 0; ox < outputWidth; ox += 1) {
      const sourceX = Math.max(0, Math.min(frameWidth - 1, Math.round(x + (ox + 0.5) * width / outputWidth)));
      const sourceAt = (sourceY * frameWidth + sourceX) * 3;
      const outputAt = (oy * outputWidth + ox) * 3;
      output[outputAt] = frame[sourceAt];
      output[outputAt + 1] = frame[sourceAt + 1];
      output[outputAt + 2] = frame[sourceAt + 2];
    }
  }
  return output;
}

function hueHistogram(pixels, { ignoreBin = null, normalize = true } = {}) {
  const bins = new Float32Array(24);
  for (let index = 0; index < pixels.length; index += 3) {
    const r = pixels[index] / 255;
    const g = pixels[index + 1] / 255;
    const b = pixels[index + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const saturation = max ? delta / max : 0;
    if (saturation < 0.28 || max < 0.22 || max > 0.98 || delta === 0) continue;
    let hue;
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
    bins[Math.min(bins.length - 1, Math.floor(hue / 15))] += saturation * (0.4 + max * 0.6);
  }
  if (ignoreBin != null) {
    bins[ignoreBin] = 0;
    bins[(ignoreBin + bins.length - 1) % bins.length] *= 0.15;
    bins[(ignoreBin + 1) % bins.length] *= 0.15;
  }
  const total = bins.reduce((sum, value) => sum + value, 0);
  if (normalize && total) for (let index = 0; index < bins.length; index += 1) bins[index] /= total;
  return bins;
}

function hudTeamHueBin(hudCrops) {
  const combined = new Float32Array(24);
  for (const crop of hudCrops) {
    const histogram = hueHistogram(crop, { normalize: false });
    for (let index = 0; index < combined.length; index += 1) combined[index] += histogram[index];
  }
  let dominant = 0;
  for (let index = 1; index < combined.length; index += 1) if (combined[index] > combined[dominant]) dominant = index;
  return dominant;
}

function histogramDistance(first, second) {
  let overlap = 0;
  for (let index = 0; index < first.length; index += 1) overlap += Math.sqrt(first[index] * second[index]);
  return 1 - overlap;
}

function dominantHueBin(histogram) {
  let dominant = 0;
  for (let index = 1; index < histogram.length; index += 1) if (histogram[index] > histogram[dominant]) dominant = index;
  return dominant;
}

function nearbyHuePresence(histogram, bin) {
  return histogram[bin]
    + histogram[(bin + histogram.length - 1) % histogram.length] * 0.45
    + histogram[(bin + 1) % histogram.length] * 0.45;
}

function edges(image) {
  const result = new Uint8Array(image.pixels.length);
  for (let y = 1; y < image.height - 1; y += 1) {
    for (let x = 1; x < image.width - 1; x += 1) {
      const at = y * image.width + x;
      const gx = image.pixels[at + 1] - image.pixels[at - 1];
      const gy = image.pixels[at + image.width] - image.pixels[at - image.width];
      result[at] = Math.min(255, Math.abs(gx) + Math.abs(gy));
    }
  }
  return { ...image, pixels: result };
}

function distanceTransform(edgeImage, threshold = 55) {
  const { width, height, pixels } = edgeImage;
  const infinity = width + height;
  const distances = new Float32Array(pixels.length);
  for (let index = 0; index < pixels.length; index += 1) distances[index] = pixels[index] >= threshold ? 0 : infinity;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      if (x) distances[at] = Math.min(distances[at], distances[at - 1] + 1);
      if (y) distances[at] = Math.min(distances[at], distances[at - width] + 1);
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const at = y * width + x;
      if (x + 1 < width) distances[at] = Math.min(distances[at], distances[at + 1] + 1);
      if (y + 1 < height) distances[at] = Math.min(distances[at], distances[at + width] + 1);
    }
  }
  return distances;
}

function directedEdgeDistance(from, toDistances, threshold = 55) {
  let total = 0;
  let count = 0;
  for (let index = 0; index < from.pixels.length; index += 1) {
    if (from.pixels[index] < threshold) continue;
    total += Math.min(20, toDistances[index]);
    count += 1;
  }
  return count ? total / count : 20;
}

function shapeDistance(first, second) {
  const firstEdges = edges(first);
  const secondEdges = edges(second);
  return (directedEdgeDistance(firstEdges, distanceTransform(secondEdges)) + directedEdgeDistance(secondEdges, distanceTransform(firstEdges))) / 2;
}

export function identifySelfHudSlot(personalResultFrame, hudFrame, width = FRAME_WIDTH) {
  // The first equipment card on the personal result is always the player's
  // weapon. Its large icon gives a cleaner identity reference than gameplay.
  const resultWeapon = grayCrop(personalResultFrame, width, 440, 405, 88, 70);
  const resultColors = hueHistogram(colorCrop(personalResultFrame, width, 440, 405, 88, 70));
  const resultHueBin = dominantHueBin(resultColors);
  const hudColors = HUD_SLOT_X.map(x => colorCrop(hudFrame, width, x, HUD_SLOT_Y, HUD_SLOT_WIDTH, HUD_SLOT_HEIGHT));
  const teamHueBin = hudTeamHueBin(hudColors);
  const scores = HUD_SLOT_X.map((x, slot) => {
    const icon = grayCrop(hudFrame, width, x, HUD_SLOT_Y, HUD_SLOT_WIDTH, HUD_SLOT_HEIGHT);
    const shape = shapeDistance(resultWeapon, icon);
    const hudHistogram = hueHistogram(hudColors[slot], { ignoreBin: teamHueBin });
    const color = histogramDistance(resultColors, hudHistogram);
    const huePresence = nearbyHuePresence(hudHistogram, resultHueBin);
    return {
      slot,
      distance: Number((shape * 0.16 + color * 2.2 + (1 - huePresence) * 7).toFixed(3)),
      shapeDistance: Number(shape.toFixed(3)),
      colorDistance: Number(color.toFixed(3)),
      huePresence: Number(huePresence.toFixed(3)),
    };
  }).sort((a, b) => a.distance - b.distance);
  const margin = scores[1].distance - scores[0].distance;
  return {
    slot: scores[0].slot,
    confidence: Number(Math.max(0, Math.min(1, margin / Math.max(0.5, scores[1].distance))).toFixed(3)),
    teamHueBin,
    resultHueBin,
    scores,
  };
}

export const identityLayout = {
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
  hudSlots: HUD_SLOT_X.map((x, slot) => ({ slot, x, y: HUD_SLOT_Y, width: HUD_SLOT_WIDTH, height: HUD_SLOT_HEIGHT })),
};
