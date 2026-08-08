const MODEL_WIDTH = 55;
const MODEL_HEIGHT = 15;
const SCALE = 4;
const FINE_WIDTH = 110;
const FINE_HEIGHT = 30;
const fineWhiteTemplates = {
  normal: [1381,1382,1412,1468,1469,1470,1471,1472,1473,1476,1478,1479,1480,1483,1484,1485,1486,1489,1490,1491,1492,1495,1496,1497,1498,1502,1507,1508,1509,1510,1514,1515,1518,1519,1521,1522,1578,1579,1580,1581,1582,1583,1588,1589,1590,1593,1594,1595,1599,1600,1601,1602,1606,1612,1613,1614,1617,1620,1625,1626,1628,1629,1631,1632,1633,1688,1689,1691,1692,1693,1699,1703,1704,1705,1706,1710,1715,1716,1717,1718,1721,1722,1723,1727,1730,1734,1735,1738,1739,1740,1741,1742,1743,1798,1799,1801,1802,1806,1808,1809,1810,1814,1815,1816,1819,1824,1826,1827,1828,1829,1831,1832,1837,1839,1840,1845,1846,1848,1849,1850,1852,1853,1908,1909,1911,1912,1913,1916,1918,1920,1923,1925,1926,1930,1931,1934,1935,1936,1938,1939,1941,1942,1943,1944,1945,1947,1948,1949,1950,1952,1953,1955,1956,1958,1959,1961,1962,2021,2022,2023,2028,2029,2030,2033,2034,2041,2045,2053,2059,2064,2065,2071],
  tacticooler: [247,358,1457,1474,1475,1479,1481,1482,1520,1567,1571,1572,1583,1591,1597,1598,1603,1608,1609,1619,1626,1630,1633,1681,1693,1694,1707,1713,1729,1732,1740,1742,1743,1744,1802,1804,1808,1810,1811,1823,1828,1834,1835,1839,1842,1850,1851,1852,1853,1914,1915,1922,1932,1937,1938,1939,1940,1944,1949,1960,2008,2010,2022,2024,2031,2032,2037,2042,2051,2053,2058,2059,2066,2070,2071,2134,2135,2139,2140,2142,2143,2146,2147,2148,2158,2161,2169,2176,2180,2183,2249,2250,2253,2257,2268,2271,2286,2290,2293,2360,2361,2362,2363,2385,2386],
};

const templates = [
  {
    kind: 'normal',
    categories: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEBAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAwAAAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAAEBAQEBAQEBAQEBAQEBAQACAgEBAgEBAQEBAgABAQADAwMDAgMDAwMDAwMDAwMDAwMDAwMAAQEBAQEBAQEBAQEBAQEBAQECAgIBAAIBAAIBAQIBAgIAAwIAAgMCAwIDAgICAwMDAwMDAwMDAwEBAQEBAQEBAQEBAQEBAQEBAgICAQACAAECAQEBAQICAgMCAwMCAgMDAwIAAgMDAwMDAwMDAwMDAwEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwEDAwMDAwMDAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAwMDAwMDAwMDAwMDAwMDAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwMDAwMDAwMDAwMDAwMDAwMDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMDAwMDAwMDAwMDAwMDAwMDAwMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAwMDAwMDAwMDAwMDAwMDAwMDAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  },
  {
    kind: 'tacticooler',
    categories: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMDAwMAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMAAAAAAAAAAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAAAAAAADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwAAAAAAAwMDAwMDAwMDAwMDAwMDAwIAAwMAAAMCAwMCAwMCAwMDAwMDAwMDAwACAwMDAwMDAwMAAAAAAwMDAwMDAwMDAwMDAwMDAwMAAgMDAgADAAMDAgMDAgMDAgMAAwMDAwMCAgMDAwMDAwMDAAAAAAMDAwMDAwMDAwMDAwMDAwMDAAIDAwICAwIDAwMDAwAAAwMDAwMDAwMDAgMDAwMDAwMDAwAAAAAAAwMDAwMDAwMDAwMDAwMDAwMAAwMCAgMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMAAAAAAAAAAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAAAAAAAAAAMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwMAAAAAAAMDAwMDAwMDAwMDAwMDAwMDAwADAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwMDAAAAAAADAwMDAwMDAwMDAwMDAwMDAwAAAAAA',
  },
].map(template => ({ ...template, values: new Uint8Array(Buffer.from(template.categories, 'base64')) }));

function pixelCategory(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max ? (max - min) / max : 0;
  if (max < 55) return 1;
  if (min > 170 && max > 205) return 2;
  if (saturation > 0.25 && max > 95) return 3;
  return 0;
}

function categoryGrid(frame, width) {
  const values = new Uint8Array(MODEL_WIDTH * MODEL_HEIGHT);
  for (let gy = 0; gy < MODEL_HEIGHT; gy += 1) {
    for (let gx = 0; gx < MODEL_WIDTH; gx += 1) {
      const counts = [0, 0, 0, 0];
      for (let y = gy * SCALE; y < gy * SCALE + SCALE; y += 1) {
        for (let x = gx * SCALE; x < gx * SCALE + SCALE; x += 1) {
          const at = (y * width + x) * 3;
          counts[pixelCategory(frame[at], frame[at + 1], frame[at + 2])] += 1;
        }
      }
      let category = 1;
      for (let index = 2; index < counts.length; index += 1) if (counts[index] > counts[category]) category = index;
      values[gy * MODEL_WIDTH + gx] = counts[category] >= 6 ? category : 0;
    }
  }
  return values;
}

