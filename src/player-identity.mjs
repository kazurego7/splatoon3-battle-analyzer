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

function isYellow(r, g, b) {
  return r >= 155 && g >= 115 && b <= 105 && r - b >= 75 && g - b >= 55 && Math.abs(r - g) <= 100;
}

function darkRatio(frame, width, x, y, boxWidth, boxHeight) {
  let dark = 0;
  for (let py = y; py < y + boxHeight; py += 2) {
    for (let px = x; px < x + boxWidth; px += 2) {
      const [r, g, b] = rgbAt(frame, width, px, py);
      if (r < 62 && g < 62 && b < 62) dark += 1;
    }
  }
  return dark / (Math.ceil(boxWidth / 2) * Math.ceil(boxHeight / 2));
}

function scoreboardRowScore(frame, width) {
  let rows = 0;
  for (let rowY = 150; rowY < 510; rowY += 30) {
    let dark = 0;
    let bright = 0;
    let pixels = 0;
    for (let y = rowY; y < rowY + 30; y += 2) {
      for (let x = 500; x < 910; x += 2) {
        const [r, g, b] = rgbAt(frame, width, x, y);
        const luma = r * 0.299 + g * 0.587 + b * 0.114;
        if (luma < 55) dark += 1;
        if (luma > 180) bright += 1;
        pixels += 1;
      }
    }
    if (dark / pixels >= 0.72 && bright / pixels >= 0.025) rows += 1;
  }
  return rows;
}

function yellowComponents(frame, width) {
  const left = 430;
  const top = 175;
  const right = 535;
  const bottom = 525;
  const regionWidth = right - left;
  const regionHeight = bottom - top;
  const mask = new Uint8Array(regionWidth * regionHeight);
  for (let y = 0; y < regionHeight; y += 1) {
    for (let x = 0; x < regionWidth; x += 1) {
      if (isYellow(...rgbAt(frame, width, left + x, top + y))) mask[y * regionWidth + x] = 1;
    }
  }
  const visited = new Uint8Array(mask.length);
  const components = [];
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] || visited[index]) continue;
    const queue = [index];
    visited[index] = 1;
    let cursor = 0;
    let area = 0;
    let minX = regionWidth;
    let maxX = 0;
    let minY = regionHeight;
    let maxY = 0;
    while (cursor < queue.length) {
      const current = queue[cursor++];
      const x = current % regionWidth;
      const y = Math.floor(current / regionWidth);
      area += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= regionWidth || ny < 0 || ny >= regionHeight) continue;
        const next = ny * regionWidth + nx;
        if (mask[next] && !visited[next]) {
          visited[next] = 1;
          queue.push(next);
        }
      }
    }
    components.push({
      area,
      x: left + minX,
      y: top + minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    });
  }
  return components;
}

export function findSelfResultRow(frame, width = FRAME_WIDTH, height = FRAME_HEIGHT) {
  if (width !== FRAME_WIDTH || height !== FRAME_HEIGHT) throw new Error('本人確認は960x540フレームを使用してください');
  const panelDark = darkRatio(frame, width, 500, 150, 410, 380);
  if (panelDark < 0.42) return null;
  const resultRows = scoreboardRowScore(frame, width);
  if (resultRows < 7) return null;
  const candidates = yellowComponents(frame, width)
    .filter(item => item.area >= 55 && item.area <= 520)
    .filter(item => item.width >= 8 && item.width <= 38 && item.height >= 8 && item.height <= 38)
    .filter(item => item.x + item.width <= 515)
    .sort((a, b) => b.area - a.area);
  if (!candidates.length) return null;
  const marker = candidates[0];
  return {
    rowY: marker.y + marker.height / 2,
    marker,
    panelDark: Number(panelDark.toFixed(3)),
    resultRows,
  };
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

export function identifySelfHudSlot(resultFrame, resultRow, hudFrame, width = FRAME_WIDTH) {
  // The weapon icon is between the avatar and player name. Keeping the crop tight
  // avoids treating the avatar's ink-coloured hair as the weapon's dominant hue.
  const resultWeapon = grayCrop(resultFrame, width, 533, resultRow.rowY - 20, 40, 40);
  const resultColors = hueHistogram(colorCrop(resultFrame, width, 533, resultRow.rowY - 20, 40, 40));
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

export function findIdentityResult(samples) {
  return samples
    .map(sample => ({ ...sample, resultRow: findSelfResultRow(sample.frame) }))
    .filter(sample => sample.resultRow)
    .sort((a, b) => (b.resultRow.marker.area * b.resultRow.panelDark) - (a.resultRow.marker.area * a.resultRow.panelDark))[0] || null;
}

export const identityLayout = {
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
  hudSlots: HUD_SLOT_X.map((x, slot) => ({ slot, x, y: HUD_SLOT_Y, width: HUD_SLOT_WIDTH, height: HUD_SLOT_HEIGHT })),
};
