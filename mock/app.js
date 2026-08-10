const FALLBACK_DURATION = 359;

const demoAnalysis = {
  route: [
    [0, 170, 815, 100], [18, 230, 744, 100], [36, 305, 672, 100], [54, 390, 625, 100],
    [72, 466, 563, 72], [86, 522, 508, 41], [96, 190, 820, 100], [118, 292, 710, 100],
    [138, 418, 606, 86], [156, 492, 518, 58], [171, 535, 450, 0], [184, 185, 818, 100],
    [207, 310, 690, 100], [226, 455, 598, 100], [244, 560, 510, 63], [263, 612, 424, 32],
    [275, 565, 485, 80], [287, 530, 453, 0], [300, 180, 820, 100], [320, 328, 692, 100],
    [340, 470, 580, 75], [359, 548, 508, 54]
  ],
  events: [
    { time: 18, type: 'insight', kind: 'ANALYSIS', title: '初動で確認できた射線', detail: '右へ展開した時点では、正面高台の敵だけが映像内で確認できています。', focus: '視界に入った敵の向き' },
    { time: 67, type: 'insight', kind: 'POSITIONING', title: 'ヤグラ前で一度停止', detail: '敵が視界から消えたあと、最後に見えた進行方向と再出現位置を比較します。', focus: '最終確認位置からの移動' },
    { time: 92, type: 'death', kind: 'DEATH REVIEW', title: '2方向の敵を視認してからデス', detail: 'デス8秒前からシューターと長射程が順に視界へ入りました。どちらを認識できる時間があったか確認します。', focus: '敵を見た順番と照準の移動' },
    { time: 132, type: 'insight', kind: 'ANALYSIS', title: '味方と同じ敵を視認', detail: '映像内の味方と自分が、同じシューターへ射線を向けています。', focus: '味方の視線と攻撃対象' },
    { time: 171, type: 'death', kind: 'DEATH REVIEW', title: '高台の敵が視界端に入っていた', detail: 'デス6秒前、右上に長射程が映っています。その後、正面の敵へ視点を固定しています。', focus: '画面端の敵と視点固定' },
    { time: 228, type: 'insight', kind: 'ANALYSIS', title: '敵が消えた方向を追えている', detail: '敵が遮蔽へ隠れたあと、最後に見えた方向へ視点を移せています。', focus: '見失った直後の視点' },
    { time: 287, type: 'death', kind: 'DEATH REVIEW', title: '追撃中に別の敵が視界へ入った', detail: '追っている敵に加え、デス4秒前から画面左に別の敵が映っています。', focus: '新しく視界へ入った脅威' },
    { time: 331, type: 'insight', kind: 'ANALYSIS', title: '終盤に確認できた敵位置', detail: '右側の敵は映像で確認できていますが、マップの反対側には根拠のない敵位置を表示していません。', focus: '確認情報と未知領域の区別' }
  ],
  detections: [
    { id: 'ally-a-1', entity: 'ally-a', team: 'ally', label: '味方', weapon: 'N-ZAP85', mapLabel: 'ZAP', frames: [[81, .18, .38, .10, .34, 445, 575], [85, .23, .36, .10, .35, 482, 548], [89, .30, .35, .11, .36, 520, 515]] },
    { id: 'shooter-a-1', entity: 'shooter-a', team: 'enemy', label: 'シューター', weapon: '.52ガロン', mapLabel: '52', frames: [[83, .74, .34, .10, .32, 635, 440], [87, .66, .36, .11, .34, 598, 464], [92, .55, .38, .12, .36, 548, 485]] },
    { id: 'charger-a-1', entity: 'charger-a', team: 'enemy', label: '長射程', weapon: 'リッター4K', mapLabel: '4K', frames: [[86, .86, .18, .07, .26, 690, 324], [89, .81, .20, .08, .27, 665, 345], [92, .77, .22, .08, .28, 642, 365]] },
    { id: 'ally-b-1', entity: 'ally-b', team: 'ally', label: '味方', weapon: 'シャープマーカー', mapLabel: 'シャ', frames: [[125, .32, .42, .10, .34, 425, 570], [130, .38, .40, .10, .35, 468, 538], [135, .44, .39, .11, .36, 510, 508]] },
    { id: 'shooter-b-1', entity: 'shooter-b', team: 'enemy', label: 'シューター', weapon: 'スプラシューター', mapLabel: 'スシ', frames: [[126, .66, .36, .10, .32, 580, 456], [131, .60, .37, .11, .34, 548, 470], [136, .53, .38, .12, .35, 515, 482]] },
    { id: 'ally-c-1', entity: 'ally-c', team: 'ally', label: '味方', weapon: 'バケットスロッシャー', mapLabel: 'バケ', frames: [[159, .21, .43, .10, .33, 445, 545], [163, .26, .41, .10, .34, 472, 525], [166, .31, .40, .11, .35, 495, 505]] },
    { id: 'charger-c-1', entity: 'charger-c', team: 'enemy', label: '長射程', weapon: 'リッター4K', mapLabel: '4K', frames: [[162, .83, .16, .07, .25, 676, 315], [166, .79, .18, .08, .26, 658, 332], [171, .74, .20, .08, .28, 638, 354]] },
    { id: 'shooter-c-1', entity: 'shooter-c', team: 'enemy', label: 'シューター', weapon: '.52ガロン', mapLabel: '52', frames: [[167, .60, .38, .10, .32, 565, 448], [169, .55, .39, .11, .34, 545, 462], [171, .49, .40, .12, .35, 522, 476]] },
    { id: 'shooter-d-1', entity: 'shooter-d', team: 'enemy', label: 'シューター', weapon: 'スプラシューター', mapLabel: 'スシ', frames: [[220, .70, .37, .10, .32, 610, 442], [225, .63, .38, .11, .34, 578, 460], [229, .57, .39, .11, .35, 548, 475]] },
    { id: 'ally-e-1', entity: 'ally-e', team: 'ally', label: '味方', weapon: 'N-ZAP85', mapLabel: 'ZAP', frames: [[276, .14, .40, .10, .34, 468, 540], [281, .20, .39, .11, .35, 500, 518], [285, .26, .38, .11, .36, 528, 498]] },
    { id: 'roller-e-1', entity: 'roller-e', team: 'enemy', label: 'ローラー', weapon: 'スプラローラー', mapLabel: 'ロラ', frames: [[275, .68, .42, .12, .34, 610, 488], [281, .60, .40, .13, .36, 575, 475], [287, .51, .39, .14, .38, 536, 462]] },
    { id: 'shooter-e-1', entity: 'shooter-e', team: 'enemy', label: 'シューター', weapon: 'シャープマーカー', mapLabel: 'シャ', frames: [[282, .08, .37, .09, .31, 470, 430], [284, .12, .38, .10, .33, 486, 440], [287, .18, .39, .11, .35, 510, 455]] },
    { id: 'shooter-f-1', entity: 'shooter-f', team: 'enemy', label: 'シューター', weapon: '.52ガロン', mapLabel: '52', frames: [[326, .73, .36, .10, .32, 612, 445], [331, .65, .38, .11, .34, 575, 465], [335, .58, .39, .12, .35, 545, 482]] }
  ],
  gameFlow: {
    teamCount: [[0, 100], [62, 96], [118, 88], [132, 79], [158, 75], [207, 63], [228, 52], [304, 48], [338, 45], [359, 45]],
    enemyCount: [[0, 100], [96, 96], [175, 92], [214, 88], [267, 81], [287, 73], [359, 73]],
    deaths: {
      self: [[92, 8], [171, 8], [287, 8]],
      ally: [[47, 8], [76, 8], [119, 8], [145, 8], [204, 8], [265, 8], [316, 8]],
      enemy: [[59, 8], [128, 8], [138, 8], [196, 8], [220, 8], [232, 8], [276, 8], [327, 8]]
    }
  }
};