function fineWhiteGrid(frame, width) {
  const values = new Uint8Array(FINE_WIDTH * FINE_HEIGHT);
  for (let gy = 0; gy < FINE_HEIGHT; gy += 1) {
    for (let gx = 0; gx < FINE_WIDTH; gx += 1) {
      let white = 0;
      for (let y = gy * 2; y < gy * 2 + 2; y += 1) {
        for (let x = gx * 2; x < gx * 2 + 2; x += 1) {
          const at = (y * width + x) * 3;
          if (Math.min(frame[at], frame[at + 1], frame[at + 2]) > 170 && Math.max(frame[at], frame[at + 1], frame[at + 2]) > 205) white += 1;
        }
      }
      if (white >= 2) values[gy * FINE_WIDTH + gx] = 1;
    }
  }
  return values;
}

function fineWhiteScore(values, indices) {
  let best = { score: 0, offset: [0, 0] };
  for (let dy = -6; dy <= 6; dy += 1) {
    for (let dx = -8; dx <= 8; dx += 1) {
      let matched = 0;
      let considered = 0;
      for (const index of indices) {
        const x = index % FINE_WIDTH;
        const y = Math.floor(index / FINE_WIDTH);
        const targetX = x + dx;
        const targetY = y + dy;
        if (targetX < 0 || targetX >= FINE_WIDTH || targetY < 0 || targetY >= FINE_HEIGHT) continue;
        considered += 1;
        if (values[targetY * FINE_WIDTH + targetX]) matched += 1;
      }
      const score = matched / Math.max(1, considered);
      if (score > best.score) best = { score, offset: [dx, dy] };
    }
  }
  return best;
}

function shiftedTemplateScore(values, template, dx, dy) {
  let matched = 0;
  let total = 0;
  let whiteMatched = 0;
  let whiteTotal = 0;
  for (let index = 0; index < template.values.length; index += 1) {
    const expected = template.values[index];
    if (!expected) continue;
    const sourceX = index % MODEL_WIDTH;
    const sourceY = Math.floor(index / MODEL_WIDTH);
    const targetX = sourceX + dx;
    const targetY = sourceY + dy;
    if (targetX < 0 || targetX >= MODEL_WIDTH || targetY < 0 || targetY >= MODEL_HEIGHT) continue;
    const target = targetY * MODEL_WIDTH + targetX;
    const weight = expected === 2 ? 3 : expected === 1 ? 1.4 : 1;
    total += weight;
    if (expected === 2) whiteTotal += 1;
    if (values[target] === expected) {
      matched += weight;
      if (expected === 2) whiteMatched += 1;
    }
  }
  return {
    kind: template.kind,
    score: matched / Math.max(1, total),
    whiteScore: whiteMatched / Math.max(1, whiteTotal),
    offset: [dx, dy],
  };
}

function templateScore(values, template) {
  let best = null;
  for (let dy = -3; dy <= 3; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const current = shiftedTemplateScore(values, template, dx, dy);
      const currentRank = current.score + current.whiteScore * 0.18;
      const bestRank = best ? best.score + best.whiteScore * 0.18 : -1;
      if (currentRank > bestRank) best = current;
    }
  }
  return best;
}

export function analyzeRespawnFrame(frame, width, time) {
  const values = categoryGrid(frame, width);
  const whiteValues = fineWhiteGrid(frame, width);
  const matches = templates.map(template => {
    const coarse = templateScore(values, template);
    const fine = fineWhiteScore(whiteValues, fineWhiteTemplates[template.kind]);
    return { ...coarse, fineWhiteScore: fine.score, fineWhiteOffset: fine.offset };
  }).sort((a, b) => (b.score + b.fineWhiteScore * 0.35) - (a.score + a.fineWhiteScore * 0.35));
  return { time, ...matches[0], matches };
}

function isRespawnObservation(sample) {
  const threshold = sample.kind === 'tacticooler' ? 0.61 : 0.56;
  return sample.score >= threshold && sample.whiteScore >= 0.34 && sample.fineWhiteScore >= 0.46;
}

export function detectRespawnRuns(samples, { gameplayStart = 10, gameplayEnd = Infinity } = {}) {
  const observations = samples.filter(sample => sample.time >= gameplayStart && sample.time <= gameplayEnd && isRespawnObservation(sample));
  const runs = [];
  for (const sample of observations) {
    const previous = runs.at(-1);
    if (previous && sample.time - previous.end <= 0.75) {
      previous.end = sample.time;
      previous.peak = sample.score > previous.peak.score ? sample : previous.peak;
      previous.observations += 1;
    } else {
      runs.push({ start: sample.time, end: sample.time, peak: sample, observations: 1 });
    }
  }
  return runs
    .filter(run => run.observations >= 2 && run.end - run.start >= 0.25)
    .map((run, index) => ({
      id: `death-${index + 1}`,
      time: run.start,
      end: run.end + 0.5,
      duration: run.end - run.start + 0.5,
      type: 'death',
      title: '自分がデス',
      detail: '画面右下の「復活まであとX秒」UIを連続フレームで確認した場面です。',
      confidence: Number(Math.min(0.99, 0.72 + run.peak.score * 0.25).toFixed(3)),
      evidence: {
        detector: 'respawn-countdown-ui',
        variant: run.peak.kind,
        templateScore: Number(run.peak.score.toFixed(3)),
        whiteTextScore: Number(run.peak.whiteScore.toFixed(3)),
        fineWhiteTextScore: Number(run.peak.fineWhiteScore.toFixed(3)),
        observations: run.observations,
      },
    }));
}

export const respawnModelVersion = 2;