let analysis = JSON.parse(JSON.stringify(demoAnalysis));

const video = document.getElementById('battle-video');
const seek = document.getElementById('seek');
const playPause = document.getElementById('play-pause');
const videoOverlay = document.getElementById('video-overlay');
const timelineProgress = document.getElementById('timeline-progress');
const timelineEvents = document.getElementById('timeline-events');
const currentTimeEl = document.getElementById('current-time');
const durationEl = document.getElementById('duration');
const mapClock = document.getElementById('map-clock');
const routeLayer = document.getElementById('route-layer');
const enemyLayer = document.getElementById('enemy-layer');
const playerLayer = document.getElementById('player-layer');
const hpValue = document.getElementById('hp-value');
const hpBar = document.getElementById('hp-bar');
const videoState = document.getElementById('video-state');
const perceptionState = document.getElementById('perception-state');
const videoDetections = document.getElementById('video-detections');
const currentNote = document.getElementById('current-note');
const notesList = document.getElementById('notes-list');
const noteCount = document.getElementById('note-count');
const flowChart = document.getElementById('flow-chart');
const flowGrid = document.getElementById('flow-grid');
const flowCountLines = document.getElementById('flow-count-lines');
const flowDeathMarks = document.getElementById('flow-death-marks');
const flowCursorLayer = document.getElementById('flow-cursor-layer');
const flowHitArea = document.getElementById('flow-hit-area');
const flowTeamCount = document.getElementById('flow-team-count');
const flowEnemyCount = document.getElementById('flow-enemy-count');
const flowDeathState = document.getElementById('flow-death-state');
const dataDialog = document.getElementById('data-dialog');
const dataError = document.getElementById('data-error');
const stageName = document.getElementById('stage-name');
const ruleName = document.getElementById('rule-name');
const dataStatus = document.getElementById('data-status');
const stageMapImage = document.getElementById('stage-map-image');
const demoVideoSource = video.currentSrc || video.querySelector('source')?.src || '';
const demoMapSource = stageMapImage.src;

let videoObjectUrl = null;
let mapObjectUrl = null;

let duration = FALLBACK_DURATION;
let filter = 'all';
let raf = null;
let activeEventIndex = -1;
let routeVisible = true;
let perceptionVisible = true;

function formatTime(value) {
  const safe = Math.max(0, Math.round(Number(value) || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function isFiniteTuple(tuple, minimumLength) {
  return Array.isArray(tuple) && tuple.length >= minimumLength && tuple.every(value => Number.isFinite(Number(value)));
}

function validateAnalysis(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return ['JSONのルートはオブジェクトにしてください。'];
  if (!Array.isArray(candidate.route) || candidate.route.length < 2 || !candidate.route.every(point => isFiniteTuple(point, 4))) errors.push('route は [秒, X, Y, HP] の配列を2点以上指定してください。');
  if (!Array.isArray(candidate.events) || !candidate.events.every(event => event && Number.isFinite(Number(event.time)) && ['death', 'insight'].includes(event.type))) errors.push('events は time と type（death / insight）を持つ配列にしてください。');
  if (!Array.isArray(candidate.detections)) errors.push('detections は配列にしてください。');
  else if (!candidate.detections.every(item => item && ['ally', 'enemy'].includes(item.team) && Array.isArray(item.frames) && item.frames.length >= 2 && item.frames.every(frame => isFiniteTuple(frame, 7)))) errors.push('detections の各要素には team と2点以上の frames を指定してください。');
  const gameFlow = candidate.gameFlow;
  if (!gameFlow || !Array.isArray(gameFlow.teamCount) || !gameFlow.teamCount.length || !gameFlow.teamCount.every(point => isFiniteTuple(point, 2))) errors.push('gameFlow.teamCount の形式が正しくありません。');
  if (!gameFlow || !Array.isArray(gameFlow.enemyCount) || !gameFlow.enemyCount.length || !gameFlow.enemyCount.every(point => isFiniteTuple(point, 2))) errors.push('gameFlow.enemyCount の形式が正しくありません。');
  ['self', 'ally', 'enemy'].forEach(team => {
    if (!gameFlow?.deaths || !Array.isArray(gameFlow.deaths[team]) || !gameFlow.deaths[team].every(point => isFiniteTuple(point, 2))) errors.push(`gameFlow.deaths.${team} の形式が正しくありません。`);
  });
  return errors;
}

function analysisDuration() {
  const times = [
    ...analysis.route.map(point => Number(point[0])),
    ...analysis.events.map(event => Number(event.time)),
    ...analysis.gameFlow.teamCount.map(point => Number(point[0])),
    ...analysis.gameFlow.enemyCount.map(point => Number(point[0]))
  ].filter(Number.isFinite);
  return Math.max(1, ...times);
}

function showDataError(message) {
  dataError.textContent = message;
  dataError.hidden = !message;
}

function setObjectUrl(kind, file) {
  const current = kind === 'video' ? videoObjectUrl : mapObjectUrl;
  if (current) URL.revokeObjectURL(current);
  const next = file ? URL.createObjectURL(file) : null;
  if (kind === 'video') videoObjectUrl = next; else mapObjectUrl = next;
  return next;
}

function interpolate(points, time) {
  if (time <= points[0][0]) return points[0].slice(1);
  const last = points[points.length - 1];
  if (time >= last[0]) return last.slice(1);
  const nextIndex = points.findIndex(point => point[0] >= time);
  const a = points[nextIndex - 1];
  const b = points[nextIndex];
  const ratio = (time - a[0]) / (b[0] - a[0]);
  return a.slice(1).map((value, i) => value + (b[i + 1] - value) * ratio);
}

function createSvg(tag, attrs = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

const FLOW = { left: 0, right: 760, top: 24, countBottom: 174, advantageY: 190, advantageHeight: 30 };

function flowX(time) {
  return FLOW.left + Math.max(0, Math.min(1, time / duration)) * (FLOW.right - FLOW.left);
}

function flowY(count) {
  return FLOW.top + Math.max(0, Math.min(100, count)) / 100 * (FLOW.countBottom - FLOW.top);
}

function countAt(points, time) {
  let value = points[0][1];
  points.forEach(point => { if (point[0] <= time) value = point[1]; });
  return value;
}

function stepPath(points) {
  let path = `M ${flowX(points[0][0])} ${flowY(points[0][1])}`;
  points.slice(1).forEach(point => {
    path += ` H ${flowX(point[0])} V ${flowY(point[1])}`;
  });
  return path;
}

function addFlowText(parent, text, attrs) {
  const label = createSvg('text', attrs);
  label.textContent = text;
  parent.appendChild(label);
}

function playerStateAt(time) {
  const selfDeaths = activeDeathsAt('self', time);
  const allyDeaths = activeDeathsAt('ally', time);
  const enemyDeaths = activeDeathsAt('enemy', time);
  const teamAlive = Math.max(0, 4 - selfDeaths - allyDeaths);
  const enemyAlive = Math.max(0, 4 - enemyDeaths);
  return { selfDead: selfDeaths > 0, teamAlive, enemyAlive, difference: teamAlive - enemyAlive };
}

function advantageSegments() {
  const boundaries = new Set([0, duration]);
  Object.values(analysis.gameFlow.deaths).flat().forEach(([start, length]) => {
    boundaries.add(Math.max(0, start));
    boundaries.add(Math.min(duration, start + length));
  });
  const sorted = [...boundaries].sort((a, b) => a - b);
  return sorted.slice(0, -1).map((start, index) => {
    const end = sorted[index + 1];
    return { start, end, state: playerStateAt((start + end) / 2) };
  });
}

function buildFlowChart() {
  flowGrid.innerHTML = '';
  flowCountLines.innerHTML = '';
  flowDeathMarks.innerHTML = '';
  [0, 50, 100].forEach(count => {
    const y = flowY(count);
    flowGrid.appendChild(createSvg('line', { x1: FLOW.left, y1: y, x2: FLOW.right, y2: y, class: 'flow-grid-line' }));
    addFlowText(flowGrid, String(count), { x: FLOW.left + 4, y: y + 5, class: 'flow-axis-text', 'text-anchor': 'start' });
  });
  for (let seconds = 0; seconds <= 360; seconds += 60) {
    const x = flowX(Math.min(seconds, duration));
      flowGrid.appendChild(createSvg('line', { x1: x, y1: FLOW.top, x2: x, y2: 220, class: 'flow-grid-line' }));
      addFlowText(flowGrid, formatTime(seconds), { x, y: 237, class: 'flow-axis-text', 'text-anchor': seconds === 0 ? 'start' : seconds >= 360 ? 'end' : 'middle' });
    }
  flowCountLines.appendChild(createSvg('path', { d: stepPath(analysis.gameFlow.teamCount), class: 'flow-count-path team' }));
  flowCountLines.appendChild(createSvg('path', { d: stepPath(analysis.gameFlow.enemyCount), class: 'flow-count-path enemy' }));
  advantageSegments().forEach(segment => {
    const x = flowX(segment.start);
    const width = Math.max(1, flowX(segment.end) - x);
    const stateClass = segment.state.difference > 0 ? 'favorable' : segment.state.difference < 0 ? 'unfavorable' : 'even';
    flowDeathMarks.appendChild(createSvg('rect', { x, y: FLOW.advantageY, width, height: FLOW.advantageHeight, class: `flow-advantage-band ${stateClass}` }));
    if (Math.abs(segment.state.difference) > 0 && width > 22) {
      addFlowText(flowDeathMarks, `${segment.state.difference > 0 ? '+' : '−'}${Math.abs(segment.state.difference)}`, { x: x + width / 2, y: FLOW.advantageY + 17, class: 'flow-advantage-label' });
    }
  });
  analysis.gameFlow.deaths.self.forEach(([start]) => {
    const x = flowX(start);
    flowDeathMarks.appendChild(createSvg('line', { x1: x, y1: 12, x2: x, y2: FLOW.advantageY + FLOW.advantageHeight, class: 'flow-self-death-line' }));
    flowDeathMarks.appendChild(createSvg('polygon', { points: `${x},4 ${x + 8},12 ${x},20 ${x - 8},12`, class: 'flow-self-death-marker' }));
  });
}

function activeDeathsAt(lane, time) {
  return analysis.gameFlow.deaths[lane].filter(([start, length]) => time >= start && time <= start + length).length;
}

function updateFlowChart(time) {
  const team = countAt(analysis.gameFlow.teamCount, time);
  const enemy = countAt(analysis.gameFlow.enemyCount, time);
  flowTeamCount.textContent = team;
  flowEnemyCount.textContent = enemy;
  const playerState = playerStateAt(time);
  const differenceLabel = playerState.difference > 0 ? `${playerState.difference}枚有利` : playerState.difference < 0 ? `${Math.abs(playerState.difference)}枚不利` : '五分';
  flowDeathState.classList.toggle('is-dead', playerState.selfDead);
  flowDeathState.classList.toggle('is-favorable', playerState.difference > 0);
  flowDeathState.classList.toggle('is-unfavorable', playerState.difference < 0);
  flowDeathState.textContent = `自${playerState.teamAlive}–敵${playerState.enemyAlive}・${differenceLabel}`;
  const x = flowX(time);
  flowCursorLayer.innerHTML = '';
  flowCursorLayer.appendChild(createSvg('line', { x1: x, y1: FLOW.top, x2: x, y2: FLOW.advantageY + FLOW.advantageHeight, class: 'flow-cursor' }));
  flowCursorLayer.appendChild(createSvg('circle', { cx: x, cy: flowY(team), r: 6, class: 'flow-cursor-dot team' }));
  flowCursorLayer.appendChild(createSvg('circle', { cx: x, cy: flowY(enemy), r: 6, class: 'flow-cursor-dot enemy' }));
}

function buildMap() {
  routeLayer.innerHTML = '';
  playerLayer.innerHTML = '';
  analysis.route.slice(0, -1).forEach((point, index) => {
    const next = analysis.route[index + 1];
    routeLayer.appendChild(createSvg('line', {
      x1: point[1], y1: point[2], x2: next[1], y2: next[2], class: 'route-segment',
      'data-time': (point[0] + next[0]) / 2
    }));
  });
  playerLayer.append(
    createSvg('circle', { r: 40, class: 'player-halo' }),
    createSvg('circle', { r: 21, class: 'player-dot' }),
    createSvg('path', { d: 'M 0 -12 L 8 8 L 0 4 L -8 8 Z', class: 'player-arrow' })
  );
}

function buildTimeline() {
  timelineEvents.innerHTML = '';
  analysis.events.forEach(event => {
    const marker = document.createElement('span');
    marker.className = `event-marker ${event.type}`;
    marker.style.left = `${event.time / duration * 100}%`;
    marker.setAttribute('aria-label', `${formatTime(event.time)} ${event.title}`);
    timelineEvents.appendChild(marker);
  });
  const thumb = document.createElement('span');
  thumb.className = 'timeline-thumb';
  thumb.id = 'timeline-thumb';
  timelineEvents.appendChild(thumb);
}

function activeDetectionsAt(time) {
  return analysis.detections.filter(detection => time >= detection.frames[0][0] && time <= detection.frames[detection.frames.length - 1][0]);
}

function recentDetectionsAt(time) {
  const mostRecentByEntity = new Map();
  analysis.detections.forEach(detection => {
    const end = detection.frames[detection.frames.length - 1][0];
    const age = time - end;
    if (age <= 0 || age > (detection.team === 'enemy' ? 8 : 6)) return;
    const current = mostRecentByEntity.get(detection.entity);
    if (!current || current.frames[current.frames.length - 1][0] < end) mostRecentByEntity.set(detection.entity, detection);
  });
  return [...mostRecentByEntity.values()];
}

function isDeathThreat(time) {
  return analysis.events.some(event => event.type === 'death' && time >= event.time - 5 && time <= event.time + 1);
}

function renderVideoDetections(time) {
  videoDetections.innerHTML = '';
  if (!perceptionVisible) return;
  const active = activeDetectionsAt(time);
  active.forEach(detection => {
    const [x, y, width, height] = interpolate(detection.frames, time);
    const px = x * 1600;
    const py = y * 900;
    const pw = width * 1600;
    const ph = height * 900;
    const threat = detection.team === 'enemy' && isDeathThreat(time);
    const group = createSvg('g', { class: `detection-group ${detection.team}${threat ? ' threat' : ''}` });
    group.appendChild(createSvg('rect', { x: px, y: py, width: pw, height: ph, rx: 8, class: 'detection-rect' }));
    const displayLabel = `${detection.team === 'enemy' ? '敵' : '味方'}｜${detection.weapon}`;
    const labelWidth = Math.max(160, Math.min(300, 70 + displayLabel.length * 25));
    group.appendChild(createSvg('rect', { x: px, y: Math.max(0, py - 36), width: labelWidth, height: 36, rx: 6, class: 'detection-label-bg' }));
    const label = createSvg('text', { x: px + 10, y: Math.max(26, py - 10), class: 'detection-label' });
    label.textContent = displayLabel;
    group.appendChild(label);
    const status = createSvg('text', { x: px + pw - 6, y: py + ph - 8, class: 'detection-distance' });
    status.textContent = detection.team === 'enemy' ? '敵・視認' : '味方・視認';
    group.appendChild(status);
    videoDetections.appendChild(group);
  });
}

function addObservedMark(detection, values, opacity = 1) {
  const [, , , , mapX, mapY] = values;
  const group = createSvg('g', { transform: `translate(${mapX} ${mapY})`, opacity });
  const ally = detection.team === 'ally';
  group.appendChild(createSvg('circle', { r: ally ? 23 : 26, class: ally ? 'ally-seen-ring' : 'last-seen-ring' }));
  const label = createSvg('text', { class: ally ? 'ally-seen-label' : 'last-seen-label' });
  label.textContent = detection.mapLabel || (ally ? '味' : detection.label.slice(0, 1));
  group.appendChild(label);
  enemyLayer.appendChild(group);
}

function addPrediction(detection, time, currentValues = null) {
  const frames = detection.frames;
  const isActive = Boolean(currentValues);
  const last = frames[frames.length - 1];
  const currentTime = isActive ? time : last[0];
  const currentX = isActive ? currentValues[4] : last[5];
  const currentY = isActive ? currentValues[5] : last[6];
  const priorTime = isActive ? Math.max(frames[0][0], currentTime - 1) : frames[frames.length - 2][0];
  const priorValues = isActive ? interpolate(frames, priorTime) : frames[frames.length - 2].slice(1);
  const priorX = priorValues[4];
  const priorY = priorValues[5];
  const frameDelta = Math.max(.1, currentTime - priorTime);
  const velocityX = (currentX - priorX) / frameDelta;
  const velocityY = (currentY - priorY) / frameDelta;
  const age = isActive ? 0 : time - last[0];
  const horizon = isActive ? 4 : Math.min(age, detection.team === 'enemy' ? 8 : 6);
  const predictedX = Math.max(40, Math.min(960, currentX + velocityX * horizon));
  const predictedY = Math.max(40, Math.min(960, currentY + velocityY * horizon));
  const maxAge = detection.team === 'enemy' ? 8 : 6;
  const opacity = isActive ? .82 : Math.max(.12, 1 - age / maxAge);
  const group = createSvg('g', { class: `prediction-group ${detection.team}`, opacity });
  group.appendChild(createSvg('line', { x1: priorX, y1: priorY, x2: currentX, y2: currentY, class: 'observed-motion' }));
  group.appendChild(createSvg('line', { x1: currentX, y1: currentY, x2: predictedX, y2: predictedY, class: 'prediction-path' }));
  group.appendChild(createSvg('circle', { cx: predictedX, cy: predictedY, r: 23 + horizon * 3, class: 'prediction-end' }));
  const label = createSvg('text', { x: predictedX, y: predictedY + 7, class: 'prediction-label' });
  label.textContent = '予';
  group.appendChild(label);
  enemyLayer.appendChild(group);
  if (!isActive) addObservedMark(detection, last.slice(1), opacity);
}

function renderPerceptionMap(time) {
  enemyLayer.innerHTML = '';
  if (!perceptionVisible) return;
  const active = activeDetectionsAt(time);
  const activeEntities = new Set(active.map(detection => detection.entity));
  active.forEach(detection => {
    const values = interpolate(detection.frames, time);
    addObservedMark(detection, values);
    if (time > detection.frames[0][0] + .5) addPrediction(detection, time, values);
  });
  const recent = recentDetectionsAt(time).filter(detection => !activeEntities.has(detection.entity));
  recent.forEach(detection => addPrediction(detection, time));
  const enemyCount = active.filter(detection => detection.team === 'enemy').length;
  const allyCount = active.filter(detection => detection.team === 'ally').length;
  const predictions = recent.length + active.filter(detection => time > detection.frames[0][0] + .5).length;
  if (enemyCount || allyCount) perceptionState.textContent = `映像で視認：敵${enemyCount} / 味方${allyCount}`;
  else if (predictions) perceptionState.textContent = `視認なし / 敵・味方${predictions}件の移動を短時間予測`;
  else perceptionState.textContent = '視界内の対象なし / 未確認位置は非表示';
}

function updateMap(time) {
  const [x, y, hp] = interpolate(analysis.route, time);
  const previous = interpolate(analysis.route, Math.max(0, time - 1));
  const angle = Math.atan2(y - previous[1], x - previous[0]) * 180 / Math.PI + 90;
  playerLayer.setAttribute('transform', `translate(${x} ${y}) rotate(${angle})`);
  [...routeLayer.children].forEach(segment => {
    const segmentTime = Number(segment.dataset.time);
    const distance = Math.abs(segmentTime - time);
    segment.style.opacity = !routeVisible ? 0 : distance <= 12 ? .92 : distance <= 32 ? .34 : .075;
    segment.style.strokeWidth = distance <= 12 ? 13 : 7;
  });
  const roundedHp = Math.round(hp);
  hpValue.textContent = roundedHp;
  hpBar.style.width = `${roundedHp}%`;
  hpBar.style.background = roundedHp < 35 ? 'var(--danger)' : roundedHp < 65 ? 'var(--orange)' : 'var(--lime)';
  renderPerceptionMap(time);
}

function renderNotes() {
  const visible = analysis.events.filter(event => filter === 'all' || event.type === filter);
  notesList.innerHTML = '';
  visible.forEach(event => {
    const index = analysis.events.indexOf(event);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `note-item ${event.type}${index === activeEventIndex ? ' is-current' : ''}`;
    button.dataset.eventIndex = index;
    const time = document.createElement('span');
    time.className = 'note-time';
    time.textContent = formatTime(event.time);
    const copy = document.createElement('span');
    copy.className = 'note-copy';
    const title = document.createElement('strong');
    title.textContent = event.title || '名称未設定の分析ポイント';
    const kind = document.createElement('span');
    kind.textContent = event.kind || (event.type === 'death' ? 'DEATH REVIEW' : 'ANALYSIS');
    copy.append(title, kind);
    const icon = document.createElement('span');
    icon.className = 'note-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = event.type === 'death' ? '◆' : '●';
    button.append(time, copy, icon);
    notesList.appendChild(button);
  });
  noteCount.textContent = `${visible.length} / ${analysis.events.length}`;
}

function setCurrentEvent(time) {
  if (!analysis.events.length) {
    activeEventIndex = -1;
    currentNote.replaceChildren();
    const empty = document.createElement('p');
    empty.textContent = 'この試合には分析ポイントがありません。';
    currentNote.appendChild(empty);
    renderNotes();
    return;
  }
  let index = 0;
  analysis.events.forEach((event, i) => { if (event.time <= time + 3) index = i; });
  if (index === activeEventIndex) return;
  activeEventIndex = index;
  const event = analysis.events[index];
  currentNote.replaceChildren();
  const topline = document.createElement('div');
  topline.className = 'note-topline';
  const kind = document.createElement('span');
  kind.className = 'note-kind';
  kind.textContent = event.kind || (event.type === 'death' ? 'DEATH REVIEW' : 'ANALYSIS');
  const eventTime = document.createElement('time');
  eventTime.textContent = formatTime(event.time);
  topline.append(kind, eventTime);
  const title = document.createElement('h3');
  title.textContent = event.title || '名称未設定の分析ポイント';
  const detail = document.createElement('p');
  detail.textContent = event.detail || '補足はありません。';
  const action = document.createElement('div');
  action.className = 'note-action';
  const actionLabel = document.createElement('span');
  actionLabel.textContent = '見るポイント';
  const focus = document.createElement('strong');
  focus.textContent = event.focus || '該当場面を確認';
  action.append(actionLabel, focus);
  currentNote.append(topline, title, detail, action);
  currentNote.style.borderLeftColor = event.type === 'death' ? 'var(--danger)' : 'var(--lime)';
  renderNotes();
}

function update(time = video.currentTime || 0) {
  const pct = Math.min(100, Math.max(0, time / duration * 100));
  seek.value = time;
  timelineProgress.style.width = `${pct}%`;
  document.getElementById('timeline-thumb')?.style.setProperty('left', `${pct}%`);
  currentTimeEl.textContent = formatTime(time);
  mapClock.textContent = formatTime(time);
  const nearDeath = analysis.events.find(event => event.type === 'death' && time >= event.time - 10 && time <= event.time + 2);
  videoState.textContent = nearDeath ? `DEATH REVIEW −${Math.max(0, Math.ceil(nearDeath.time - time))}s` : time < 16 ? 'OPENING' : time > duration - 18 ? 'RESULT' : 'IN BATTLE';
  renderVideoDetections(time);
  updateMap(time);
  updateFlowChart(time);
  setCurrentEvent(time);
}

function playbackLoop() {
  update();
  if (!video.paused && !video.ended) raf = requestAnimationFrame(playbackLoop);
}

function syncPlayState() {
  const playing = !video.paused && !video.ended;
  if (playPause) playPause.innerHTML = playing ? '<span aria-hidden="true">Ⅱ</span><span>一時停止</span>' : '<span aria-hidden="true">▶</span><span>再生</span>';
  videoOverlay.classList.toggle('is-playing', playing);
  videoOverlay.setAttribute('aria-label', playing ? '一時停止' : '再生');
  if (playing) {
    cancelAnimationFrame(raf);
    playbackLoop();
  }
}

function togglePlayback() {
  if (video.paused) video.play().catch(() => {}); else video.pause();
}

function refreshApp(resetTime = true) {
  cancelAnimationFrame(raf);
  video.pause();
  duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : analysisDuration();
  seek.max = duration;
  durationEl.textContent = formatTime(duration);
  activeEventIndex = -1;
  enemyLayer.innerHTML = '';
  buildMap();
  buildTimeline();
  buildFlowChart();
  renderNotes();
  if (resetTime) {
    try { video.currentTime = 0; } catch {}
  }
  update(resetTime ? 0 : video.currentTime || 0);
}

async function applySelectedData() {
  const analysisFile = document.getElementById('analysis-file').files[0];
  if (!analysisFile) {
    showDataError('解析JSONを選択してください。');
    return;
  }
  try {
    const candidate = JSON.parse(await analysisFile.text());
    const errors = validateAnalysis(candidate);
    if (errors.length) {
      showDataError(errors.join('\n'));
      return;
    }
    analysis = candidate;
    const selectedVideo = document.getElementById('video-file').files[0];
    const selectedMap = document.getElementById('map-file').files[0];
    if (selectedVideo) {
      video.src = setObjectUrl('video', selectedVideo);
      video.load();
    }
    if (selectedMap) stageMapImage.src = setObjectUrl('map', selectedMap);
    stageName.textContent = document.getElementById('stage-input').value.trim() || 'ステージ未設定';
    ruleName.textContent = document.getElementById('rule-input').value.trim() || 'ルール未設定';
    stageMapImage.alt = `${stageName.textContent} ${ruleName.textContent}の俯瞰マップ`;
    dataStatus.textContent = analysisFile.name;
    dataStatus.classList.add('is-loaded');
    showDataError('');
    refreshApp();
    dataDialog.close();
  } catch (error) {
    showDataError(error instanceof SyntaxError ? 'JSONを解析できません。構文を確認してください。' : `読み込みに失敗しました: ${error.message}`);
  }
}

function resetDemo() {
  analysis = JSON.parse(JSON.stringify(demoAnalysis));
  setObjectUrl('video', null);
  setObjectUrl('map', null);
  video.src = demoVideoSource;
  video.load();
  stageMapImage.src = demoMapSource;
  stageName.textContent = 'スメーシーワールド';
  ruleName.textContent = 'ガチヤグラ';
  document.getElementById('stage-input').value = stageName.textContent;
  document.getElementById('rule-input').value = ruleName.textContent;
  ['video-file', 'analysis-file', 'map-file'].forEach(id => { document.getElementById(id).value = ''; });
  dataStatus.textContent = 'サンプル解析データ';
  dataStatus.classList.remove('is-loaded');
  showDataError('');
  refreshApp();
}

function downloadCurrentAnalysis() {
  const blob = new Blob([JSON.stringify(analysis, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'battle-analysis.json';
  link.click();
  URL.revokeObjectURL(url);
}

video.addEventListener('loadedmetadata', () => {
  duration = Number.isFinite(video.duration) ? video.duration : FALLBACK_DURATION;
  seek.max = duration;
  durationEl.textContent = formatTime(duration);
  buildTimeline();
  buildFlowChart();
  update();
});
video.addEventListener('play', syncPlayState);
video.addEventListener('pause', syncPlayState);
video.addEventListener('ended', syncPlayState);
video.addEventListener('seeked', () => update());
seek.addEventListener('input', () => { video.currentTime = Number(seek.value); update(Number(seek.value)); });
playPause?.addEventListener('click', togglePlayback);
videoOverlay.addEventListener('click', togglePlayback);
document.getElementById('open-match').addEventListener('click', () => {
  showDataError('');
  dataDialog.showModal();
});
document.getElementById('apply-data').addEventListener('click', applySelectedData);
document.getElementById('reset-demo').addEventListener('click', resetDemo);
document.getElementById('download-analysis').addEventListener('click', downloadCurrentAnalysis);
flowHitArea.addEventListener('pointerdown', event => {
  const bounds = flowChart.getBoundingClientRect();
  const svgX = (event.clientX - bounds.left) / bounds.width * 760;
  const ratio = Math.max(0, Math.min(1, (svgX - FLOW.left) / (FLOW.right - FLOW.left)));
  const targetTime = ratio * duration;
  video.currentTime = targetTime;
  update(targetTime);
});

document.querySelectorAll('.toggle').forEach(button => button.addEventListener('click', () => {
  const active = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(active));
  button.classList.toggle('is-active', active);
  if (button.dataset.layer === 'route') routeVisible = active;
  if (button.dataset.layer === 'enemy') perceptionVisible = active;
  renderVideoDetections(video.currentTime || 0);
  updateMap(video.currentTime || 0);
}));

document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  document.querySelectorAll('.filter').forEach(item => item.classList.toggle('is-active', item === button));
  renderNotes();
}));

notesList.addEventListener('click', event => {
  const button = event.target.closest('[data-event-index]');
  if (!button) return;
  const selected = analysis.events[Number(button.dataset.eventIndex)];
  const lead = selected.type === 'death' ? 10 : 4;
  video.currentTime = Math.max(0, selected.time - lead);
  update(video.currentTime);
});

document.addEventListener('keydown', event => {
  if (event.target.matches('input, select, button')) return;
  if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
  if (event.code === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 5);
  if (event.code === 'ArrowRight') video.currentTime = Math.min(duration, video.currentTime + 5);
});

refreshApp();
